process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Handle uncaught exceptions to prevent server crashes
process.on('uncaughtException', (err) => {
  if (err.code === 'ECONNRESET') {
    console.log('Ignored ECONNRESET error:', err.message);
  } else {
    console.error('Uncaught Exception:', err);
    process.exit(1);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit for rejections, just log
});

let config = require("./config.json");
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
const fetch = require('node-fetch');

const openrouter_models = [
    "x-ai/grok-4.1-fast",
" meituan/longcat-flash-chat",

"z-ai/glm-4.5-air",
"arliai/qwq-32b-arliai-rpr-v1",
"tngtech/deepseek-r1t-chimera",
"meituan/longcat-flash-chat",
"google/gemini-2.0-flash-exp",
]

async function databay() {
    const httpTxt = await fetch("https://raw.githubusercontent.com/TheSpeedX/PROXY-List/refs/heads/master/http.txt", {
        headers: {
            "Authorization": `Bearer ${config.github_token}`,
        }
    })
        .then(r => r.text());
    const socks4TxT = await fetch("https://raw.githubusercontent.com/TheSpeedX/PROXY-List/refs/heads/master/socks4.txt", {
        headers: {
            "Authorization": `Bearer ${config.github_token}`,
        }
    })
        .then(r => r.text());
    const socks5Txt = await fetch("https://raw.githubusercontent.com/TheSpeedX/PROXY-List/refs/heads/master/socks5.txt", {
        headers: {
            "Authorization": `Bearer ${config.github_token}`,
        }
    })
        .then(r => r.text());

    const http = httpTxt.split("\n").map(proxy => "http://" + proxy);
    const socks4 = socks4TxT.split("\n").map(proxy => "socks4://" + proxy);
    const socks5 = socks5Txt.split("\n").map(proxy => "socks5://" + proxy);

    return [...http, ...socks4, ...socks5];
}

async function misc() {
    const txt = await fetch("https://raw.githubusercontent.com/roosterkid/openproxylist/refs/heads/main/HTTPS_RAW.txt", {
        headers: {
            "Authorization": `Bearer ${config.github_token}`,
        }
    }).then(r => r.text());

    let set1 = txt.split("\n").map(proxy => "http://" + proxy);

    return set1;
}

async function handleSimple() {
    let txt = await fetch("https://raw.githubusercontent.com/iplocate/free-proxy-list/refs/heads/main/all-proxies.txt")
        .then(r => r.text());
    const txt2 = await fetch("https://raw.githubusercontent.com/monosans/proxy-list/refs/heads/main/proxies/all.txtt")
        .then(r => r.text());

    txt = txt.concat(txt2)
    

    return txt.split("\n");
}

// Global variable to store proxies
let GATHERED_PROXIES = [];

async function getProxies() {
    const [list1, list2 ] = await Promise.all([
        misc(),
        handleSimple()
    ]);

    const list = [...list1, ...list2 ];
    console.log(`Loaded ${list.length} proxies`);
    GATHERED_PROXIES = list; // Store in global variable instead of config
    updateProxyList(); // Update the proxy list used by the application
}

setInterval(function(){
  getProxies()
}, 1000 * 6000 * 60) // every hour, every minute, every second
getProxies()


const fileLocks = new Map(); 


async function safeWriteJSON(filePath, data) {
  
  while (fileLocks.get(filePath)) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  fileLocks.set(filePath, true);

  try {
    
    const jsonString = JSON.stringify(data, null, 2);
    JSON.parse(jsonString); 

    
    try {
      await fs.access(filePath);
      const backupPath = `${filePath}.backup`;
      await fs.copyFile(filePath, backupPath);
    } catch (e) {
      
    }

    
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    await fs.writeFile(tempPath, jsonString, 'utf8');

    
    const verification = JSON.parse(await fs.readFile(tempPath, 'utf8'));
    if (!verification) {
      throw new Error('Verification failed: temp file contains invalid data');
    }

    
    await fs.rename(tempPath, filePath);

    console.log(`[Safe Write] Successfully wrote to ${path.basename(filePath)}`);
    return true;
  } catch (error) {
    console.error(`[Safe Write] Failed to write ${filePath}:`, error.message);

    
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
    
    fileLocks.delete(filePath);
  }
}


async function safeReadJSON(filePath) {
  // Wait for any pending writes to complete
  while (fileLocks.get(filePath)) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  try {
    const content = await fs.readFile(filePath, 'utf8');


    if (!content || content.trim() === '') {
      console.error(`[Safe Read] File ${filePath} is empty, attempting backup restore`);
      throw new Error('Empty file detected');
    }

    const data = JSON.parse(content);
    return data;
  } catch (error) {
    console.error(`[Safe Read] Failed to read ${filePath}:`, error.message);


    try {
      const backupPath = `${filePath}.backup`;
      console.log(`[Safe Read] Attempting to restore from backup: ${backupPath}`);
      const backupContent = await fs.readFile(backupPath, 'utf8');
      const backupData = JSON.parse(backupContent);


      await fs.copyFile(backupPath, filePath);
      console.log(`[Safe Read] Successfully restored ${path.basename(filePath)} from backup`);

      return backupData;
    } catch (backupError) {
      console.error(`[Safe Read] Backup restore failed:`, backupError.message);
      throw new Error(`File corrupted and backup unavailable: ${filePath}`);
    }
  }
}


function loadProxies() {
  // Use proxies from the global GATHERED_PROXIES variable
  if (GATHERED_PROXIES && Array.isArray(GATHERED_PROXIES) && GATHERED_PROXIES.length > 0) {
    return GATHERED_PROXIES.filter(p => p && p.trim().length > 0);
  }
  
  // Fallback to config.proxyURL if GATHERED_PROXIES is empty
  if (config.proxyURL) {
    if (Array.isArray(config.proxyURL)) {
      return config.proxyURL.filter(p => p && p.trim().length > 0);
    }
    
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
          .filter(line => line.length > 0 && !line.startsWith('#'));
        
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
  
  // If no proxies in config, return empty array
  return [];
}

// Initialize proxy list as empty array
let PROXY_LIST = [];
let USE_PROXIES = false;

// Function to update proxy list and USE_PROXIES flag
function updateProxyList() {
  PROXY_LIST = loadProxies();
  USE_PROXIES = PROXY_LIST.length > 0;
  console.log(`[PROXY] Updated proxy list. USE_PROXIES: ${USE_PROXIES}, PROXY_LIST length: ${PROXY_LIST.length}`);
}

// Initial update
updateProxyList();

// Update proxy list when getProxies() updates config.proxyURL
const originalGetProxies = getProxies;
getProxies = async function() {
  await originalGetProxies();
  updateProxyList();
};

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

  
  let availableProxies = PROXY_LIST.filter(p => {
    if (FAILED_PROXIES.has(p)) return false;

    const lastUsed = PROXY_LAST_USED.get(p);
    if (lastUsed && (now - lastUsed) < PROXY_COOLDOWN_MS) {
      return false; 
    }
    return true;
  });

  
  if (availableProxies.length === 0) {
    availableProxies = PROXY_LIST.filter(p => !FAILED_PROXIES.has(p));

    if (availableProxies.length === 0) {
      console.log('All proxies failed, resetting failed list and retrying...');
      FAILED_PROXIES.clear();
      PROXY_LAST_USED.clear();
      availableProxies = PROXY_LIST;
    } else {
      console.log('All proxies in cooldown, using least recently used proxy...');
      
      availableProxies.sort((a, b) => {
        const aTime = PROXY_LAST_USED.get(a) || 0;
        const bTime = PROXY_LAST_USED.get(b) || 0;
        return aTime - bTime;
      });
    }
  }

  
  const proxy = availableProxies[Math.floor(Math.random() * availableProxies.length)];
  PROXY_LAST_USED.set(proxy, now);
  return proxy;
}


function markProxyWorking(proxyUrl) {
  WORKING_PROXIES.add(proxyUrl);
  FAILED_PROXIES.delete(proxyUrl);
}


function markProxyFailed(proxyUrl) {
  FAILED_PROXIES.add(proxyUrl);
  console.log(`Proxy marked as failed: ${proxyUrl} (${FAILED_PROXIES.size}/${PROXY_LIST.length} failed)`);
}

if (USE_PROXIES) {
  console.log("[PROXY] Proxy on")
} else {
    console.log("[PROXY] Proxy off")
}





function createCustomAgent(proxyUrl = null, targetUrl = 'https://api.deepinfra.com/v1/chat/completions') {
  if (proxyUrl) {
    
    const safeProxyUrl = (proxyUrl);

    console.log(`[Agent] Creating agent for proxy: ${safeProxyUrl}`);
    console.log(`[Agent] Target URL: ${targetUrl}`);

    
    let agent;
    const proxyProtocol = safeProxyUrl.split(':')[0].toLowerCase();
    const targetProtocol = targetUrl.startsWith('https') ? 'https' : 'http';

    if (proxyProtocol === 'socks5' || proxyProtocol === 'socks5h' || proxyProtocol === 'socks4' || proxyProtocol === 'socks') {

      console.log(`[Agent] Using SocksProxyAgent for ${proxyProtocol} proxy`);
      agent = new SocksProxyAgent(safeProxyUrl, {
        keepAlive: true,
        keepAliveMsecs: 1000,
        family: 4,
        timeout: 30000,
        rejectUnauthorized: false // Disable SSL certificate verification
      });
    } else if (targetProtocol === 'https') {

      console.log(`[Agent] Using HttpsProxyAgent for HTTPS target`);
      agent = new HttpsProxyAgent(safeProxyUrl, {
        keepAlive: true,
        keepAliveMsecs: 1000,
        family: 4,
        timeout: 30000,
        rejectUnauthorized: false // Disable SSL certificate verification
      });
    } else {

      console.log(`[Agent] Using HttpProxyAgent for HTTP target`);
      agent = new HttpProxyAgent(safeProxyUrl, {
        keepAlive: true,
        keepAliveMsecs: 1000,
        family: 4,
        timeout: 30000,
        rejectUnauthorized: false // Disable SSL certificate verification
      });
    }

    // Add error handler to ignore ECONNRESET errors that don't crash the server
    if (agent && typeof agent.on === 'function') {
      agent.on('error', (err) => {
        if (err.code === 'ECONNRESET') {
          console.log(`[Agent] Ignored ECONNRESET error on proxy: ${safeProxyUrl}`);
        } else {
          console.error(`[Agent] Proxy agent error:`, err.message);
        }
      });
    }

    console.log(`[Agent] ✓ Agent created successfully`);
    return agent;
  } else {
    
    console.warn(`[Agent] WARNING: Creating direct HTTPS agent (no proxy - IP WILL BE EXPOSED)`);
    console.warn(`[Agent] This should only be used for testing purposes!`);
    return new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 1000,
      family: 4,
      timeout: 30000,
      rejectUnauthorized: false // Disable SSL certificate verification for direct connections too
    });
  }
}





const app = fastify({
  logger: false,
});

app.register(require("@fastify/cors"), {
  origin: "*",
});


app.register(require("@fastify/rate-limit"), {
  global: true,
  max: 30, 
  timeWindow: "1 minute", 
  cache: 10000, 
  allowList: [], 
  continueExceeding: true, 
  skipOnError: false, 

  
  keyGenerator: function (request) {
    
    const forwarded = request.headers['x-forwarded-for'];
    const realIp = request.headers['x-real-ip'];
    const cfConnectingIp = request.headers['cf-connecting-ip'];

    
    if (forwarded) {
      const ips = forwarded.split(',').map(ip => ip.trim());
      return ips[0];
    }

    
    if (cfConnectingIp) {
      return cfConnectingIp;
    }

    
    if (realIp) {
      return realIp;
    }

    
    return request.ip;
  },

  
  errorResponseBuilder: function (request, context) {
    return {
      statusCode: 429,
      error: 'Too Many Requests',
      message: `Rate limit exceeded. You can make ${context.max} requests per ${context.after}. Please try again later.`,
      retryAfter: context.ttl, 
    };
  },

  
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


function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}


function estimateMessageTokens(message) {
  let tokens = 0;
  if (typeof message.content === 'string') {
    tokens += estimateTokens(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text' && part.text) {
        tokens += estimateTokens(part.text);
      }
      
      if (part.type === 'image_url') {
        tokens += 85; 
      }
    }
  }
  if (message.role) {
    tokens += 4; 
  }
  return tokens;
}


function trimMessagesToTokenLimit(messages, maxTokens) {
  if (!messages || messages.length === 0) return messages;

  
  let totalTokens = messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);

  if (totalTokens <= maxTokens) {
    return messages; 
  }

  
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

  
  if (otherMessages.length === 0 && systemMessage) {
    const systemTokens = estimateMessageTokens(systemMessage);
    if (systemTokens > maxTokens) {
      
      if (typeof systemMessage.content === 'string') {
        const targetLength = Math.floor(maxTokens * 4 * 0.95); 
        systemMessage.content = systemMessage.content.slice(0, targetLength) + "... [truncated]";
      }
    }
    return [systemMessage];
  }

  
  const systemTokens = systemMessage ? estimateMessageTokens(systemMessage) : 0;
  let availableTokens = maxTokens - systemTokens;

  
  if (availableTokens < maxTokens * 0.3) {
    const targetSystemTokens = Math.floor(maxTokens * 0.3);
    if (systemMessage && typeof systemMessage.content === 'string') {
      const targetLength = Math.floor(targetSystemTokens * 4 * 0.95);
      systemMessage.content = systemMessage.content.slice(0, targetLength) + "... [truncated]";
    }
    availableTokens = maxTokens - targetSystemTokens;
  }

  
  const trimmedMessages = [];
  let currentTokens = 0;

  for (let i = otherMessages.length - 1; i >= 0; i--) {
    const msgTokens = estimateMessageTokens(otherMessages[i]);
    if (currentTokens + msgTokens <= availableTokens) {
      trimmedMessages.unshift(otherMessages[i]);
      currentTokens += msgTokens;
    } else {
      break; 
    }
  }

  
  return systemMessage ? [systemMessage, ...trimmedMessages] : trimmedMessages;
}

app.get("/api/make-key", async function (request, reply) {
  
  let users = await safeReadJSON("./data/users.json");

  
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
    if (
      users[request.body.key].lastAdViewedDate !== 0 &&
      users[request.body.key].lastAdViewedDate + 43200000 < Date.now()
    ) {
      users[request.body.key].balance = 0;
      await safeWriteJSON("./data/users.json", users);
    }

    reply.send(users[request.body.key]);
  } catch (error) {
    console.error("Check key error:", error);
    return reply.status(500).send({ error: "Internal server error" });
  }
});


app.post("/api/getAdUrl", async function (request, reply) {
  let response = await fetch(
    `https://api.cuty.io/quick?token=${config.cutyio}&ad=1&url=${
      request.body.url
    }&alias=${crypto
      .randomUUID()
      .replaceAll("-", "")
      .slice(0, 12)}&format=text`
  );
  reply.send(
    JSON.stringify({
      "adUrl":await response.text()
    }) );
});

app.post("/api/getCredits", async function (request, reply) {
  try {
    if (!request.body || !request.body.key) {
      return reply.status(400).send({ error: "Missing key in request" });
    }

    let users = await safeReadJSON("./data/users.json");
    if (!users[request.body.key]) {
      return reply.status(404).send({ error: "Key not found" });
    }

    
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
  let model = modelParts[0];
  const prompt = modelParts[1];

  if (openrouter_models.includes(model)) {
    //model = model + ":free"
  }

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

  
  if (newBody.messages && newBody.messages.length > 0 && config.maxTokens) {
    newBody.messages = trimMessagesToTokenLimit(newBody.messages, config.maxTokens);
  }

  newBody.model = model;

  request.body = newBody;

  return request;
}

app.all("/v1/chat/completions", async function (request, reply) {
  

  let stats = await safeReadJSON("stats.json");
  stats.totalRequests += 1;
  stats.activeRequests += 1;
  await safeWriteJSON("stats.json", stats);

  const isStreaming =
    request.headers["accept"] === "text/event-stream" ||
    request.body?.stream === true;

  

  if (openrouter_models.includes((request.body.model).split(":")[0])) {
    request.body.model = request.body.model
    await proxyToEndpoint(
    preprocessRequest(request),
    reply,
    "https://g4f.dev/api/openrouter/chat/completions",
    isStreaming
  );
    return
  }

  await proxyToEndpoint(
    preprocessRequest(request),
    reply,
    "https://api.deepinfra.com/v1/chat/completions",
    isStreaming
  );
});





app.get("/v1/models", async function (request, reply) {
  let models = [
    "MiniMaxAI/MiniMax-M2",
    "moonshotai/Kimi-K2-Thinking",
    "deepseek-ai/DeepSeek-V3-0324",
    "x-ai/grok-4.1-fast",
    "deepseek-ai/DeepSeek-R1-0528",
    "deepseek-ai/DeepSeek-R1-0528-Turbo",
    "deepseek-ai/DeepSeek-V3.2-Exp",
    "deepseek-ai/DeepSeek-V3.1-Terminus",
    "deepseek-ai/DeepSeek-V3.1",
    "Qwen/Qwen3-235B-A22B-Instruct-2507",
    "Qwen/Qwen3-235B-A22B-Thinking-2507",
    "Qwen/Qwen3-Next-80B-A3B-Instruct",
    "Qwen/Qwen3-Next-80B-A3B-Thinking",
    "moonshotai/Kimi-K2-Instruct-0905",
    "Qwen/Qwen3-14B",
    "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
    "mistralai/Mistral-Small-3.1-24B-Instruct-2503",
    "google/gemma-3-27b-it",
    "google/gemma-3-12b-it",
    "google/gemma-2-27b-it",
    "google/gemma-2-9b-it",
  ];

  let new_models = []

  let prompts = [
    "DefaultV4",
"DefaultV3",
"DefaultV2",
"DefaultV1",
"Cheese",
"Pupi",
"Livechat",
"Brbie",
"Infdevv",
"Anrp",
"Humour",
"Dacm",
"Teto",
"Status",
"Affection",
"Unpositive",
"Slop",
"Reasoning"
  ]

  for (let model of models){
    for (let prompt of prompts){
      new_models.push(model + ":" + prompt)
    }
  }

  // merge
  models = models.concat(new_models);

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

    
    let key = headers.authorization.split(" ")[1];

    
    let users = await safeReadJSON("./data/users.json");

    
    if (!users[key]) {
      return reply.status(401).send({ error: "Invalid API key" });
    }

    
    
    if (users[key].balance < 1) {
      console.log("[Proxy] Insufficient credits: " + users[key].balance);
      return reply.status(402).send({ error: "Insufficient credits" });
    }

    // Check for expired credits (12 hours since last ad)
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

    delete headers.authorization;
    delete headers.referer;
    delete headers.origin;
    delete headers.host;
    delete headers.connection;

    
    delete headers['x-forwarded-for'];
    delete headers['x-real-ip'];
    delete headers['x-client-ip'];
    delete headers['x-remote-ip'];
    delete headers['true-client-ip'];
    delete headers['cf-connecting-ip'];
    delete headers['forwarded'];
    delete headers['via'];

    
    delete headers['X-Forwarded-For'];
    delete headers['X-Real-IP'];
    delete headers['X-Client-IP'];
    delete headers['X-Remote-IP'];
    delete headers['True-Client-IP'];
    delete headers['CF-Connecting-IP'];
    delete headers['Forwarded'];
    delete headers['Via'];

    
    function isOpenAIError(data) {
      if (!data || !data.error) return false;
      const errorMsg = (data.error.message || '').toLowerCase();
      return errorMsg.includes('busy') ||
             errorMsg.includes('try again') ||
             errorMsg.includes('overloaded') ||
             errorMsg.includes('rate limit') ||
             errorMsg.includes('unavailable');
    }


    async function attemptRequest(modelToUse, canFallback = true) {
      const requestBody = { ...request.body, model: modelToUse };

      // Race condition: try multiple proxies simultaneously
      async function singleAttempt(proxyUrl) {
        try {
          if (proxyUrl) {
            console.log(`[Race] Starting request with proxy: ${proxyUrl}`);
          } else {
            console.log(`[Request] Using direct connection (no proxy)`);
          }

          const agent = createCustomAgent(proxyUrl, endpoint);
          const abortController = new AbortController();
          const timeoutId = setTimeout(() => abortController.abort(), 30000);

          const fetchOptions = {
            method: "POST",
            headers: headers,
            body: JSON.stringify(requestBody),
            agent: agent,
            signal: abortController.signal
          };

          try {
            const response = await fetch(endpoint, fetchOptions);
            clearTimeout(timeoutId);

            console.log(`[Race] Response from ${proxyUrl || 'direct'}: ${response.status}`);

            // Check if this is a good response
            if (response.status === 403 && proxyUrl) {
              console.warn(`✗ Got 403 Forbidden with proxy: ${proxyUrl}`);
              markProxyFailed(proxyUrl);
              // Return null to indicate failure instead of throwing
              return null;
            }

            if (response.status === 503 && proxyUrl) {
              console.warn(`✗ Got 503 with proxy: ${proxyUrl}`);
              markProxyFailed(proxyUrl);
              // Return null to indicate failure instead of throwing
              return null;
            }

            if (response.status === 500 && proxyUrl) {
              console.warn(`✗ Got 500 with proxy: ${proxyUrl}`);
              markProxyFailed(proxyUrl);
              // Return null to indicate failure instead of throwing
              return null;
            }

            if (response.status === 400 && proxyUrl) {
              console.warn(`✗ Got 500 with proxy: ${proxyUrl}`);
              markProxyFailed(proxyUrl);
              // Return null to indicate failure instead of throwing
              return null;
            }

            if (response.status != 200 && proxyUrl) {
              console.warn(`✗ Got unknown error with proxy: ${proxyUrl}`);
              markProxyFailed(proxyUrl);
              // Return null to indicate failure instead of throwing
              return null;
            }

            // Mark proxy as working if successful
            if (proxyUrl && response.ok) {
              markProxyWorking(proxyUrl);
            }

            // Return the response for any status code (including 200, 4xx, 5xx)
            // The caller will decide what to do with the response
            return { response, proxyUrl };
          } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError.name === 'AbortError') {
              console.warn(`✗ Request timeout with proxy ${proxyUrl || 'direct'}: ${fetchError.message}`);
              if (proxyUrl) {
                markProxyFailed(proxyUrl);
              }
              // Return null to indicate failure instead of throwing
              return null;
            }
            // Handle ECONNRESET and other network errors gracefully
            if (fetchError.code === 'ECONNRESET' ||
                fetchError.code === 'CERT_HAS_EXPIRED' ||
                fetchError.code === 'ECONNREFUSED' ||
                fetchError.message.includes('Client network socket disconnected') ||
                fetchError.message.includes('certificate has expired') ||
                fetchError.message.includes('connect ECONNREFUSED') ||
                fetchError.message.includes('connect ETIMEDOUT')) {
              console.warn(`✗ Network error with proxy ${proxyUrl || 'direct'}: ${fetchError.message}`);
              if (proxyUrl) {
                markProxyFailed(proxyUrl);
              }
              // Return null to indicate failure instead of throwing
              return null;
            }
            // Handle any other errors
            console.warn(`✗ Error with proxy ${proxyUrl || 'direct'}: ${fetchError.message}`);
            if (proxyUrl) {
              markProxyFailed(proxyUrl);
            }
            // Return null to indicate failure instead of throwing
            return null;
          }
        } catch (error) {
          const errorType = error.code || error.name || 'UNKNOWN';
          console.warn(`✗ Proxy ${proxyUrl || 'direct'} failed: ${errorType} - ${error.message}`);
          // Don't throw the error, just mark the proxy as failed and continue
          if (proxyUrl) {
            markProxyFailed(proxyUrl);
          }
          // Return null to indicate failure instead of throwing
          return null;
        }
      }

      let response = null;
      let usedProxy = null;

      if (USE_PROXIES && PROXY_LIST.length > 0) {
        // Race multiple proxies simultaneously with retry logic
        const numProxiesPerRace = Math.min(config.proxiesPerRound || 4, PROXY_LIST.length);
        const now = Date.now();
        const availableProxies = PROXY_LIST.filter(p => !FAILED_PROXIES.has(p));
        const proxyPool = availableProxies.length > 0 ? availableProxies : PROXY_LIST;

        const usedProxies = new Set(); // Track which proxies we've already tried
        let raceAttempt = 0;
        const maxRaceAttempts = Math.ceil(proxyPool.length / numProxiesPerRace);

        // Keep racing with different sets of proxies until one succeeds or we run out
        while (raceAttempt < maxRaceAttempts) {
          raceAttempt++;

          // Pick random proxies that we haven't used yet
          const proxiesToTry = [];
          let attempts = 0;
          const maxPickAttempts = proxyPool.length * 2; // Prevent infinite loop

          while (proxiesToTry.length < numProxiesPerRace && attempts < maxPickAttempts) {
            attempts++;
            const randomIndex = Math.floor(Math.random() * proxyPool.length);
            const proxy = proxyPool[randomIndex];
            if (!usedProxies.has(proxy)) {
              proxiesToTry.push(proxy);
              usedProxies.add(proxy);
              PROXY_LAST_USED.set(proxy, now);
            }
          }

          // If we couldn't get enough fresh proxies, we've tried everything
          if (proxiesToTry.length === 0) {
            console.log(`[Race] No more untried proxies available, resetting...`);
            FAILED_PROXIES.clear();
            usedProxies.clear();

            // Try one final race with the first 4 proxies
            const finalProxies = proxyPool.slice(0, numProxiesPerRace);
            finalProxies.forEach(p => PROXY_LAST_USED.set(p, now));

            console.log(`[Race] Final attempt with ${finalProxies.length} proxies...`);
            try {
              // Create an array of promises that will resolve with the first successful response
              const racePromises = finalProxies.map(proxy =>
                singleAttempt(proxy).then(result => {
                  // Only resolve with results that have a successful status (200)
                  if (result && result.response && result.response.status === 200) {
                    console.log(`✓ First successful response (200) from proxy: ${proxy}`);
                    return result;
                  }
                  // For non-200 responses, we still return them but they won't be the "winner"
                  // unless all other proxies fail
                  return result;
                })
              );

              // Race all proxy attempts - first one to resolve wins!
              const results = await Promise.allSettled(racePromises);
              
              // Find the first successful result with status 200
              let successfulResult = null;
              for (const result of results) {
                if (result.status === 'fulfilled' && result.value !== null) {
                  // Check if this is a 200 response
                  if (result.value.response && result.value.response.status === 200) {
                    successfulResult = result.value;
                    console.log(`✓ Winner (200 response): ${result.value.proxyUrl}`);
                    break; // First 200 response wins!
                  }
                  // If we don't have a successful result yet, store the first non-null result
                  if (!successfulResult) {
                    successfulResult = result.value;
                  }
                }
              }

              if (successfulResult) {
                response = successfulResult.response;
                usedProxy = successfulResult.proxyUrl;
                console.log(`✓ Final attempt winner: ${usedProxy} with status ${response.status}`);
                break;
              } else {
                console.error(`[Race] All final proxies failed. Unable to complete request.`);
                throw new Error('All proxies exhausted after multiple race attempts');
              }
            } catch (error) {
              console.error(`[Race] All final proxies failed. Unable to complete request.`);
              throw new Error('All proxies exhausted after multiple race attempts');
            }
          }

          console.log(`[Race] Attempt ${raceAttempt}/${maxRaceAttempts}: Racing ${proxiesToTry.length} proxies simultaneously...`);

          // Create an array of promises that will resolve with the first successful response
          const racePromises = proxiesToTry.map(proxy =>
            singleAttempt(proxy).then(result => {
              // Only resolve with results that have a successful status (200)
              if (result && result.response && result.response.status === 200) {
                console.log(`✓ First successful response (200) from proxy: ${proxy}`);
                return result;
              }
              // For non-200 responses, we still return them but they won't be the "winner"
              // unless all other proxies fail
              return result;
            })
          );

          try {
            // Race all proxy attempts - first one to resolve wins!
            // We use Promise.allSettled to handle all promises and find the first successful one
            const results = await Promise.allSettled(racePromises);
            
            // Find the first successful result with status 200
            let successfulResult = null;
            for (const result of results) {
              if (result.status === 'fulfilled' && result.value !== null) {
                // Check if this is a 200 response
                if (result.value.response && result.value.response.status === 200) {
                  successfulResult = result.value;
                  console.log(`✓ Winner (200 response): ${result.value.proxyUrl}`);
                  break; // First 200 response wins!
                }
                // If we don't have a successful result yet, store the first non-null result
                if (!successfulResult) {
                  successfulResult = result.value;
                }
              }
            }

            if (successfulResult) {
              response = successfulResult.response;
              usedProxy = successfulResult.proxyUrl;
              console.log(`✓ Winner (attempt ${raceAttempt}): ${usedProxy} with status ${response.status}`);
              break; // Success! Exit the retry loop
            } else {
              // All proxies in this batch failed
              console.error(`[Race] All ${proxiesToTry.length} proxies failed in attempt ${raceAttempt}`);

              // If this was our last attempt, try a direct connection
              if (raceAttempt >= maxRaceAttempts || usedProxies.size >= proxyPool.length) {
                console.error(`[Race] Exhausted all proxies after ${raceAttempt} attempts`);
                console.log(`[Race] Trying direct connection as last resort...`);
                
                try {
                  const result = await singleAttempt(null);
                  if (result !== null) {
                    response = result.response;
                    usedProxy = result.proxyUrl;
                    console.log(`✓ Direct connection successful`);
                    break;
                  } else {
                    console.error(`[Race] Direct connection also failed`);
                    throw new Error('All proxies and direct connection failed');
                  }
                } catch (directError) {
                  console.error(`[Race] Direct connection also failed: ${directError.message}`);
                  throw new Error('All proxies and direct connection failed');
                }
              }

              // Otherwise, continue to next race attempt with different proxies
              console.log(`[Race] Retrying with different proxies...`);
            }
          } catch (error) {
            // Handle any other errors
            console.error(`[Race] Error in race attempt ${raceAttempt}:`, error);
            throw error;
          }
        }

        if (!response) {
          throw new Error('Failed to get response after all race attempts');
        }
      } else {
        // No proxies configured, use direct connection
        const result = await singleAttempt(null);
        if (result !== null) {
          response = result.response;
          usedProxy = result.proxyUrl;
        } else {
          throw new Error('Direct connection failed');
        }
      }

      if (!response) {
        throw new Error(`Request failed for model ${modelToUse}`);
      }

      
      if (!response.ok) {
        console.error(`HTTP error for model ${modelToUse}:`, {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries())
        });
      }

      
      if (isStreaming) {
        
        if (!response.ok && canFallback && promptList.fallbacks[modelToUse]) {
          console.log(`Model ${modelToUse} failed with status ${response.status}, trying fallback: ${promptList.fallbacks[modelToUse]}`);
          return attemptRequest(promptList.fallbacks[modelToUse], false);
        }
        return response;
      } else {
        
        const data = await response.json();

        
        if (data.error) {
          console.error(`API error for model ${modelToUse}:`, {
            error: data.error,
            status: response.status
          });
        }

        
        // Check if this is a successful response (status 200)
        if (response.status === 200) {
          return { response, data };
        }
        
        // Handle error responses
        if (isOpenAIError(data) && canFallback && promptList.fallbacks[modelToUse]) {
          console.log(`Model ${modelToUse} returned error: ${data.error.message}, trying fallback: ${promptList.fallbacks[modelToUse]}`);
          return attemptRequest(promptList.fallbacks[modelToUse], false);
        }
        
        // For other non-200 responses, throw an error to trigger fallback or retry
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    }

    const originalModel = request.body.model;
    const canFallback = promptList.fallbacks.hasOwnProperty(originalModel);

    if (isStreaming) {
      const response = await attemptRequest(originalModel, canFallback);
      if (!response) {
        throw new Error('All proxy attempts failed');
      }
      
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
          // check openai content
          reply.raw.write(chunk);

          
          streamBuffer += chunk.toString();

          
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
                  
                }
              }
            }
          }
        }

        
        if (totalTokens === 0) {
          console.log("No token usage in stream, estimating...");
          
          if (request.body.messages) {
            totalTokens = request.body.messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
            
            totalTokens += 500; 
          }
          console.log(`Estimated tokens: ${totalTokens}`);
        } else {
          console.log(`API reported tokens: ${totalTokens}`);
        }

        
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
        
        console.error("Streaming error:", streamError);
        if (!reply.raw.writableEnded) {
          reply.raw.end();
        }
      }
    } else {
      try {
        const { data } = await attemptRequest(originalModel, canFallback);
        if (!data) {
          throw new Error('All proxy attempts failed');
        }
      } catch (attemptError) {
        console.error("Attempt request error:", attemptError);
        throw attemptError;
      }
      
      
      let totalTokens = 0;
      if (data.usage && data.usage.total_tokens) {
        totalTokens = data.usage.total_tokens;
        console.log(`API reported tokens: ${totalTokens} (non-streaming)`);
      } else {
        
        console.log("No token usage in response, estimating...");
        if (request.body.messages) {
          totalTokens = request.body.messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
          
          if (data.choices && data.choices[0] && data.choices[0].message) {
            totalTokens += estimateMessageTokens(data.choices[0].message);
          } else {
            totalTokens += 500; 
          }
        }
        console.log(`Estimated tokens: ${totalTokens}`);
      }

      const creditsToDeduct = Math.round(totalTokens * config.creditsPerToken * 100) / 100;
      console.log(`Deducting ${creditsToDeduct} credits for ${totalTokens} tokens (non-streaming)`);

      
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
    
    if (!reply.sent && !reply.raw.headersSent) {
      return reply.status(500).send({ error: "Internal server error" });
    }
  }
}

app.post("/v1/streaming/chat/completions", async function (request, reply) {
  await proxyToEndpoint(
    preprocessRequest(request),
    reply,
    "https://api.deepinfra.com/v1/chat/completions",
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

    
    const files = fs.readdirSync("./duplicate");
    if (files.length > 5) {
      
      fs.unlinkSync("./duplicate/" + files[0]);
    }
  
     
    fs.readFile("./data/users.json", "utf8").then((data) => {
      fs.writeFile("./duplicate/users-" + Date.now() + ".json", data);
   });
 }
 catch(twentytwo) {
   console.log("Error duplicating data:", twentytwo);
 }
}, 1000 * 60 * 60); 

app.listen({ port: 3000, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening on ${address}`);
});