import type { MongoClient } from 'mongodb';
import { MongoProductRepository } from './mongo-product-repository.js';
import { ProductsService } from './products-service.js';

interface ProductsServiceConnection {
  client: MongoClient;
  service: ProductsService;
}

let connectionPromise: Promise<ProductsServiceConnection> | null = null;

export async function getProductsService(): Promise<ProductsService> {
  const connection = await getProductsServiceConnection();
  return connection.service;
}

export async function closeProductsServiceConnection(): Promise<void> {
  if (!connectionPromise) {
    return;
  }

  const connection = await connectionPromise;
  await connection.client.close();
  connectionPromise = null;
}

async function getProductsServiceConnection(): Promise<ProductsServiceConnection> {
  connectionPromise ??= createProductsServiceConnection();
  return connectionPromise;
}

async function createProductsServiceConnection(): Promise<ProductsServiceConnection> {
  const { repository, client } = await MongoProductRepository.connect({
    uri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
    dbName: process.env.MONGODB_DB || 'tech-tees-admin',
    collectionName: process.env.MONGODB_COLLECTION || 'products',
  });

  return {
    client,
    service: new ProductsService(repository),
  };
}
