const config = require("./config.json");
const fastify = require("fastify");
const fs = require("fs/promises");
const fsSync = require("fs");
const crypto = require("crypto");
const path = require("path");
const promptList = require("./helpers/constants.js");
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const https = require("https");
const http = require("http");
const { URL } = require("url");
const fetch = require('node-fetch'); // Use node-fetch for proper proxy agent support

// DATA CORRUPTION PREVENTION SYSTEM
// Prevents race conditions, partial writes, and corrupt JSON files

const fileLocks = new Map(); // Track file locks to prevent concurrent writes

/**
 * Safely write JSON data with corruption prevention:
 * 1. Validates JSON structure before writing
 * 2. Uses atomic write (write to temp file, then rename)
 * 3. Implements file locking to prevent concurrent writes
 * 4. Creates backup before overwriting
 */
async function safeWriteJSON(filePath, data) {
  // Acquire lock for this file
  while (fileLocks.get(filePath)) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  fileLocks.set(filePath, true);

  try {
    // Validate JSON structure
    const jsonString = JSON.stringify(data, null, 2);
    JSON.parse(jsonString); // Throws if invalid

    // Create backup of existing file
    try {
      await fs.access(filePath);
      const backupPath = `${filePath}.backup`;
      await fs.copyFile(filePath, backupPath);
    } catch (e) {
      // File doesn't exist yet, no backup needed
    }

    // Atomic write: write to temp file first
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, jsonString, 'utf8');

    // Verify temp file is valid JSON
    const verification = JSON.parse(await fs.readFile(tempPath, 'utf8'));
    if (!verification) {
      throw new Error('Verification failed: temp file contains invalid data');
    }

    // Atomic rename (overwrites target file safely)
    await fs.rename(tempPath, filePath);

    console.log(`[Safe Write] Successfully wrote to ${path.basename(filePath)}`);
    return true;
  } catch (error) {
    console.error(`[Safe Write] Failed to write ${filePath}:`, error.message);

    // Try to restore from backup if write failed
    try {
      const backupPath = `${filePath}.backup`;
      await fs.access(backupPath);
      await fs.copyFile(backupPath, filePath);
      console.log(`[Safe Write] Restored ${path.basename(filePath)} from backup`);
    } catch (restoreError) {
      console.error(`[Safe Write] Could not restore from backup:`, restoreError.message);
    }

    throw error;
  } finally {
    // Release lock
    fileLocks.delete(filePath);
  }
}

/**
 * Safely read and parse JSON with corruption detection
 */
async function safeReadJSON(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');

    // Detect empty or corrupted files
    if (!content || content.trim() === '') {
      console.error(`[Safe Read] File ${filePath} is empty, attempting backup restore`);
      throw new Error('Empty file detected');
    }

    const data = JSON.parse(content);
    return data;
  } catch (error) {
    console.error(`[Safe Read] Failed to read ${filePath}:`, error.message);

    // Try to restore from backup
    try {
      const backupPath = `${filePath}.backup`;
      console.log(`[Safe Read] Attempting to restore from backup: ${backupPath}`);
      const backupContent = await fs.readFile(backupPath, 'utf8');
      const backupData = JSON.parse(backupContent);

      // Restore the main file from backup
      await fs.copyFile(backupPath, filePath);
      console.log(`[Safe Read] Successfully restored ${path.basename(filePath)} from backup`);

      return backupData;
    } catch (backupError) {
      console.error(`[Safe Read] Backup restore failed:`, backupError.message);
      throw new Error(`File corrupted and backup unavailable: ${filePath}`);
    }
  }
}

// Load proxies from either array or file
function loadProxies() {
  if (!config.proxyURL) {
    return [];
  }

  // If it's already an array, use it directly
  if (Array.isArray(config.proxyURL)) {
    return config.proxyURL.filter(p => p && p.trim().length > 0);
  }

  // If it's a string, treat it as a file path
  if (typeof config.proxyURL === 'string') {
    try {
      const filePath = path.resolve(__dirname, config.proxyURL);
      console.log(`[PROXY] Loading proxies from file: ${filePath}`);

      if (!fsSync.existsSync(filePath)) {
        console.error(`[PROXY] File not found: ${filePath}`);
        return [];
      }

      const fileContent = fsSync.readFileSync(filePath, 'utf8');
      const proxies = fileContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#')); // Filter out empty lines and comments

      console.log(`[PROXY] Loaded ${proxies.length} proxies from file`);
      return proxies;
    } catch (error) {
      console.error(`[PROXY] Error loading proxy file: ${error.message}`);
      return [];
    }
  }

  console.warn('[PROXY] Invalid proxyURL format in config.json');
  return [];
}

const PROXY_LIST = loadProxies();
const USE_PROXIES = PROXY_LIST.length > 0;

const WORKING_PROXIES = new Set();
const FAILED_PROXIES = new Set();
const PROXY_LAST_USED = new Map(); 
const PROXY_COOLDOWN_MS = 5000; 
let proxyRotationIndex = 0;

function getNextProxy() {
  if (!USE_PROXIES || PROXY_LIST.length === 0) {
    return null;
  }

  const now = Date.now();

  // Filter out failed proxies and proxies in cooldown
  let availableProxies = PROXY_LIST.filter(p => {
    if (FAILED_PROXIES.has(p)) return false;

    const lastUsed = PROXY_LAST_USED.get(p);
    if (lastUsed && (now - lastUsed) < PROXY_COOLDOWN_MS) {
      return false; // Proxy is in cooldown
    }
    return true;
  });

  // If no proxies available due to cooldown, find the one with oldest usage
  if (availableProxies.length === 0) {
    availableProxies = PROXY_LIST.filter(p => !FAILED_PROXIES.has(p));

    if (availableProxies.length === 0) {
      console.log('All proxies failed, resetting failed list and retrying...');
      FAILED_PROXIES.clear();
      PROXY_LAST_USED.clear();
      availableProxies = PROXY_LIST;
    } else {
      console.log('All proxies in cooldown, using least recently used proxy...');
      // Sort by last usage and pick the oldest
      availableProxies.sort((a, b) => {
        const aTime = PROXY_LAST_USED.get(a) || 0;
        const bTime = PROXY_LAST_USED.get(b) || 0;
        return aTime - bTime;
      });
    }
  }

  // Randomly select instead of round-robin to break patterns
  const proxy = availableProxies[Math.floor(Math.random() * availableProxies.length)];
  PROXY_LAST_USED.set(proxy, now);
  return proxy;
}

// Mark a proxy as working
function markProxyWorking(proxyUrl) {
  WORKING_PROXIES.add(proxyUrl);
  FAILED_PROXIES.delete(proxyUrl);
}

// Mark a proxy as failed
function markProxyFailed(proxyUrl) {
  FAILED_PROXIES.add(proxyUrl);
  console.log(`Proxy marked as failed: ${proxyUrl} (${FAILED_PROXIES.size}/${PROXY_LIST.length} failed)`);
}

if (USE_PROXIES) {
  console.log(`[PROXY MODE] Loaded ${PROXY_LIST.length} proxies (HTTP/SOCKS) with smart rotation`);
  console.log(`[SECURITY] Direct connection fallback is DISABLED - will never expose your IP`);
} else {
  console.log('[DIRECT MODE] No proxies configured, using direct connection');
  console.log('[WARNING] Your real IP will be exposed to DeepInfra API');
}




// Create a custom agent for proxy connections
// Uses protocol-specific agents for compatibility with node-fetch v2
function createCustomAgent(proxyUrl = null, targetUrl = 'https://diddy.com') {
  if (proxyUrl) {
    // Prevent DNS leaks by converting SOCKS proxies to SOCKS5h
    const safeProxyUrl = preventDNSLeak(proxyUrl);

    console.log(`[Agent] Creating agent for proxy: ${safeProxyUrl}`);
    console.log(`[Agent] Target URL: ${targetUrl}`);

    // Determine which agent to use based on proxy protocol
    let agent;
    const proxyProtocol = safeProxyUrl.split(':')[0].toLowerCase();
    const targetProtocol = targetUrl.startsWith('https') ? 'https' : 'http';

    if (proxyProtocol === 'socks5' || proxyProtocol === 'socks5h' || proxyProtocol === 'socks4' || proxyProtocol === 'socks') {
      // SOCKS proxy - use SocksProxyAgent
      console.log(`[Agent] Using SocksProxyAgent for ${proxyProtocol} proxy`);
      agent = new SocksProxyAgent(safeProxyUrl, {
        keepAlive: true,
        keepAliveMsecs: 1000,
        family: 4, // Force IPv4 to prevent IPv6 leaks
        timeout: 30000 // 30 second timeout for proxy connection
      });
    } else if (targetProtocol === 'https') {
      // HTTPS target - use HttpsProxyAgent
      console.log(`[Agent] Using HttpsProxyAgent for HTTPS target`);
      agent = new HttpsProxyAgent(safeProxyUrl, {
        keepAlive: true,
        keepAliveMsecs: 1000,
        family: 4, // Force IPv4 to prevent IPv6 leaks
        timeout: 30000 // 30 second timeout for proxy connection
      });
    } else {
      // HTTP target - use HttpProxyAgent
      console.log(`[Agent] Using HttpProxyAgent for HTTP target`);
      agent = new HttpProxyAgent(safeProxyUrl, {
        keepAlive: true,
        keepAliveMsecs: 1000,
        family: 4, // Force IPv4 to prevent IPv6 leaks
        timeout: 30000 // 30 second timeout for proxy connection
      });
    }

    console.log(`[Agent] ✓ Agent created successfully`);
    return agent;
  } else {
    // Direct connection (no proxy)
    console.warn(`[Agent] WARNING: Creating direct HTTPS agent (no proxy - IP WILL BE EXPOSED)`);
    console.warn(`[Agent] This should only be used for testing purposes!`);
    return new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 1000,
      family: 4, // Force IPv4
      timeout: 30000 // 30 second timeout
    });
  }
}


// Helper function to prevent DNS leaks by converting ALL SOCKS proxies to SOCKS5h
// CRITICAL: socks5:// resolves DNS locally (LEAKS IP!), socks5h:// resolves DNS on proxy (SAFE!)
// This applies to ALL proxy usage: node-fetch, ProxyAgent, and CycleTLS
function preventDNSLeak(proxyUrl) {
  if (!proxyUrl) return null;

  // Convert SOCKS4 to SOCKS5h (prevents DNS leaks)
  if (proxyUrl.startsWith('socks4://')) {
    const converted = proxyUrl.replace('socks4://', 'socks5h://');
    console.log(`[DNS-Safe] Converting SOCKS4 to SOCKS5h: ${proxyUrl} -> ${converted}`);
    return converted;
  }

  // Convert SOCKS5 to SOCKS5h to prevent DNS leaks
  if (proxyUrl.startsWith('socks5://')) {
    const converted = proxyUrl.replace('socks5://', 'socks5h://');
    console.log(`[DNS-Safe] Converting SOCKS5 to SOCKS5h: ${proxyUrl} -> ${converted}`);
    return converted;
  }

  // Convert generic SOCKS to SOCKS5h
  if (proxyUrl.startsWith('socks://')) {
    const converted = proxyUrl.replace('socks://', 'socks5h://');
    console.log(`[DNS-Safe] Converting SOCKS to SOCKS5h: ${proxyUrl} -> ${converted}`);
    return converted;
  }


  return proxyUrl;
}


const app = fastify({
  logger: false,
});

app.register(require("@fastify/cors"), {
  origin: "*",
});

// IP-based rate limiting configuration
app.register(require("@fastify/rate-limit"), {
  global: true,
  max: 30, // Maximum 10 requests
  timeWindow: "1 minute", // Per minute
  cache: 10000, // Keep track of 10000 IPs in memory
  allowList: [], // Whitelist IPs (empty by default)
  continueExceeding: true, // Continue to count requests even after limit is exceeded
  skipOnError: false, // Don't skip rate limiting on error

  // IP address extraction - prioritizes real client IP over proxy IPs
  keyGenerator: function (request) {
    // Try to get real IP from various headers (in order of reliability)
    const forwarded = request.headers['x-forwarded-for'];
    const realIp = request.headers['x-real-ip'];
    const cfConnectingIp = request.headers['cf-connecting-ip'];

    // X-Forwarded-For can contain multiple IPs, take the first one (original client)
    if (forwarded) {
      const ips = forwarded.split(',').map(ip => ip.trim());
      return ips[0];
    }

    // Cloudflare connecting IP (if behind Cloudflare)
    if (cfConnectingIp) {
      return cfConnectingIp;
    }

    // X-Real-IP header
    if (realIp) {
      return realIp;
    }

    // Fallback to socket IP
    return request.ip;
  },

  // Custom error response
  errorResponseBuilder: function (request, context) {
    return {
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. You can make ${context.max} requests per ${context.after}. Please try again later.`,
      retryAfter: context.ttl, // Time in milliseconds until rate limit resets
    };
  },

  // Add rate limit info to response headers
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
    'retry-after': true
  }
});

app.register(require("@fastify/static"), {
  root: path.resolve(__dirname, "./frontend"),
  prefix: "/",
  decorateReply: false,
});

// Estimate token count for text (roughly 4 characters per token)
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Estimate tokens for a message object
function estimateMessageTokens(message) {
  let tokens = 0;
  if (typeof message.content === 'string') {
    tokens += estimateTokens(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text' && part.text) {
        tokens += estimateTokens(part.text);
      }
      // Images and other content types add tokens too, but we'll use a rough estimate
      if (part.type === 'image_url') {
        tokens += 85; // Rough estimate for image tokens
      }
    }
  }
  if (message.role) {
    tokens += 4; // Role overhead
  }
  return tokens;
}

// Trim messages to fit within token limit
function trimMessagesToTokenLimit(messages, maxTokens) {
  if (!messages || messages.length === 0) return messages;

  // Calculate current total tokens
  let totalTokens = messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);

  if (totalTokens <= maxTokens) {
    return messages; // No trimming needed
  }

  // Find system message (should be first)
  let systemMessage = null;
  let systemIndex = -1;
  let otherMessages = [];

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'system') {
      systemMessage = messages[i];
      systemIndex = i;
    } else {
      otherMessages.push(messages[i]);
    }
  }

  // If only system message exists, trim it
  if (otherMessages.length === 0 && systemMessage) {
    const systemTokens = estimateMessageTokens(systemMessage);
    if (systemTokens > maxTokens) {
      // Trim system message content
      if (typeof systemMessage.content === 'string') {
        const targetLength = Math.floor(maxTokens * 4 * 0.95); // Leave some buffer
        systemMessage.content = systemMessage.content.slice(0, targetLength) + "... [truncated]";
      }
    }
    return [systemMessage];
  }

  // Calculate tokens needed for other messages and system message
  const systemTokens = systemMessage ? estimateMessageTokens(systemMessage) : 0;
  let availableTokens = maxTokens - systemTokens;

  // If system message is too large, we need to trim it first
  if (availableTokens < maxTokens * 0.3) {
    const targetSystemTokens = Math.floor(maxTokens * 0.3);
    if (systemMessage && typeof systemMessage.content === 'string') {
      const targetLength = Math.floor(targetSystemTokens * 4 * 0.95);
      systemMessage.content = systemMessage.content.slice(0, targetLength) + "... [truncated]";
    }
    availableTokens = maxTokens - targetSystemTokens;
  }

  // Keep messages from the end (most recent) until we hit token limit
  const trimmedMessages = [];
  let currentTokens = 0;

  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(otherMessages[i]);
    if (currentTokens + msgTokens <= availableTokens) {
      trimmedMessages.unshift(otherMessages[i]);
      currentTokens += msgTokens;
    } else {
      break; // Stop adding older messages
    }
  }

  // Combine system message (if exists) with trimmed messages
  return systemMessage ? [systemMessage, ...trimmedMessages] : trimmedMessages;
}

app.get("/api/make-key", async function (request, reply) {
  // load /data/users.json using safe read
  let users = await safeReadJSON("./data/users.json");

  // create UUID
  let uuid = crypto.randomUUID();

  users[uuid] = {
    key: uuid,
    balance: 0,
    lastAdViewedDate: 0,
    createdDate: Date.now()
  };

  await safeWriteJSON("./data/users.json", users);
  reply.send(users[uuid]);
});

app.post("/api/check-key", async function (request, reply) {
  try {
    if (!request.body || !request.body.key) {
      return reply.status(400).send({ error: "Missing key in request" });
    }
    let users = await safeReadJSON("./data/users.json");
    if (!users[request.body.key]) {
      return reply.status(404).send({ error: "Key not found" });
    }
    reply.send(users[request.body.key]);
  } catch (error) {
    console.error("Check key error:", error);
    return reply.status(500).send({ error: "Internal server error" });
  }
});

// Simple ad URL generation for Cuty.io
// No tokens needed - just generate ad URL and let users complete ads

app.post("/api/getAdUrl", async function (request, reply) {
  const url = `https://api.cuty.io/quick?token=${config.cutyio}&ad=1&url=${
    request.body.url
  }&alias=${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 12)}&format=text`;

  try {
    // Use direct connection for cuty.io (not sensitive, just generating ad links)
    console.log(`[cuty.io] Making direct connection (no proxy needed for ad generation)`);
    const agent = createCustomAgent(null, url);
    const response = await fetch(url, {
      agent: agent,
    });

    if (!response.ok) {
      console.error(`[cuty.io] Request failed with status: ${response.status}`);
      return reply.status(response.status).send({
        error: `cuty.io API returned error: ${response.status} ${response.statusText}`
      });
    }

    console.log(`[cuty.io] ✓ Direct connection succeeded: ${response.status} ${response.statusText}`);

    // Return just the ad URL
    const adUrl = await response.text();
    reply.send({ adUrl });
  } catch (error) {
    console.error(`[cuty.io] Error generating ad URL:`, error.message);
    return reply.status(500).send({
      error: 'Failed to generate ad URL from cuty.io'
    });
  }
});

// Simple ad viewing system - no tokens needed
// Users can earn credits once every 12 hours by watching ads

app.post("/api/getCredits", async function (request, reply) {
  try {
    if (!request.body || !request.body.key) {
      return reply.status(400).send({ error: "Missing key in request" });
    }

    let users = await safeReadJSON("./data/users.json");
    if (!users[request.body.key]) {
      return reply.status(404).send({ error: "Key not found" });
    }

    // Check if the last ad was viewed less than 12 hours ago
    if (
      users[request.body.key].lastAdViewedDate !== 0 &&
      users[request.body.key].lastAdViewedDate + 43200000 > Date.now()
    ) {
      const timeLeft = 43200000 - (Date.now() - users[request.body.key].lastAdViewedDate);
      const hoursLeft = Math.ceil(timeLeft / 3600000);
      return reply
        .status(429)
        .send({ error: `Please wait ${hoursLeft} hours between ad views` });
    }

    users[request.body.key].lastAdViewedDate = Date.now();
    users[request.body.key].balance = Math.round((users[request.body.key].balance + config.creditsPerAd) * 100) / 100;
    await safeWriteJSON("./data/users.json", users);
    reply.send({
      success: true,
      balance: users[request.body.key].balance,
      creditAmount: config.creditsPerAd
    });
  } catch (error) {
    console.error("Get credits error:", error);
    return reply.status(500).send({ error: "Internal server error" });
  }
});

app.get("/api/statistics", async function (request, reply) {
  const stats = await safeReadJSON("stats.json");
  reply.send({
    totalRequests: stats.totalRequests,
    activeRequests: stats.activeRequests,
  });
});

function preprocessRequest(request) {
  if (!request.body || !request.body.model) {
    return request;
  }

  delete request.headers["content-length"];
  delete request.headers["Content-Length"];


  const modelParts = request.body.model.split(":");
  const model = modelParts[0];
  const prompt = modelParts[1];

  const newBody = JSON.parse(JSON.stringify(request.body));

  if (prompt && promptList.availablePrompts.includes(prompt)) {
    if (
      newBody.messages &&
      newBody.messages.length > 0
    ) {
    if (typeof newBody.messages[0].content === 'string') {
        const originalContent = newBody.messages[0].content;
        const promptText = promptList.prompts[prompt];
        newBody.messages[0].content = promptText + originalContent;
      } else if (Array.isArray(newBody.messages[0].content)) {
        const textPart = newBody.messages[0].content.find(part => part.type === 'text');
        if (textPart) {
          const originalText = textPart.text;
          textPart.text = promptList.prompts[prompt] + originalText;
        }
      } else {
        console.log("ERROR: Unexpected content type:", typeof newBody.messages[0].content);
      }
    }
  }

  // Apply token limit from config
  if (newBody.messages && newBody.messages.length > 0 && config.maxTokens) {
    newBody.messages = trimMessagesToTokenLimit(newBody.messages, config.maxTokens);
  }

  newBody.model = model;

  request.body = newBody;

  return request;
}

app.all("/v1/chat/completions", async function (request, reply) {
  // edit stats.json

  let stats = await safeReadJSON("stats.json");
  stats.totalRequests += 1;
  stats.activeRequests += 1;
  await safeWriteJSON("stats.json", stats);

  const isStreaming =
    request.headers["accept"] === "text/event-stream" ||
    request.body?.stream === true;

  await proxyToEndpoint(
    preprocessRequest(request),
    reply,
    "https://api.deepinfra.com/v1/openai/chat/completions",
    isStreaming
  );
});

// Test endpoint to verify proxy is working and not leaking IP
app.get("/api/test-proxy", async function (request, reply) {
  try {
    const proxyUrl = getNextProxy();
    if (!proxyUrl) {
      return reply.send({ error: 'No proxies configured' });
    }

    console.log(`\n[LEAK TEST] Testing proxy: ${proxyUrl}`);

    const agent = createCustomAgent(proxyUrl, 'https://httpbin.org/ip');
    const response = await fetch('https://httpbin.org/ip', {
      method: 'GET',
      agent: agent,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const data = await response.json();

    console.log(`[LEAK TEST] httpbin.org sees IP: ${data.origin}`);

    return reply.send({
      proxyConfigured: proxyUrl,
      ipSeen: data.origin,
      success: true
    });
  } catch (error) {
    console.error('[LEAK TEST] Test failed:', error);
    return reply.status(500).send({ error: error.message });
  }
});

app.get("/v1/models", async function (request, reply) {
  const models = [
    "deepseek-ai/DeepSeek-V3.1",
    "deepseek-ai/DeepSeek-V3.1-Terminus",
    "deepseek-ai/DeepSeek-R1-0528",
    "deepseek-ai/DeepSeek-V3-0324",
    "zai-org/GLM-4.6",
    "deepseek-ai/DeepSeek-V3.2-Exp",
    "moonshotai/Kimi-K2-Instruct-0905",
    "Qwen/Qwen3-235B-A22B-Instruct-2507",
    "meta-llama/Llama-4-Scout-17B-16E-Instruct",
  ];

  reply.send({
    object: "list",
    data: models.map((modelId) => ({
      id: modelId,
      object: "model",
      created: Math.floor(Date.now() / 1000),
      owned_by: "composite",
    })),
  });
});

async function proxyToEndpoint(request, reply, endpoint, isStreaming = false) {
  try {
    let headers = { ...request.headers };

    if (!headers.authorization || !headers.authorization.includes(" ")) {
      return reply
        .status(401)
        .send({ error: "Missing or invalid authorization header" });
    }

    // get api key
    let key = headers.authorization.split(" ")[1];

    // load /data/users.json using safe read
    let users = await safeReadJSON("./data/users.json");

    // Check if user exists
    if (!users[key]) {
      return reply.status(401).send({ error: "Invalid API key" });
    }

    // check if they have enough credits (minimum check - will verify exact amount after request)
    // At 0.01 credits per token, minimum 10 tokens = 0.1 credits
    if (users[key].balance < 0.1) {
      return reply.status(402).send({ error: "Insufficient credits" });
    }

    // check if the last ad was viewed more than 12 hours ago (credits expired)
    if (
      users[key].lastAdViewedDate !== 0 &&
      users[key].lastAdViewedDate + 43200000 < Date.now()
    ) {
      users[key].balance = 0;
      await safeWriteJSON("./data/users.json", users);
      return reply
        .status(402)
        .send({ error: "Credits expired. Please view an ad first." });
    }

    // Credit deduction will happen after we get the response with token usage

    delete headers.authorization;
    delete headers.referer;
    delete headers.origin;
    delete headers.host;
    delete headers.connection;

    // Remove headers that could leak real IP address
    delete headers['x-forwarded-for'];
    delete headers['x-real-ip'];
    delete headers['x-client-ip'];
    delete headers['x-remote-ip'];
    delete headers['true-client-ip'];
    delete headers['cf-connecting-ip'];
    delete headers['forwarded'];
    delete headers['via'];

    // Also check uppercase variants (just in case)
    delete headers['X-Forwarded-For'];
    delete headers['X-Real-IP'];
    delete headers['X-Client-IP'];
    delete headers['X-Remote-IP'];
    delete headers['True-Client-IP'];
    delete headers['CF-Connecting-IP'];
    delete headers['Forwarded'];
    delete headers['Via'];

    // Helper function to check if error is an OpenAI-style error
    function isOpenAIError(data) {
      if (!data || !data.error) return false;
      const errorMsg = (data.error.message || '').toLowerCase();
      return errorMsg.includes('busy') ||
             errorMsg.includes('try again') ||
             errorMsg.includes('overloaded') ||
             errorMsg.includes('rate limit') ||
             errorMsg.includes('unavailable');
    }

    // Helper function to attempt request with a single proxy (no retry loop)
    async function attemptRequest(modelToUse, canFallback = true) {
      const requestBody = { ...request.body, model: modelToUse };
      let response = null;
      let lastError = null;

      // Only attempt once with a single proxy
      try {
        const proxyUrl = USE_PROXIES ? getNextProxy() : null;

        if (USE_PROXIES && !proxyUrl) {
          throw new Error('No proxies available');
        }

        if (proxyUrl) {
          console.log(`[Request] Using proxy: ${proxyUrl}`);
        } else {
          console.log(`[Request] Using direct connection (no proxy)`);
        }

        const agent = createCustomAgent(proxyUrl, endpoint);

        // Create an AbortController for request timeout
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 30000); // 30 second timeout

        const fetchOptions = {
          method: "POST",
          headers: headers,
          body: JSON.stringify(requestBody),
          agent: agent,
          signal: abortController.signal
        };

        try {
          console.log(`Making request...`);
          response = await fetch(endpoint, fetchOptions);
          clearTimeout(timeoutId); // Clear timeout if request completes
          console.log(`✓ Request completed`);
        } catch (fetchError) {
          clearTimeout(timeoutId);
          if (fetchError.name === 'AbortError') {
            throw new Error('Request timeout after 30 seconds');
          }
          throw fetchError;
        }

        console.log(`[Response] Status: ${response.status}`);

        if (proxyUrl) {
          console.log(`✓ Proxy used: ${proxyUrl}`);
          console.log(`  Response status: ${response.status} ${response.statusText}`);

          // If we get a 403, mark proxy as failed
          if (response.status === 403) {
            console.warn(`✗ Got 403 Forbidden from DeepInfra with proxy: ${proxyUrl}`);
            markProxyFailed(proxyUrl);
            lastError = new Error(`403 Forbidden from DeepInfra`);
          } else {
            // Success! Mark proxy as working
            markProxyWorking(proxyUrl);
          }
        }
      } catch (proxyError) {
        lastError = proxyError;

        // Identify specific error types
        const errorType = proxyError.code || proxyError.name || 'UNKNOWN';
        const isConnectionError = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ENETUNREACH'].includes(errorType);

        if (isConnectionError) {
          console.warn(`✗ Connection error: ${errorType}`);
          console.warn(`  Error message: ${proxyError.message}`);
        } else {
          console.warn(`✗ Request failed: ${proxyError.message}`);
        }

        if (proxyError.cause) {
          console.warn(`  Cause: ${proxyError.cause.message || proxyError.cause}`);
        }
      }

      // If no response, throw the last error
      if (!response) {
        if (lastError) {
          throw lastError;
        } else {
          throw new Error(`Request failed for model ${modelToUse}`);
        }
      }

      // Log non-OK responses
      if (!response.ok) {
        console.error(`HTTP error for model ${modelToUse}:`, {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries())
        });
      }

      // For streaming, we need to check the initial response
      if (isStreaming) {
        // If status indicates failure, try fallback if available
        if (!response.ok && canFallback && promptList.fallbacks[modelToUse]) {
          console.log(`Model ${modelToUse} failed with status ${response.status}, trying fallback: ${promptList.fallbacks[modelToUse]}`);
          return attemptRequest(promptList.fallbacks[modelToUse], false);
        }
        return response;
      } else {
        // For non-streaming, check the response data
        const data = await response.json();

        // Log error data if present
        if (data.error) {
          console.error(`API error for model ${modelToUse}:`, {
            error: data.error,
            status: response.status
          });
        }

        // Check if we got an OpenAI-style error and can fallback
        if (isOpenAIError(data) && canFallback && promptList.fallbacks[modelToUse]) {
          console.log(`Model ${modelToUse} returned error: ${data.error.message}, trying fallback: ${promptList.fallbacks[modelToUse]}`);
          return attemptRequest(promptList.fallbacks[modelToUse], false);
        }

        return { response, data };
      }
    }

    const originalModel = request.body.model;
    const canFallback = promptList.fallbacks.hasOwnProperty(originalModel);

    if (isStreaming) {
      const response = await attemptRequest(originalModel, canFallback);

      reply.raw.writeHead(response.status, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Transfer-Encoding": "chunked",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      });

      try {
        let streamBuffer = '';
        let totalTokens = 0;
        let lastChunkData = null;

        for await (const chunk of response.body) {
          reply.raw.write(chunk);

          // Accumulate chunks to parse token usage
          streamBuffer += chunk.toString();

          // Parse SSE data to extract token usage from the last data chunk
          const lines = streamBuffer.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.slice(6);
              if (dataStr.trim() !== '[DONE]') {
                try {
                  const parsed = JSON.parse(dataStr);
                  lastChunkData = parsed;
                  if (parsed.usage && parsed.usage.total_tokens) {
                    totalTokens = parsed.usage.total_tokens;
                  }
                } catch (e) {
                  // Ignore parse errors for incomplete chunks
                }
              }
            }
          }
        }

        // If no token usage found in stream, estimate from request/response
        if (totalTokens === 0) {
          console.log("No token usage in stream, estimating...");
          // Estimate based on the messages sent
          if (request.body.messages) {
            totalTokens = request.body.messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
            // Add estimated response tokens (rough estimate)
            totalTokens += 500; // Assume average 500 token response
          }
          console.log(`Estimated tokens: ${totalTokens}`);
        } else {
          console.log(`API reported tokens: ${totalTokens}`);
        }

        // Deduct credits based on token usage
        const creditsToDeduct = Math.round(totalTokens * config.creditsPerToken * 100) / 100;
        console.log(`Deducting ${creditsToDeduct} credits for ${totalTokens} tokens (streaming)`);

        let usersAfter = await safeReadJSON("./data/users.json");
        if (usersAfter[key]) {
          const oldBalance = usersAfter[key].balance;
          usersAfter[key].balance = Math.max(0, Math.round((usersAfter[key].balance - creditsToDeduct) * 100) / 100);
          console.log(`Balance: ${oldBalance} -> ${usersAfter[key].balance}`);
          await safeWriteJSON("./data/users.json", usersAfter);
        }

        let stats = await safeReadJSON("stats.json");
        stats.activeRequests -= 1;
        await safeWriteJSON("stats.json", stats);
        reply.raw.end();
      } catch (streamError) {
        // Can't send error response after headers sent, just end the stream
        console.error("Streaming error:", streamError);
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    } else {
      const { data } = await attemptRequest(originalModel, canFallback);

      // Deduct credits based on token usage (0.01 credits per token)
      let totalTokens = 0;
      if (data.usage && data.usage.total_tokens) {
        totalTokens = data.usage.total_tokens;
        console.log(`API reported tokens: ${totalTokens} (non-streaming)`);
      } else {
        // If no token usage in response, estimate from request
        console.log("No token usage in response, estimating...");
        if (request.body.messages) {
          totalTokens = request.body.messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
          // Add estimated response tokens
          if (data.choices && data.choices[0] && data.choices[0].message) {
            totalTokens += estimateMessageTokens(data.choices[0].message);
          } else {
            totalTokens += 500; // Default estimate
          }
        }
        console.log(`Estimated tokens: ${totalTokens}`);
      }

      const creditsToDeduct = Math.round(totalTokens * config.creditsPerToken * 100) / 100;
      console.log(`Deducting ${creditsToDeduct} credits for ${totalTokens} tokens (non-streaming)`);

      // Reload users and deduct credits
      let usersAfter = await safeReadJSON("./data/users.json");
      if (usersAfter[key]) {
        const oldBalance = usersAfter[key].balance;
        usersAfter[key].balance = Math.max(0, Math.round((usersAfter[key].balance - creditsToDeduct) * 100) / 100);
        console.log(`Balance: ${oldBalance} -> ${usersAfter[key].balance}`);
        await safeWriteJSON("./data/users.json", usersAfter);
      }

      let stats = await safeReadJSON("stats.json");
      stats.activeRequests -= 1;
      await safeWriteJSON("stats.json", stats);
      reply.send(data);
    }
  } catch (error) {
    console.error("Proxy error:", error);
    // Only send error response if headers haven't been sent yet
    if (!reply.sent && !reply.raw.headersSent) {
      return reply.status(500).send({ error: "Internal server error" });
    }
  }
}

app.post("/v1/streaming/chat/completions", async function (request, reply) {
  await proxyToEndpoint(
    preprocessRequest(request),
    reply,
    "https://api.deepinfra.com/v1/openai/chat/completions",
    true
  );
});

app.post("/v1/nostreaming/chat/completions", async function (request, reply) {
  await proxyToEndpoint(
    preprocessRequest(request),
    reply,
    "https://api.deepinfra.com/v1/chat/completions",
    false
  );
});

setInterval(() => {
  try {

    // Check /duplicate/ and see if there are more than 5 files
    const files = fs.readdirSync("./duplicate");
    if (files.length > 5) {
      // Delete the oldest file
      fs.unlinkSync("./duplicate/" + files[0]);
    }
  
    // Data duplication
    fs.readFile("./data/users.json", "utf8").then((data) => {
      fs.writeFile("./duplicate/users-" + Date.now() + ".json", data);
   });
 }
 catch(twentytwo) {
   console.log("Error duplicating data:", twentytwo);
 }
}, 1000 * 60 * 60); // 1 hour

app.listen({ port: 3005, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening on ${address}`);
});
