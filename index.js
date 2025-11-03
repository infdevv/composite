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
    // check if the last ad was viewed less than a day ago
    if (
      users[request.body.key].lastAdViewedDate !== 0 &&
      users[request.body.key].lastAdViewedDate + 86400000 > Date.now()
    ) {
      return reply
        .status(429)
        .send({ error: "Please wait 24 hours between ad views" });
    }
    users[request.body.key].lastAdViewedDate = Date.now();
    users[request.body.key].balance += 500;
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

    // check if they have enough credits ( each request is 1 credit )
    if (users[key].balance < 1) {
      return reply.status(402).send({ error: "Insufficient credits" });
    }

    // check if the last ad was viewed more than a day ago (credits expired)
    if (
      users[key].lastAdViewedDate !== 0 &&
      users[key].lastAdViewedDate + 86400000 < Date.now()
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

    users[key].balance -= 1;
    await fs.writeFile("./data/users.json", JSON.stringify(users));

    delete headers.authorization;
    delete headers.referer;
    delete headers.origin;
    delete headers.host;
    delete headers.connection;


    let response = await fetch(endpoint, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(request.body),
      dispatcher: client,
    });

    if (isStreaming) {
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
        for await (const chunk of response.body) {
          reply.raw.write(chunk);
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
      const data = await response.json();
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
