const { ProxyAgent } = require("undici");
const config = require("./config.json");
const fastify = require("fastify");
const fs = require("fs/promises");
const crypto = require("crypto");
const { fetch } = require("undici");
const path = require("path");
const promptList = require("./helpers/constants.js");

const app = fastify({
  logger: true,
});

app.register(require("@fastify/cors"), {
  origin: "*",
});

app.register(require("@fastify/rate-limit"), {
  max: 100,
  timeWindow: "1 minute",
});

app.register(require("@fastify/static"), {
  root: path.resolve(__dirname, "./frontend"),
  prefix: "/",
  decorateReply: false,
});

const client = new ProxyAgent(config.proxyURL);

function hashIP(ip) {
  return crypto.createHash("sha256").update(ip).digest("hex");
}

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
  // load /data/users.json
  let users = JSON.parse(await fs.readFile("./data/users.json"));

  // Get and hash the requestor's IP
  const clientIP =
    request.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    request.headers["x-real-ip"] ||
    request.ip;
  const hashedRequestorIP = hashIP(clientIP);

  // Check if this IP already has an account (alt detection)
  for (const [existingKey, userData] of Object.entries(users)) {
    if (userData.hashedIP === hashedRequestorIP) {
      return reply.status(403).send({
        error: "An account with this IP address already exists",
        existingKey: existingKey,
      });
    }
  }

  // create UUID
  let uuid = crypto.randomUUID();

  // add user with hashed IP
  users[uuid] = {
    key: uuid,
    balance: 0,
    lastAdViewedDate: 0,
    createdDate: Date.now(),
    hashedIP: hashedRequestorIP,
  };

  await fs.writeFile("./data/users.json", JSON.stringify(users));
  reply.send(users[uuid]);
});

app.post("/api/check-key", async function (request, reply) {
  try {
    if (!request.body || !request.body.key) {
      return reply.status(400).send({ error: "Missing key in request" });
    }
    let users = JSON.parse(await fs.readFile("./data/users.json"));
    if (!users[request.body.key]) {
      return reply.status(404).send({ error: "Key not found" });
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
    }/rep.html&alias=${crypto
      .randomUUID()
      .replaceAll("-", "")
      .slice(0, 12)}&format=text`
  );
  reply.send(await response.text());
});

app.post("/api/recieveCredits", async function (request, reply) {
  try {
    if (!request.body || !request.body.key) {
      return reply.status(400).send({ error: "Missing key in request" });
    }
    let users = JSON.parse(await fs.readFile("./data/users.json"));
    if (!users[request.body.key]) {
      return reply.status(404).send({ error: "Key not found" });
    }
    // check if the last ad was viewed less than 2 hours ago
    if (
      users[request.body.key].lastAdViewedDate !== 0 &&
      users[request.body.key].lastAdViewedDate + 7200000 > Date.now()
    ) {
      return reply
        .status(429)
        .send({ error: "Please wait 2 hours between ad views" });
    }
    users[request.body.key].lastAdViewedDate = Date.now();
    users[request.body.key].balance = Math.round((users[request.body.key].balance + config.creditsPerAd) * 100) / 100;
    await fs.writeFile("./data/users.json", JSON.stringify(users));
    reply.send({ success: true, balance: users[request.body.key].balance });
  } catch (error) {
    console.error("Receive credits error:", error);
    return reply.status(500).send({ error: "Internal server error" });
  }
});

app.get("/api/statistics", async function (request, reply) {
  const stats = JSON.parse(await fs.readFile("stats.json"));
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

  let stats = JSON.parse(await fs.readFile("stats.json"));
  stats.totalRequests += 1;
  stats.activeRequests += 1;
  await fs.writeFile("stats.json", JSON.stringify(stats));

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

    // load /data/users.json
    let users = JSON.parse(await fs.readFile("./data/users.json"));

    // Check if user exists
    if (!users[key]) {
      return reply.status(401).send({ error: "Invalid API key" });
    }

    // check if they have enough credits (minimum check - will verify exact amount after request)
    // At 0.01 credits per token, minimum 10 tokens = 0.1 credits
    if (users[key].balance < 0.1) {
      return reply.status(402).send({ error: "Insufficient credits" });
    }

    // check if the last ad was viewed more than 2 hours ago (credits expired)
    if (
      users[key].lastAdViewedDate !== 0 &&
      users[key].lastAdViewedDate + 7200000 < Date.now()
    ) {
      users[key].balance = 0;
      await fs.writeFile("./data/users.json", JSON.stringify(users));
      return reply
        .status(402)
        .send({ error: "Credits expired. Please view an ad first." });
    }

    if (!users[key].hashedIP) {
      const clientIP =
        request.headers["x-forwarded-for"]?.split(",")[0].trim() ||
        request.headers["x-real-ip"] ||
        request.ip;
      users[key].hashedIP = hashIP(clientIP);
    }

    // Credit deduction will happen after we get the response with token usage

    delete headers.authorization;
    delete headers.referer;
    delete headers.origin;
    delete headers.host;
    delete headers.connection;

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

    // Helper function to attempt request with fallback
    async function attemptRequest(modelToUse, canFallback = true) {
      const requestBody = { ...request.body, model: modelToUse };

      let response = await fetch(endpoint, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(requestBody),
        dispatcher: client,
      });

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

        let usersAfter = JSON.parse(await fs.readFile("./data/users.json"));
        if (usersAfter[key]) {
          const oldBalance = usersAfter[key].balance;
          usersAfter[key].balance = Math.max(0, Math.round((usersAfter[key].balance - creditsToDeduct) * 100) / 100);
          console.log(`Balance: ${oldBalance} -> ${usersAfter[key].balance}`);
          await fs.writeFile("./data/users.json", JSON.stringify(usersAfter));
        }

        let stats = JSON.parse(await fs.readFile("stats.json"));
        stats.activeRequests -= 1;
        await fs.writeFile("stats.json", JSON.stringify(stats));
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
      let usersAfter = JSON.parse(await fs.readFile("./data/users.json"));
      if (usersAfter[key]) {
        const oldBalance = usersAfter[key].balance;
        usersAfter[key].balance = Math.max(0, Math.round((usersAfter[key].balance - creditsToDeduct) * 100) / 100);
        console.log(`Balance: ${oldBalance} -> ${usersAfter[key].balance}`);
        await fs.writeFile("./data/users.json", JSON.stringify(usersAfter));
      }

      let stats = JSON.parse(await fs.readFile("stats.json"));
      stats.activeRequests -= 1;
      await fs.writeFile("stats.json", JSON.stringify(stats));
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
    "https://api.deepinfra.com/v1/openai/chat/completions",
    false
  );
});

// we MUST host on 3005.
app.listen({ port: 3000, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening on ${address}`);
});
