import { createServer } from 'node:http';
import handler from '../api/index.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

const server = createServer((request, response) => {
  void handler(request, response);
});

server.listen(port, host, () => {
  console.log(`Tech Tees Admin API running at http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}. Closing API...`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
