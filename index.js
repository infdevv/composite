process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const config = require("./config.json");
const fastify = require("fastify");
const fs = require("fs/promises");
const fsSync = require("fs");
const crypto = require("crypto");
const path = require("path");
const promptList = require("./helpers/constants.js");

const https = require("https");
const fetch = require('node-fetch');

const openrouter_models = [
    "deepseek-ai/deepseek-r1-0528",
    "deepseek-ai/deepseek-v3.1",
    "minimaxai/minimax-m2",
    "mistralai/magistral-small-2506",
    "mistralai/mistral-large-3-675b-instruct-2512"
]







function createDirectAgent(targetUrl = 'https://api.deepinfra.com/v1/chat/completions') {
    return new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 1000,
        family: 4,
        timeout: 30000
    });
}

const app = fastify({ logger: false });

app.register(require("@fastify/cors"), { origin: "*" });
app.register(require("@fastify/rate-limit"), {
    global: true,
    max: 30,
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

async function safeWriteJSON(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
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

    if (users[request.body.key].lastAdViewedDate !== 0 && users[request.body.key].lastAdViewedDate + 43200000 > Date.now()) {
        const timeLeft = 43200000 - (Date.now() - users[request.body.key].lastAdViewedDate);
        const hoursLeft = Math.ceil(timeLeft / 3600000);
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
    // If even number, return the average of the two middle ones
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

function trimMessagesToTokenLimit(messages, limit){
    let stringified = JSON.stringify(messages);
    while (stringified.length / 4 > limit){
        messages.splice(1, 1);
        stringified = JSON.stringify(messages);
    }
    return messages;
}

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

   // if (newBody.messages && newBody.messages.length > 0 && config.maxTokens) {
        newBody.messages = trimMessagesToTokenLimit(newBody.messages, config.maxTokens);
    //}

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

async function directToEndpoint(request, reply, endpoint, isStreaming = false) {
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
        console.log("[Direct] Insufficient credits: " + users[key].balance);
        return reply.status(402).send({ error: "Insufficient credits" });
    }

    if (users[key].lastAdViewedDate !== 0 && users[key].lastAdViewedDate + 43200000 < Date.now()) {
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

    async function directAttempt() {
        const agent = createDirectAgent(endpoint);
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
            return { response };
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Request timeout after 30 seconds');
            }
            throw error;
        }
    }

    let result = null;

    try {
        result = await directAttempt();
    } catch (error) {
        console.error("Direct connection error:", error);
        if (!reply.sent && !reply.raw.headersSent) {
            return reply.status(500).send({ error: "Internal server error" });
        }
        // Update stats for failed requests
        updateRequestStats(latency, requestSuccessful);
        return;
    }

    if (result && result.response) {
        const upstreamResponse = result.response;
        reply.status(upstreamResponse.status);
        requestSuccessful = true;
        
        // Copy headers
        for (const [key, value] of upstreamResponse.headers.entries()) {
            if (['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) continue;
            reply.header(key, value);
        }
        
        // Handle streaming responses to measure time to first chunk
        if (isStreaming || request.headers.accept === 'text/event-stream') {
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
            
            bodyStream.on('data', (chunk) => {
                if (!firstChunkReceived) {
                    firstChunkReceived = true;
                    firstChunkTime = Date.now() - requestStartTime;
                    // Use firstChunkTime for streaming latency
                    updateRequestStats(firstChunkTime, requestSuccessful);
                }
                measuredStream.push(chunk);
            });
            
            bodyStream.on('end', () => {
                measuredStream.push(null);
            });
            
            bodyStream.on('error', (error) => {
                console.error('Stream error:', error);
                requestSuccessful = false;
                measuredStream.destroy(error);
                updateRequestStats(firstChunkTime, requestSuccessful);
            });
            
            return reply.send(measuredStream);
        } else {
            // For non-streaming responses, measure total response time
            const response = await upstreamResponse.text();
            latency = Date.now() - requestStartTime;
            
            // Update stats for successful non-streaming requests
            updateRequestStats(latency, requestSuccessful);
            
            return reply.send(response);
        }
    }
    
    // Update stats for failed requests
    updateRequestStats(latency, requestSuccessful);
}

app.all("/v1/chat/completions", async function (request, reply) {
    const isStreaming = request.headers["accept"] === "text/event-stream" || request.body?.stream === true;
    request.body.model = "deepseek-ai/deepseek-v3.1"
    if (openrouter_models.includes((request.body.model).split(":")[0])) {
        request.body.model = request.body.model;
        await directToEndpoint(
            preprocessRequest(request),
            reply,
            "https://g4f.dev/api/nvidia/chat/completions",
            isStreaming
        );
        return;
    }

    await directToEndpoint(
        preprocessRequest(request),
        reply,
        "https://api.deepinfra.com/v1/openai/chat/completions",
        isStreaming
    );
});

app.get("/v1/models", async function (request, reply) {
    const models = [
        "MiniMaxAI/MiniMax-M2", "moonshotai/Kimi-K2-Thinking", "deepseek-ai/DeepSeek-V3-0324",
        "x-ai/grok-4.1-fast", "deepseek-ai/DeepSeek-R1-0528", "deepseek-ai/DeepSeek-R1-0528-Turbo",
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

// Initialize server
app.listen({ port: 2085 }, (err, address) => {
    if (err) {
        console.error(err);
        process.exit(1);
    }
    console.log(`Server listening on ${address}`);
});