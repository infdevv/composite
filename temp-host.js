const fastify = require('fastify');
const path = require('path');
const fs = require('fs');

const server = fastify();

server.get('/', async (request, reply) => {
  const filePath = path.join(__dirname, 'public/temp.html');
  const fileContent = await fs.promises.readFile(filePath, 'utf8');
  reply.type('text/html').send(fileContent);
});

server.listen({ port: 3005 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is running at ${address}`);
});