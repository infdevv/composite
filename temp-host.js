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

app.register(require("@fastify/static"), {
  root: path.resolve(__dirname, "./frontend"),
  prefix: "/",
  decorateReply: false,
});

app.get("/", async function (request, reply) {
  const htmlContent = await fs.readFile(path.resolve(__dirname, "./frontend/temp.html"), "utf8");
  reply.header("Content-Type", "text/html");
  reply.send(htmlContent);
});

// we MUST host on 3005.
app.listen({ port: 3005, host: "0.0.0.0" }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening on ${address}`);
});
