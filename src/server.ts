import { createApp } from './app.js';
import { MongoProductRepository } from './mongo-product-repository.js';
import { ProductsService } from './products-service.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://mateus_db_user:1908@cluster0.ue2kkz4.mongodb.net/tech-tees';
const mongoDbName = process.env.MONGODB_DB || 'tech-tees-admin';
const mongoCollectionName = process.env.MONGODB_COLLECTION || 'products';

const { repository, client } = await MongoProductRepository.connect({
  uri: mongoUri,
  dbName: mongoDbName,
  collectionName: mongoCollectionName,
});

const service = new ProductsService(repository);
const app = createApp(service);

app.listen(port, host, () => {
  console.log(`Tech Tees Admin API running at http://${host}:${port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}. Closing MongoDB connection...`);
  await client.close();
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
