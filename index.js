const fastify = require('fastify');
const path = require('path');
const { Server } = require("socket.io");
const fs = require('fs');
const cors = require('@fastify/cors');

const server = fastify({
    logger: false, 
    trustProxy: true
});

const isProduction = process.env.NODE_ENV === 'production';

server.setErrorHandler((error, request, reply) => {
    // Log full error server-side
    console.error('Server error:', {
        message: error.message,
        stack: isProduction ? '[hidden]' : error.stack,
        url: request.url,
        method: request.method
    });

    // Send sanitized error to client
    const statusCode = error.statusCode || 500;

    const sanitizedError = {
        error: true,
        message: statusCode === 404 ? 'Resource not found' :
                 statusCode === 401 ? 'Unauthorized' :
                 statusCode === 400 ? 'Bad request' :
                 statusCode === 403 ? 'Forbidden' :
                 statusCode >= 500 ? 'Internal server error' : 'An error occurred',
        statusCode: statusCode
    };

    // Never send stack traces or file paths to client
    reply.status(statusCode).send(sanitizedError);
});

// Security: Set Not Found handler to prevent path leakage
server.setNotFoundHandler((request, reply) => {
    console.log(`404 Not Found: ${request.method} ${request.url}`);
    reply.status(404).send({
        error: true,
        message: 'Resource not found',
        statusCode: 404
    });
});

server.register(cors, { origin: true });

// Security: Add rate limiting
const rateLimitStore = new Map();

function rateLimit(maxRequests, windowMs, skipPaths = []) {
    return async (request, reply) => {
        // Skip rate limiting for certain paths
        if (skipPaths.some(path => request.url.startsWith(path))) {
            return;
        }

        const identifier = request.ip || request.headers['x-forwarded-for'] || 'unknown';
        const now = Date.now();
        const key = `${identifier}:${request.url}`;

        if (!rateLimitStore.has(key)) {
            rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
        } else {
            const record = rateLimitStore.get(key);

            // Reset if window expired
            if (now > record.resetTime) {
                record.count = 1;
                record.resetTime = now + windowMs;
            } else {
                record.count++;

                if (record.count > maxRequests) {
                    reply.status(429).send({
                        error: true,
                        message: 'Too many requests. Please try again later.',
                        statusCode: 429
                    });
                    return reply;
                }
            }
        }
    };
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
        if (now > record.resetTime) {
            rateLimitStore.delete(key);
        }
    }
}, 5 * 60 * 1000);

// Apply rate limiting: 100 requests per minute per IP
server.addHook('preHandler', rateLimit(100, 60000, ['/health', '/api/stats']));

// Security: Add security headers
server.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

    // Remove server header to avoid exposing server info
    reply.removeHeader('X-Powered-By');
    reply.removeHeader('Server');
});

// Register static file serving for /public directory
server.register(require('@fastify/static'), {
    root: path.join(__dirname, 'public'),
    prefix: '/'
});


const io = new Server(server.server, {
    perMessageDeflate: false, // Disable compression to reduce latency
    transports: ['websocket', 'polling'] // Prefer websocket for lower latency
});

let connected_users = new Map(); // userkeys -> { socket: socket, connected_at: timestamp }

// Security: Helper function for safe file reading
async function safeReadFile(filePath, encoding = 'utf8') {
    try {
        // Validate path is within allowed directories
        const resolvedPath = path.resolve(filePath);
        const allowedDir = path.resolve(__dirname);

        if (!resolvedPath.startsWith(allowedDir)) {
            throw new Error('Access denied');
        }

        return await fs.promises.readFile(resolvedPath, encoding);
    } catch (error) {
        // Log detailed error server-side
        console.error('File read error:', error.message);

        // Throw sanitized error
        const sanitizedError = new Error('File not found');
        sanitizedError.statusCode = 404;
        throw sanitizedError;
    }
}

server.get('/', async (request, reply) => {
    try {
        const filePath = path.join(__dirname, 'public/index.html');
        const fileContent = await safeReadFile(filePath, 'utf8');
        reply.type('text/html').send(fileContent);
    } catch (error) {
        throw error; // Will be caught by global error handler
    }
}); 

server.get("/health", async (request, reply) => {
    reply.send("ok")
})

server.get("/example.png", async (request, reply) => {
    try {
        const filePath = path.join(__dirname, 'public/example.png');
        const fileContent = await safeReadFile(filePath, null);
        reply.type('image/png').send(fileContent);
    } catch (error) {
        throw error; // Will be caught by global error handler
    }
});

server.get("/index.js", async (request, reply) => {
    try {
        const filePath = path.join(__dirname, 'public/index.js');
        const fileContent = await safeReadFile(filePath, null);
        reply.type('application/javascript').send(fileContent);
    } catch (error) {
        throw error; // Will be caught by global error handler
    }
});

server.get("/v1/chat/images/:description", async (request, reply) => {
    reply.status(301).redirect(`https://image.pollinations.ai/prompt/${request.params.description}?model=turbo&nologo=true`);
});

server.get("/plugin-parse.js", async (request, reply) => {
    try {
        const filePath = path.join(__dirname, 'public/plugin-parse.js');
        const fileContent = await safeReadFile(filePath, 'utf8');
        reply.type('application/javascript').send(fileContent);
    } catch (error) {
        throw error; // Will be caught by global error handler
    }
});

// Helper function to normalize message content for comparison
function normalizeMessageContent(message) {
    if (!message || typeof message !== 'object') return '';

    let content = '';
    if (message.content) {
        content = message.content;
    }

    // Normalize: trim, convert to lowercase, collapse multiple spaces, remove special chars
    return content
        .trim()
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[^\w\s]/g, '')
        .slice(0, 1000); // Limit length for comparison
}

// Helper function to calculate similarity between two message arrays
function calculateMessagesSimilarity(messages1, messages2) {
    if (!messages1 || !messages2) return 0;

    const len1 = messages1.length;
    const len2 = messages2.length;

    // If length difference is too large, likely different conversations
    if (Math.abs(len1 - len2) > Math.max(len1, len2) * 0.3) return 0;

    const compareLength = Math.min(len1, len2, 5); // Compare up to 5 messages for performance
    let similarityScore = 0;

    for (let i = 0; i < compareLength; i++) {
        const norm1 = normalizeMessageContent(messages1[i]);
        const norm2 = normalizeMessageContent(messages2[i]);

        if (norm1 === norm2) {
            similarityScore += 1.0;
        } else if (norm1 && norm2) {
            // Calculate string similarity using Levenshtein-like approach
            const similarity = calculateStringSimilarity(norm1, norm2);
            if (similarity > 0.85) { // High similarity threshold
                similarityScore += similarity;
            }
        }
    }

    return similarityScore / compareLength;
}

// Helper function to calculate string similarity
function calculateStringSimilarity(str1, str2) {
    if (str1 === str2) return 1.0;
    if (!str1 || !str2) return 0;

    const len1 = str1.length;
    const len2 = str2.length;
    const maxLen = Math.max(len1, len2);

    if (maxLen === 0) return 1.0;

    // Simple character-based similarity
    const minLen = Math.min(len1, len2);
    let matches = 0;

    for (let i = 0; i < minLen; i++) {
        if (str1[i] === str2[i]) matches++;
    }

    // Also check for substring matches
    const longer = len1 > len2 ? str1 : str2;
    const shorter = len1 > len2 ? str2 : str1;

    if (longer.includes(shorter) && shorter.length > 10) {
        return Math.max(0.8, matches / maxLen);
    }

    return matches / maxLen;
}

server.post("/donate", async (request, reply) => {
    try {
        // get messages
        let messages = request.body.messages;
        if (!Array.isArray(messages)) {
            const error = new Error('Invalid messages format');
            error.statusCode = 400;
            throw error;
        }

        // load donate.json
        const filePath = path.join(__dirname, 'donate.json');

        let fileContent;
        try {
            fileContent = await safeReadFile(filePath, 'utf8');
        } catch (error) {
            // If file doesn't exist, create it with empty array
            fileContent = '[]';
        }

        let data;
        try {
            data = JSON.parse(fileContent);
        } catch (error) {
            console.error('Failed to parse donate.json, resetting to empty array');
            data = [];
        }

        // Enhanced deduplication logic - only check recent entries for performance
        const similarityThreshold = 0.90; // 90% similarity threshold
        const recentCheckLimit = 100; // Only check last 100 entries for duplicates

        // Only check recent chats for duplicates to improve performance
        const recentChats = data.slice(-recentCheckLimit);
        const isDuplicate = recentChats.some(existingChat => {
            const similarity = calculateMessagesSimilarity(messages, existingChat);
            return similarity >= similarityThreshold;
        });

        // Skip adding if it's a duplicate
        if (isDuplicate) {
            reply.send("duplicate skipped");
            return;
        }

        // Only store the messages (limit to reasonable size for storage)
        const messagesToStore = messages.slice(0, 15); // Store up to 15 messages instead of 5
        data.push(messagesToStore);

        // Keep only the most recent 1000 chats to prevent file from growing too large
        if (data.length > 1000) {
            data = data.slice(-1000);
        }

        // save
        try {
            await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Failed to write donate.json:', error.message);
            const writeError = new Error('Failed to save data');
            writeError.statusCode = 500;
            throw writeError;
        }

        reply.send("ok");
    } catch (error) {
        throw error; // Will be caught by global error handler
    }
});

server.get("/puter.json", async (request, reply) => {
    try {
        const filePath = path.join(__dirname, 'public/puter.json');
        const fileContent = await safeReadFile(filePath, 'utf8');
        reply.type('application/json').send(fileContent);
    } catch (error) {
        throw error; // Will be caught by global error handler
    }
});

server.get("/puter2.json", async (request, reply) => {
    try {
        const filePath = path.join(__dirname, 'public/puter2.json');
        const fileContent = await safeReadFile(filePath, 'utf8');
        reply.type('application/json').send(fileContent);
    } catch (error) {
        throw error; // Will be caught by global error handler
    }
});

server.get("/statistics.html", async (request, reply) => {
    try {
        const filePath = path.join(__dirname, 'public/statistics.html');
        const fileContent = await safeReadFile(filePath, 'utf8');
        reply.type('text/html').send(fileContent);
    } catch (error) {
        throw error; // Will be caught by global error handler
    }
});

let total_messages = 0;
let total_message_len = 0; // char

server.get("/api/stats", async (request, reply) => {
    // return stats
    reply.type('application/json').send(JSON.stringify({
        "connected_users": connected_users.size, // number of connected users
        "total_handled_messages": total_messages, // number of messages handled by the server
        "average_message_length": total_message_len / total_messages
    }));
});

server.post("/chat/completions", async (request, reply) => {
    // call it 301 way we be redirecting
    reply.redirect(301, "/v1/chat/completions");
});

server.post("/openai/chat/completions", async (request, reply) => {
    // call it 301 way we be redirecting
    reply.redirect(301, "/v1/chat/completions");
});

server.post("/v1/chat/completions", async (request, reply) => {
    /* this is an openai api endpoint */

    const requestId = Math.random().toString(36).substring(7);
    const timestamp = new Date().toISOString();

    // check api key
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.error(`[401] [${timestamp}] [${requestId}] Missing or invalid authorization header`);
        console.error(`  → Authorization header present: ${!!authHeader}`);
        console.error(`  → Header starts with 'Bearer ': ${authHeader ? authHeader.startsWith('Bearer ') : 'N/A'}`);
        reply.status(401).send("invalid authorization header");
        return;
    }

    const userKey = authHeader.split(" ")[1].trim();
    const obfuscatedKey = userKey.length > 10
        ? userKey.substring(0, Math.max(6, userKey.length - 10)) + '*'.repeat(10)
        : '*'.repeat(userKey.length);

    // get messages
    let messages = request.body.messages;
    if (!Array.isArray(messages)) {
        console.error(`[400] [${timestamp}] [${requestId}] Invalid messages format for key ${obfuscatedKey}`);
        console.error(`  → Messages type: ${typeof messages}`);
        reply.status(400).send("invalid messages format");
        return;
    }

    const userInfo = connected_users.get(userKey);
    let userSocket = userInfo ? userInfo.socket : null;

    if (!userSocket) {
        console.error(`[401] [${timestamp}] [${requestId}] No connected frontend for key ${obfuscatedKey}`);
        console.error(`  → Total connected users: ${connected_users.size}`);

        // Show all registered keys
        if (connected_users.size > 0) {
            const allRegisteredKeys = Array.from(connected_users.keys())
                .map(k => k.length > 10 ? k.substring(0, Math.max(6, k.length - 10)) + '*'.repeat(10) : '*'.repeat(k.length));
            console.error(`  → All registered keys: ${allRegisteredKeys.join(', ')}`);
        } else {
            console.error(`  → No users currently connected via WebSocket`);
        }

        reply.status(401).send("no connected frontend for this user. are you using the right key?");
        return;
    }

    console.log(`[200] [${timestamp}] [${requestId}] Request accepted for key ${obfuscatedKey}`);

    total_messages += 1;

    // Extract generation settings from request body
    const generationSettings = {
        temperature: request.body.temperature !== undefined ? request.body.temperature : 0.7,
        max_tokens: request.body.max_tokens !== undefined ? request.body.max_tokens : 26000,
        top_p: request.body.top_p !== undefined ? request.body.top_p : 1,
        frequency_penalty: request.body.frequency_penalty !== undefined ? request.body.frequency_penalty : 0,
        presence_penalty: request.body.presence_penalty !== undefined ? request.body.presence_penalty : 0,
        repetition_penalty: request.body.repetition_penalty !== undefined ? request.body.repetition_penalty : 1
    };

    reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    userSocket.emit('start_generate', {
        messages: JSON.stringify(messages),
        settings: generationSettings
    });

    let generationActive = true;
    let errorCount = 0;
    const MAX_ERRORS = 3;
    let doneTimeout = null;
    let lastMessageTime = Date.now();


    const onMessage = (chunk) => {
        if (generationActive && chunk !== null && chunk !== undefined) {
            lastMessageTime = Date.now(); // Track when we last received a message

            let content = typeof chunk === 'string' ? chunk : chunk.toString();
            try {
                // Validate content before serialization
                if (typeof content !== 'string') {
                    console.error('Invalid content type:', typeof content);
                    return;
                }

                total_message_len +=  content.length

                // Handle large content by splitting into smaller chunks
                if (content.length > 8000) {
                    console.warn(`Content large (${content.length} chars), splitting into chunks`);
                    // More efficient chunking without regex
                    const chunkSize = 8000;
                    for (let i = 0; i < content.length; i += chunkSize) {
                        if (!generationActive) break;
                        const smallChunk = content.slice(i, i + chunkSize);
                        try {
                            const payload = JSON.stringify({
                                choices: [{
                                    delta: {
                                        content: smallChunk
                                    }
                                }]
                            });
                            reply.raw.write(`data: ${payload}\n\n`);
                        } catch (chunkError) {
                            console.warn('Chunk serialization failed, skipping chunk');
                        }
                    }
                    return;
                }

                // Use JSON.stringify to properly escape the content
                const payload = JSON.stringify({
                    choices: [{
                        delta: {
                            content: content
                        }
                    }]
                });


                // Validate the generated JSON
                if (!payload || payload === 'null') {
                    console.error('Failed to generate valid JSON payload');
                    return;
                }

                reply.raw.write(`data: ${payload}\n\n`);
                errorCount = 0; // Reset error count on successful write
            } catch (error) {
                errorCount++;
                console.error(`JSON serialization error ${errorCount}/${MAX_ERRORS} for user ${userKey.substring(0, userKey.length - 10)}**********:`, error.message);

                // Only stop after multiple consecutive errors
                if (errorCount >= MAX_ERRORS) {
                    console.log(`Too many errors (${errorCount}), stopping generation for user ${userKey.substring(0, userKey.length - 10)}**********`);
                    generationActive = false;
                    userSocket.emit('stop_generation');
                    cleanup();
                    return;
                }

                // Try sending a simple error response instead of stopping immediately
                try {
                    const errorPayload = JSON.stringify({
                        choices: [{
                            delta: {
                                content: "[Error processing response - retrying]"
                            }
                        }]
                    });
                    reply.raw.write(`data: ${errorPayload}\n\n`);
                } catch (fallbackError) {
                    console.warn(`Fallback error response failed (attempt ${errorCount}/${MAX_ERRORS})`);
                }
            }
        }
    };

    const onDone = () => {
        if (generationActive) {
            // Clear any existing timeout
            if (doneTimeout) {
                clearTimeout(doneTimeout);
            }

            // Debounce: wait for inactivity before sending [DONE]
            // This resets every time a new chunk comes in via onMessage updating lastMessageTime
            const checkAndClose = () => {
                const timeSinceLastMessage = Date.now() - lastMessageTime;
                if (timeSinceLastMessage >= 2000) {
                    // No messages for 2 seconds, safe to close
                    if (generationActive) {
                        try {
                            reply.raw.write('data: [DONE]\n\n');
                            reply.raw.end();
                        } catch (error) {
                            console.log(`Client already disconnected for user ${userKey.substring(0, userKey.length - 10)}**********`);
                        }
                    }
                    cleanup();
                } else {
                    // Still receiving messages, check again later
                    doneTimeout = setTimeout(checkAndClose, 2000 - timeSinceLastMessage);
                }
            };

            doneTimeout = setTimeout(checkAndClose, 2000);
        } else {
            cleanup();
        }
    };

    const cleanup = () => {
        generationActive = false;
        if (disconnectTimeout) {
            clearTimeout(disconnectTimeout);
            disconnectTimeout = null;
        }
        userSocket.off('message', onMessage);
        userSocket.off('done', onDone);
    };

    // Add debounced disconnect detection to avoid false positives
    let disconnectTimeout = null;
    let connectionErrors = 0;
    const MAX_CONNECTION_ERRORS = 60;

    const handleDisconnect = (reason) => {
        if (disconnectTimeout) {
            clearTimeout(disconnectTimeout);
        }

        disconnectTimeout = setTimeout(() => {
            if (generationActive) {
                console.log(`Client confirmed disconnected during generation for user ${userKey.substring(0, userKey.length - 10)}********** (${reason})`);
                generationActive = false;
                userSocket.emit('stop_generation');
                cleanup();
            }
        }, 2000); // 2 second delay to avoid false positives from temporary disconnects
    };

    // Detect client disconnect with debouncing
    reply.raw.on('close', () => {
        handleDisconnect('client close');
    });

    reply.raw.on('error', (error) => {
        connectionErrors++;
        console.warn(`SSE connection error ${connectionErrors}/${MAX_CONNECTION_ERRORS} for user ${userKey.substring(0, userKey.length - 10)}**********:`, error.message);

        // Only stop after multiple connection errors
        if (connectionErrors >= MAX_CONNECTION_ERRORS) {
            handleDisconnect(`connection errors (${connectionErrors})`);
        } else {
            console.info(`Connection error ${connectionErrors}/${MAX_CONNECTION_ERRORS}, continuing generation...`);
        }
    });

    userSocket.on('message', onMessage);
    userSocket.on('done', onDone);

});

// /socket socket.io endpoint

const ioSocket = io.of('/socket');
ioSocket.on('connection', (socket) => {
    // get the key
    let userkey = socket.handshake.query.key;
    if (!userkey || typeof userkey !== 'string' || userkey.length < 10) {
        console.log('Invalid key provided in connection attempt');
        socket.disconnect(true);
        return;
    }
    const timestamp = Date.now();

    // obfuscate last 10 chars to prevent anyone from hosting this and yoinking people's keys
    let obfuscated = userkey.substring(0, userkey.length - 10) + '*'.repeat(10);

    // Replace existing connection or create new one
    if (connected_users.has(userkey)) {
        const existingUserInfo = connected_users.get(userkey);
        if (existingUserInfo.socket) {
            existingUserInfo.socket.disconnect(true);
        }
    }

    connected_users.set(userkey, {
        socket: socket,
        connected_at: timestamp
    });

    console.log(`CONNECTION: ${obfuscated} (total connections: ${connected_users.size})`);

    // Set up disconnect handler
    socket.on("disconnect", (reason) => {
        console.log(`DISCONNECT: ${obfuscated} (reason: ${reason})`);
        connected_users.delete(userkey);
    });
});

server.listen({ port: 3000 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is running at http://localhost:3000`);
});