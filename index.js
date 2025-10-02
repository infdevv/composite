const fastify = require('fastify');
const path = require('path');
const { Server } = require("socket.io");
const fs = require('fs');
const cors = require('@fastify/cors');
const server = fastify();
server.register(cors, { origin: true });

// Register static file serving for /public directory
server.register(require('@fastify/static'), {
    root: path.join(__dirname, 'public'),
    prefix: '/'
});

const io = new Server(server.server);

let connected_users = new Map(); // userkey -> { socket: socket, connected_at: timestamp }

server.get('/', async (request, reply) => {
    const filePath = path.join(__dirname, 'public/index.html');
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    reply.type('text/html').send(fileContent);
}); 

server.get("/health", async (request, reply) => {
    reply.send("ok")
})

server.get("/example.png", async (request, reply) => {
    const filePath = path.join(__dirname, 'public/example.png');
    const fileContent = await fs.promises.readFile(filePath);
    reply.type('image/png').send(fileContent);
});

server.get("/v1/chat/images/:description", async (request, reply) => {
    reply.status(301).redirect(`https://image.pollinations.ai/prompt/${request.params.description}?model=turbo&nologo=true`);
});

server.get("/plugin-parse.js", async (request, reply) => {
    const filePath = path.join(__dirname, 'public/plugin-parse.js');
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    reply.type('application/javascript').send(fileContent);
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

    const compareLength = Math.min(len1, len2, 10); // Compare up to 10 messages
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
    // get messages
    let messages = request.body.messages;
    if (!Array.isArray(messages)) {
        reply.status(400).send("invalid messages format");
        return;
    }

    // load donate.json
    const filePath = path.join(__dirname, 'donate.json');
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    let data = JSON.parse(fileContent);

    // Enhanced deduplication logic
    const similarityThreshold = 0.90; // 90% similarity threshold

    // Filter out highly similar chats
    data = data.filter(existingChat => {
        const similarity = calculateMessagesSimilarity(messages, existingChat);
        return similarity < similarityThreshold;
    });

    // Only store the messages (limit to reasonable size for storage)
    const messagesToStore = messages.slice(0, 15); // Store up to 15 messages instead of 5
    data.push(messagesToStore);

    // Keep only the most recent 1000 chats to prevent file from growing too large
    if (data.length > 1000) {
        data = data.slice(-1000);
    }

    // save
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2));
    reply.send("ok");
});

server.get("/puter.json", async (request, reply) => {
    const filePath = path.join(__dirname, 'public/puter.json');
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    reply.type('application/json').send(fileContent);
});

server.get("/puter2.json", async (request, reply) => {
    const filePath = path.join(__dirname, 'public/puter.json');
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    reply.type('application/json').send(fileContent);
});

server.get("/statistics.html", async (request, reply) => {
    const filePath = path.join(__dirname, 'public/statistics.html');
    const fileContent = await fs.promises.readFile(filePath, 'utf8');
    reply.type('text/html').send(fileContent);
});

let total_messages = 0;

server.get("/api/stats", async (request, reply) => {
    // return stats
    reply.type('application/json').send(JSON.stringify({
        "connected_users": connected_users.size, // number of connected users
        "total_handled_messages": total_messages, // number of messages handled by the server
    }));
});


server.post("/v1/chat/completions", async (request, reply) => {
    /* this is an openai api endpoint */

    // check api key
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.status(401).send("invalid authorization header");
        return;
    }
    const userKey = authHeader.split(" ")[1].trim();
    //if (!connected_users.has(userKey)) {
    //    reply.status(401).send("please actually put your key in :(")
    //    return
    //}
        

    // get messages
    let messages = request.body.messages;
    if (!Array.isArray(messages)) {
        reply.status(400).send("invalid messages format");
        return;
    }
    
    const userInfo = connected_users.get(userKey);
    let userSocket = userInfo ? userInfo.socket : null;


    if (!userSocket) {
        reply.status(401).send("no connected frontend for this user. are you using the right key?");
        return;
    }

    total_messages += 1;

    reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    userSocket.emit('start_generate', { messages: JSON.stringify(messages) });

    let generationActive = true;
    let errorCount = 0;
    const MAX_ERRORS = 3;

    const onMessage = (chunk) => {
        if (generationActive && chunk !== null && chunk !== undefined) {
            let content = typeof chunk === 'string' ? chunk : chunk.toString();
            try {
                // Validate content before serialization
                if (typeof content !== 'string') {
                    console.error('Invalid content type:', typeof content);
                    return;
                }

                // Handle large content by splitting into smaller chunks
                if (content.length > 8000) {
                    console.warn(`Content large (${content.length} chars), splitting into chunks`);
                    const chunks = content.match(/.{1,8000}/g) || [content];
                    for (const smallChunk of chunks) {
                        if (!generationActive) break;
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
            try {
                reply.raw.write('data: [DONE]\n\n');
                reply.raw.end();
            } catch (error) {
                console.log(`Client already disconnected for user ${userKey.substring(0, userKey.length - 10)}**********`);
            }
        }
        cleanup();
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

server.listen({ port: 3005 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is running at http://localhost:3000`);
});