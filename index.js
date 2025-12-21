process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const config = require("./config.json");

// Prevent server crashes from unhandled errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
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
const fetch = require('node-fetch');
const os = require("os");
const openrouter_models = [
    "x-ai/grok-4.1-fast",
    "meituan/longcat-flash-chat",
    "z-ai/glm-4.5-air",
    "arliai/qwq-32b-arliai-rpr-v1",
    "tngtech/deepseek-r1t-chimera",
    "google/gemini-2.0-flash-exp",
]

function shuffle(array) {
    if (array.length <= 5) {
        return array.slice().sort(() => 0.5 - Math.random());
    }

    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// Proxy list URLs - now loading from all lists and combining
const PROXY_LISTS = shuffle([
   //"https://raw.githubusercontent.com/iplocate/free-proxy-list/refs/heads/main/all-proxies.txt",
    //"https://raw.githubusercontent.com/iplocate/free-proxy-list/refs/heads/main/all-proxies.txt",    
    "https://raw.githubusercontent.com/infdevv/Composite-Autoproxy/refs/heads/main/misc_proxies.txt",
//  "https://raw.githubusercontent.com/infdevv/Composite-Autoproxy/refs/heads/main/instagram_proxies.txt",
       "https://raw.githubusercontent.com/infdevv/Composite-Autoproxy/refs/heads/main/google_proxies.txt",
   //"https://raw.githubusercontent.com/infdevv/Composite-Autoproxy/refs/heads/main/youtube_proxies.txt",
// "https://raw.githubusercontent.com/infdevv/Composite-Autoproxy/refs/heads/main/discord_proxies.txt",

])

const MEDIAN_LATENCY_THRESHOLD_MS = 20000; // Keeping for reference but no longer switching lists

let ALL_PROXIES = []; // Combined proxy pool from all lists
let PROXY_LIST = []; // Active proxy list (now same as ALL_PROXIES)
let USE_PROXIES = false;
let lastProxyLoadTime = 0;
const PROXY_LOAD_BACKOFF_MS = 5 * 60 * 1000; // 5 minutes backoff if load fails or no proxies

async function initializeProxies() {
    const now = Date.now();
    if (now - lastProxyLoadTime < PROXY_LOAD_BACKOFF_MS) {
        console.log(`[PROXY] Skipping proxy load due to backoff (${Math.ceil((PROXY_LOAD_BACKOFF_MS - (now - lastProxyLoadTime)) / 1000)}s remaining)`);
        return;
    }

    try {
        // Load proxies from all lists and combine them
        const allProxiesArrays = await Promise.all(PROXY_LISTS.map(async (listUrl) => {
            try {
                const response = await fetch(listUrl);
                const text = await response.text();
                return text.split("\n").filter(proxy => {
                    const trimmed = proxy.trim();
                    return trimmed !== "" && !trimmed.startsWith("#") &&
                        (trimmed.startsWith('http://') || trimmed.startsWith('https://') ||
                         trimmed.startsWith('socks4://') || trimmed.startsWith('socks5://'));
                });
            } catch (error) {
                console.error(`[PROXY] Error loading list ${listUrl}: ${error.message}`);
                return [];
            }
        }));

        // Combine all proxies from all lists
        ALL_PROXIES = allProxiesArrays.flat();
        PROXY_LIST = ALL_PROXIES; // Use combined list
        
        if (ALL_PROXIES.length === 0) {
            throw new Error('No valid proxies found in any list');
        }
        
        USE_PROXIES = true;
        lastProxyLoadTime = now;
        console.log(`[PROXY] Loaded ${ALL_PROXIES.length} total proxies from ${PROXY_LISTS.length} lists`);
    } catch (error) {
        console.error(`[PROXY] Error loading proxies: ${error.message}`);
        PROXY_LIST = [];
        ALL_PROXIES = [];
        USE_PROXIES = false;
        lastProxyLoadTime = now; // Still update time to start backoff
    }

    if (USE_PROXIES) {
        console.log("[PROXY] Proxy on")

        setInterval(async () => {
            console.log("[PROXY] Refreshing proxy list...");
            await initializeProxies();
        }, 35 * 60 * 1000); // 35 minutes
    } else {
        console.log("[PROXY] Proxy off")
    }
}

// Removed the checkAndSwitchProxyList function as we no longer switch lists

const FAILED_PROXIES = new Set();
const PROXY_LAST_USED = new Map();
const PROXY_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes cooldown to avoid reusing recently used proxies

function getNextProxy() {
    if (!USE_PROXIES || PROXY_LIST.length === 0) return null;

    const now = Date.now();
    let availableProxies = PROXY_LIST.filter(p => {
        if (FAILED_PROXIES.has(p)) return false;
        const lastUsed = PROXY_LAST_USED.get(p);
        if (lastUsed && (now - lastUsed) < PROXY_COOLDOWN_MS) return false;
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

function markProxyFailed(proxyUrl) {
    FAILED_PROXIES.add(proxyUrl);
    console.log(`Proxy marked as failed: ${proxyUrl} (${FAILED_PROXIES.size}/${PROXY_LIST.length} failed)`);
}

function createCustomAgent(proxyUrl = null, targetUrl = 'https://api.deepinfra.com/v1/chat/completions') {
    if (proxyUrl) {
        console.log(`[AGENT] Creating agent for proxy ${proxyUrl}`);
        const safeProxyUrl = proxyUrl;
        const proxyProtocol = safeProxyUrl.split(':')[0].toLowerCase();
        const targetProtocol = targetUrl.startsWith('https') ? 'https' : 'http';

        let agent;
        if (proxyProtocol.startsWith('socks')) {
            agent = new SocksProxyAgent(safeProxyUrl, {
                keepAlive: true,
                keepAliveMsecs: 1000,
                family: 4,
                timeout: 30000
            });
        } else if (targetProtocol === 'https') {
            agent = new HttpsProxyAgent(safeProxyUrl, {
                keepAlive: true,
                keepAliveMsecs: 1000,
                family: 4,
                timeout: 30000
            });
        } else {
            agent = new HttpProxyAgent(safeProxyUrl, {
                keepAlive: true,
                keepAliveMsecs: 1000,
                family: 4,
                timeout: 30000
            });
        }
        return agent;
    } else {
        return new https.Agent({
            keepAlive: true,
            keepAliveMsecs: 1000,
            family: 4,
            timeout: 30000
        });
    }
}

const app = fastify({ logger: false });

app.register(require("@fastify/cors"), { origin: "*" });
app.register(require("@fastify/rate-limit"), {
    global: true,
    max: 50,
    timeWindow: "1 minute",
    cache: 10000,
});
app.register(require("@fastify/static"), {
    root: path.resolve(__dirname, "./public"),
    prefix: "/",
    decorateReply: false,
});

async function safeReadJSON(filePath) {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
}


async function safeWriteJSON(filePath, data, maxRetries = 5) {
    const tempDir = os.tmpdir();
    const tempFileName = `${path.basename(filePath)}.${crypto.randomUUID()}.tmp`;
    const tempFilePath = path.join(tempDir, tempFileName);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        let fd = null;
        try {
            // Create unique temp file in system temp directory
            fd = await fs.open(tempFilePath, 'wx');

            // Write the data
            await fd.write(JSON.stringify(data, null, 2));

            // Ensure data is written to disk (platform-independent)
            await fd.sync();

            // Close the file before renaming
            await fd.close();
            fd = null;

            // Atomic rename operation (can move across directories)
            await fs.rename(tempFilePath, filePath);

            // Success!
            return;

        } catch (error) {
            // Clean up resources if they were opened
            if (fd) {
                try {
                    await fd.close();
                } catch (closeError) {
                    // Ignore close errors
                }
            }

            // Clean up temp file if it exists
            try {
                await fs.unlink(tempFilePath);
            } catch (unlinkError) {
                // Ignore unlink errors (file might not exist)
            }

            // If it's the last attempt, throw the error
            if (attempt === maxRetries) {
                throw new Error(`Failed to write file after ${maxRetries + 1} attempts: ${error.message}`);
            }

            // Exponential backoff with jitter for concurrent access
            const delay = Math.min(100 * Math.pow(2, attempt), 1000) + Math.random() * 100;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

app.get("/api/make-key", async function (request, reply) {
    let users = await safeReadJSON("./data/users.json");
    let uuid = crypto.randomUUID();
    users[uuid] = { balance: 0, lastAdViewedDate: 0 };
    await safeWriteJSON("./data/users.json", users);
    reply.send({ key: uuid, ...users[uuid] });
});

app.get("/api/balance", async function (request, reply) {
    try {
        // Extract key from Authorization header in "Bearer <key>" format
        let key = null;
        
        if (request.headers.authorization && request.headers.authorization.includes(" ")) {
            key = request.headers.authorization.split(" ")[1];
        } else if (request.body && request.body.key) {
            // Fallback to request body for compatibility
            key = request.body.key;
        }
        
        if (!key) {
            return reply.status(400).send({ error: "Missing key in request" });
        }
        
        let users = await safeReadJSON("./data/users.json");
        if (!users[key]) {
            return reply.status(404).send({ error: "Key not found" });
        }
        
        reply.send(users[key]);
    } catch (error) {
        console.error("Error in /api/balance:", error);
        reply.status(500).send({ error: "Internal server error" });
    }
});

app.post("/api/getAdUrl", async function (request, reply) {
    try {
        // Check if URL is provided
        if (!request.body || !request.body.url) {
            return reply.status(400).send({ error: "Missing URL parameter" });
        }

        const targetUrl = encodeURIComponent(request.body.url);
        const alias = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
        
        const response = await fetch(
            `https://api.cuty.io/quick?token=${config.cutyio}&ad=1&url=${targetUrl}&alias=${alias}&format=text`
        );
        
        if (!response.ok) {
            console.error(`Cuty.io API error: ${response.status} ${response.statusText}`);
            return reply.status(500).send({ error: "Failed to get ad URL" });
        }
        
        const adUrl = await response.text();
        reply.send({ "adUrl": adUrl });
    } catch (error) {
        console.error("Error in /api/getAdUrl:", error);
        reply.status(500).send({ error: "Internal server error" });
    }
});

app.post("/api/getUserCredits", async function (request, reply) {
    if (!request.body || !request.body.key) {
        return reply.status(400).send({ error: "Missing key in request" });
    }

    let users = await safeReadJSON("./data/users.json");
    if (!users[request.body.key]) {
        return reply.status(404).send({ error: "Key not found" });
    }

    if (users[request.body.key].lastAdViewedDate !== 0 && users[request.body.key].lastAdViewedDate + 21600000 > Date.now()) {
        const timeLeft = 21600000 - (Date.now() - users[request.body.key].lastAdViewedDate); // 6 hours
        const hoursLeft = Math.ceil(timeLeft / 21600000);
        return reply.status(429).send({ error: `Please wait ${hoursLeft} hours between ad views` });
    }

    users[request.body.key].lastAdViewedDate = Date.now();
    users[request.body.key].balance = Math.round((users[request.body.key].balance + config.creditsPerAd) * 100) / 100;
    await safeWriteJSON("./data/users.json", users);
    reply.send({
        success: true,
        balance: users[request.body.key].balance,
        creditAmount: config.creditsPerAd
    });
});

// Helper function to calculate median latency
function calculateMedianLatency(latencies) {
    if (latencies.length === 0) return 0;
    
    // Sort the latencies to find the median
    const sortedLatencies = [...latencies].sort((a, b) => a - b);
    const middle = Math.floor(sortedLatencies.length / 2);
    
    // If odd number of elements, return the middle one
    // If even, return the average of the two middle ones
    if (sortedLatencies.length % 2 === 0) {
        return Math.round((sortedLatencies[middle - 1] + sortedLatencies[middle]) / 2);
    } else {
        return sortedLatencies[middle];
    }
}

// Helper function to calculate stability level
function calculateStabilityLevel(stats) {
    const total = stats.successfulRequests + stats.failedRequests;
    if (total === 0) return 2; // Default to "decent" if no data
    
    const successRate = stats.successfulRequests / total;
    
    if (successRate >= 0.9) return 3; // Fast (90%+ success rate)
    if (successRate >= 0.7) return 2; // Decent (70-89% success rate)
    return 1; // Slow (<70% success rate)
}

app.get("/api/statistics", async function (request, reply) {
    const stats = await safeReadJSON("stats.json");
    reply.send({
        totalRequests: stats.totalRequests,
        activeRequests: stats.activeRequests,
        successfulRequests: stats.successfulRequests,
        failedRequests: stats.failedRequests,
        averageLatency: calculateMedianLatency(stats.latencies),
        stabilityLevel: calculateStabilityLevel(stats)
    });
});

app.get("/api/service", async function (request, reply) {
    const stats = await safeReadJSON("stats.json");
    const averageLatency = calculateMedianLatency(stats.latencies);
    const stabilityLevel = calculateStabilityLevel(stats);
    
    reply.send({
        latency: averageLatency,
        stability_level: stabilityLevel
    });
});

function estimateMessageTokens(message) {
    let total = 0;
    if (message.content) {
        if (typeof message.content === 'string') {
            total += Math.ceil(message.content.length / 4);
        } else if (Array.isArray(message.content)) {
            const textParts = message.content.filter(part => part.type === 'text');
            textParts.forEach(part => {
                if (part.text) total += Math.ceil(part.text.length / 4);
            });
        }
    }
    return total;
}

function preprocessRequest(request) {
    if (!request.body || !request.body.model) return request;

    delete request.headers["content-length"];
    delete request.headers["Content-Length"];

    const modelParts = request.body.model.split(":");
    let model = modelParts[0];
    const prompt = modelParts[1];

    const newBody = JSON.parse(JSON.stringify(request.body));

    if (prompt && promptList.availablePrompts.includes(prompt)) {
        if (newBody.messages && newBody.messages.length > 0) {
            if (typeof newBody.messages[0].content === 'string') {
                newBody.messages[0].content = promptList.prompts[prompt] + newBody.messages[0].content;
            } else if (Array.isArray(newBody.messages[0].content)) {
                const textPart = newBody.messages[0].content.find(part => part.type === 'text');
                if (textPart) {
                    textPart.text = promptList.prompts[prompt] + textPart.text;
                }
            }
        }
    }


    newBody.model = model;
    request.body = newBody;
    return request;
}

// Helper function to update request statistics
async function updateRequestStats(latency, successful) {
    try {
        let stats = await safeReadJSON("stats.json");
        
        if (successful) {
            stats.successfulRequests += 1;
            if (latency !== null) {
                stats.latencies.push(latency);
                // Keep only the last maxLatencies entries
                if (stats.latencies.length > stats.maxLatencies) {
                    stats.latencies = stats.latencies.slice(-stats.maxLatencies);
                }
            }
        } else {
            stats.failedRequests += 1;
        }
        
        stats.activeRequests = Math.max(0, stats.activeRequests - 1);
        await safeWriteJSON("stats.json", stats);
    } catch (error) {
        console.error('Error updating request stats:', error);
    }
}

async function proxyToEndpoint(request, reply, endpoint, isStreaming = false) {
    let stats = await safeReadJSON("stats.json");
    stats.totalRequests += 1;
    stats.activeRequests += 1;
    await safeWriteJSON("stats.json", stats);
    
    const requestStartTime = Date.now();
    let firstChunkTime = null;
    let requestSuccessful = false;
    let latency = null;

    let headers = { ...request.headers };
    if (!headers.authorization || !headers.authorization.includes(" ")) {
        return reply.status(401).send({ error: "Missing or invalid authorization header" });
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

    if (users[key].lastAdViewedDate !== 0 && users[key].lastAdViewedDate + 21600000 < Date.now()) {
        users[key].balance = 0;
        await safeWriteJSON("./data/users.json", users);
        return reply.status(402).send({ error: "Credits expired. Please view an ad first." });
    }

    const headersToDelete = [
        'authorization', 'referer', 'origin', 'host', 'connection',
        'x-forwarded-for', 'x-real-ip', 'x-client-ip', 'x-remote-ip',
        'true-client-ip', 'cf-connecting-ip', 'forwarded', 'via'
    ];
    
    headersToDelete.forEach(header => {
        delete headers[header];
        delete headers[header.charAt(0).toUpperCase() + header.slice(1)];
    });

    async function singleAttempt(proxyUrl) {
        const agent = createCustomAgent(proxyUrl, endpoint);
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), 30000);

        try {
            const response = await fetch(endpoint, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(request.body),
                agent: agent,
                signal: abortController.signal
            });
            clearTimeout(timeoutId);

            if (response.status === 403 && proxyUrl) {
                markProxyFailed(proxyUrl);
                throw new Error(`403 Forbidden from DeepInfra`);
            }

            if (response.status === 400 && proxyUrl) {
                markProxyFailed(proxyUrl);
                throw new Error(`400 Forbidden from DeepInfra`);
            }

            if (response.status !== 200 && proxyUrl) {
                markProxyFailed(proxyUrl);
                throw new Error(`Error from DeepInfra`);
            }

            if (response.status === 503 && proxyUrl) {
                markProxyFailed(proxyUrl);
                throw new Error(`503 from proxy`);
            }

            return { response, proxyUrl };
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Request timeout after 30 seconds');
            }
            throw error;
        }
    }

    let result = null;
    let keepAliveInterval;

    if (isStreaming || request.headers.accept === 'text/event-stream') {
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control',
      });
      keepAliveInterval = setInterval(() => {
        //reply.raw.write('data: {"choices":[{"delta":{"content":"."},"index":0,"finish_reason":null}]}\n\n');
      }, 10000);
      reply.raw.on('close', () => {
        if (keepAliveInterval) clearInterval(keepAliveInterval);
      });
      reply.raw.on('error', (err) => {
        console.error('Reply raw error:', err);
        if (keepAliveInterval) clearInterval(keepAliveInterval);
      });
    }

    try {
        if (USE_PROXIES && PROXY_LIST.length > 0) {
            // Race 5 proxies at once instead of sequential tries
            let raceAttempts = 0;
            let totalAttempts = 0;
            const maxRaces = Math.min(4, Math.max(1, Math.ceil(PROXY_LIST.length / 5))); // Max 4 races, each with up to 5 proxies
            const maxTotalAttempts = 20; // Safeguard against infinite loops

            while (raceAttempts < maxRaces && totalAttempts < maxTotalAttempts) {
                raceAttempts++;
                totalAttempts++;
                const proxiesToTry = [];
                for (let i = 0; i < 5; i++) {
                    const proxy = getNextProxy();
                    if (proxy) {
                        proxiesToTry.push(proxy);
                    }
                }

                if (proxiesToTry.length === 0) {
                    console.log('[Proxy] No available proxies for race, clearing failed list and retrying...');
                    FAILED_PROXIES.clear();
                    PROXY_LAST_USED.clear();
                    continue;
                }

                console.log(`[Proxy] Race attempt ${raceAttempts}/${maxRaces} (total ${totalAttempts}/${maxTotalAttempts}): Racing ${proxiesToTry.length} proxies`);

                try {
                    const promises = proxiesToTry.map(proxyUrl => singleAttempt(proxyUrl));
                    result = await Promise.any(promises);
                    console.log(`[Proxy] Success in race with proxy ${result.proxyUrl}`);
                    break; // Success, exit the retry loop
                } catch (aggregateError) {
                    console.error(`[Proxy] All ${proxiesToTry.length} proxies in race failed`);

                    if (raceAttempts >= maxRaces) {
                        if (totalAttempts >= maxTotalAttempts) {
                            console.log('[Proxy] Max total attempts reached, giving up...');
                            throw new Error('All proxies exhausted after extensive retry attempts');
                        }
                        console.log('[Proxy] Max races reached, clearing failed list and doing final sweep...');
                        FAILED_PROXIES.clear();
                        PROXY_LAST_USED.clear();
                        raceAttempts = 0; // Reset and try again, but totalAttempts prevents infinite loop
                    } else {
                        // Add delay between race attempts to prevent rapid firing
                        await new Promise(resolve => setTimeout(resolve, 500));
                    }
                }
            }
            // If still no result, try final random proxy
            if (!result) {
                console.error('[Proxy] All race attempts failed, trying final random proxy...');
                const finalProxy = PROXY_LIST[Math.floor(Math.random() * PROXY_LIST.length)];
                try {
                    result = await singleAttempt(finalProxy);
                    console.log(`[Proxy] Final attempt succeeded with ${finalProxy}`);
                } catch (finalError) {
                    console.error('[Proxy] Even final attempt failed');
                    throw new Error('All proxies exhausted after extensive retry attempts');
                }
            }
        } else {
            result = await singleAttempt(null);
        }
    } catch (error) {
        console.error("Proxy error:", error);
        if (keepAliveInterval) clearInterval(keepAliveInterval);
        if (!reply.sent && !reply.raw.headersSent) {
            return reply.status(500).send({ error: "Internal server error" });
        }
        // Update stats for failed requests
        updateRequestStats(latency, requestSuccessful).catch(err => console.error('Error updating stats in proxy error catch:', err));
        return;
    }

    if (result && result.response) {
        const upstreamResponse = result.response;
        if (keepAliveInterval) {
            clearInterval(keepAliveInterval);
            //reply.raw.write('data: {"choices":[{"delta":{"content":"\\n"},"index":0,"finish_reason":null}]}\n\n');
        }
        reply.status(upstreamResponse.status);
        requestSuccessful = true;
        
        // Handle streaming responses to measure time to first chunk
        if (isStreaming || request.headers.accept === 'text/event-stream') {
            // For streaming, headers already sent, skip copying upstream headers
            let bodyStream = upstreamResponse.body;

            // Measure time to first chunk
            const streamStartTime = Date.now();
            firstChunkTime = streamStartTime - requestStartTime;

            // Create a new readable stream that measures chunks
            const { Readable } = require('stream');
            const measuredStream = new Readable({
                read() {}
            });

            let firstChunkReceived = false;
            let totalChunks = 0;
            let invalidChunks = 0;

            bodyStream.on('data', (chunk) => {
                totalChunks++;
                const chunkStr = chunk.toString();
                
                // Validate streaming format for each chunk - should be valid SSE format
                const isValidStreaming = chunkStr.startsWith('data: ') || chunkStr.startsWith('data:') || chunkStr.trim() === '';
                
                if (!isValidStreaming && chunkStr.trim() !== '') {
                    invalidChunks++;
                    console.error(`[Proxy] Invalid streaming chunk from ${result.proxyUrl}: ${chunkStr.substring(0, 100)}...`);
                    
                    // If more than 20% of chunks are invalid, mark proxy as failed
                    if (invalidChunks > 0 && totalChunks > 0 && (invalidChunks / totalChunks) > 0.2) {
                        if (result.proxyUrl) {
                            markProxyFailed(result.proxyUrl);
                        }
                        requestSuccessful = false;
                        measuredStream.destroy(new Error('Invalid streaming format - too many malformed chunks'));
                        return;
                    }
                }
                
                if (!firstChunkReceived) {
                    firstChunkReceived = true;
                    firstChunkTime = Date.now() - requestStartTime;
                    updateRequestStats(firstChunkTime, requestSuccessful).catch(err => console.error('Error updating stats on first chunk:', err));
                }
                
                measuredStream.push(chunk);
            });
            
            bodyStream.on('end', () => {
                measuredStream.push(null);
            });
            
            bodyStream.on('error', async (error) => {
                console.error('Stream error:', error);
                requestSuccessful = false;
                measuredStream.destroy(error);
                try {
                    await updateRequestStats(firstChunkTime, requestSuccessful);
                } catch (statsError) {
                    console.error('Error updating stats in stream error:', statsError);
                }
            });
            
            measuredStream.pipe(reply.raw).on('error', (err) => {
              console.error('Pipe error:', err);
              if (keepAliveInterval) clearInterval(keepAliveInterval);
            });
            return;
        } else {
            // Copy headers for non-streaming
            for (const [key, value] of upstreamResponse.headers.entries()) {
                if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) continue;
                reply.header(key, value);
            }

            // For non-streaming responses, measure total response time
            const response = await upstreamResponse.text();
            latency = Date.now() - requestStartTime;
            
            // Validate non-streaming response format
            try {
                const responseData = JSON.parse(response);
                // Check if it has the expected chat completions structure
                if (!responseData.choices || !Array.isArray(responseData.choices)) {
                    console.error(`[Proxy] Invalid response structure from ${result.proxyUrl}: missing choices array`);
                    if (result.proxyUrl) {
                        markProxyFailed(result.proxyUrl);
                    }
                    throw new Error('Invalid response structure from upstream API');
                }
            } catch (parseError) {
                console.error(`[Proxy] Invalid JSON response from ${result.proxyUrl}: ${response.substring(0, 200)}...`);
                if (result.proxyUrl) {
                    markProxyFailed(result.proxyUrl);
                }
                throw new Error('Invalid JSON response from upstream API');
            }
            
            // Update stats for successful non-streaming requests
            updateRequestStats(latency, requestSuccessful).catch(err => console.error('Error updating stats in non-streaming:', err));
            
            return reply.send(response);
        }
    }
    
    // Update stats for failed requests
    updateRequestStats(latency, requestSuccessful);
}

app.all("/v1/chat/completions", async function (request, reply) {

    // check referer
    const referer = request.headers.referer || "";
    if (referer && referer.startsWith("https://lorebary.com/")) {// "https://lorebary.com/")
        // BLOCK THAT BITCH
      return reply.status(418).send({ error: "Error 418: Unexpected Input, please debug in the Discord" });
    }

    const isStreaming = request.headers["accept"] === "text/event-stream" || request.body?.stream === true;

    if (openrouter_models.includes((request.body.model).split(":")[0])) {
        request.body.model = request.body.model;
        await proxyToEndpoint(
            preprocessRequest(request),
            reply,
            "https://g4f.dev/api/openrouter/chat/completions",
            isStreaming
        );
        return;
    }

    await proxyToEndpoint(
        preprocessRequest(request),
        reply,
        "https://api.deepinfra.com/v1/chat/completions",
        isStreaming
    );
});

app.get("/v1/models", async function (request, reply) {
    const models = [
        "MiniMaxAI/MiniMax-M2", "zai-org/GLM-4.6", "moonshotai/Kimi-K2-Thinking", "deepseek-ai/DeepSeek-V3-0324",
     "deepseek-ai/DeepSeek-R1-0528", "deepseek-ai/DeepSeek-R1-0528-Turbo",
        "deepseek-ai/DeepSeek-V3.2-Exp", "deepseek-ai/DeepSeek-V3.1-Terminus", "deepseek-ai/DeepSeek-V3.1",
        "Qwen/Qwen3-235B-A22B-Instruct-2507", "Qwen/Qwen3-235B-A22B-Thinking-2507",
        "Qwen/Qwen3-Next-80B-A3B-Instruct", "Qwen/Qwen3-Next-80B-A3B-Thinking",
        "moonshotai/Kimi-K2-Instruct-0905", "Qwen/Qwen3-14B", "mistralai/Mistral-Small-3.2-24B-Instruct-2506",
        "mistralai/Mistral-Small-3.1-24B-Instruct-2503", "google/gemma-3-27b-it",
        "google/gemma-3-12b-it", "google/gemma-2-27b-it", "google/gemma-2-9b-it",
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

// Initialize proxies before starting the server
initializeProxies().then(() => {
    app.listen({ port: 2085}, (err, address) => {
        if (err) {
            console.error(err);
            process.exit(1);
        }
        console.log(`Server listening on ${address}`);
    });
});