import { createApp } from './app.js';
import { closeProductsServiceConnection, getProductsService } from './products-service-factory.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const service = await getProductsService();
const app = createApp(service);

app.listen(port, host, () => {
  console.log(`Tech Tees Admin API running at http://${host}:${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}. Closing MongoDB connection...`);
  await closeProductsServiceConnection();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
