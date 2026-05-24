import { MongoClient, type Collection, type Document } from 'mongodb';
import type { Product } from './product-contract.js';
import type { ProductRepository } from './product-repository.js';
import { createSeedProducts } from './seeds.js';

type ProductDocument = Product & {
  position: number;
};

export class MongoProductRepository implements ProductRepository {
  private readonly collection: Collection<ProductDocument>;

  constructor(collection: Collection<ProductDocument>) {
    this.collection = collection;
  }

  static async connect(options: {
    uri: string;
    dbName: string;
    collectionName: string;
  }): Promise<{ repository: MongoProductRepository; client: MongoClient }> {
    const client = new MongoClient(options.uri);
    await client.connect();

    const collection = client
      .db(options.dbName)
      .collection<ProductDocument>(options.collectionName);

    await collection.createIndex({ id: 1 }, { unique: true });
    await collection.createIndex({ position: -1 });

    const repository = new MongoProductRepository(collection);
    await repository.seedIfEmpty();

    return { repository, client };
  }

  async list(): Promise<Product[]> {
    const documents = await this.collection.find().sort({ position: -1 }).toArray();
    return documents.map(toProduct);
  }

  async findById(id: string): Promise<Product | null> {
    const document = await this.collection.findOne({ id });
    return document ? toProduct(document) : null;
  }

  async insertAtTop(product: Product): Promise<void> {
    const position = await this.nextPosition();
    await this.collection.insertOne({ ...product, position });
  }

  async replace(id: string, product: Product): Promise<boolean> {
    const existing = await this.collection.findOne({ id }, { projection: { position: 1 } });

    if (!existing) {
      return false;
    }

    const result = await this.collection.replaceOne(
      { id },
      { ...product, position: existing.position },
    );

    return result.matchedCount > 0;
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ id });
    return result.deletedCount > 0;
  }

  async replaceAll(products: Product[]): Promise<void> {
    await this.collection.deleteMany({});

    if (products.length === 0) {
      return;
    }

    await this.collection.insertMany(
      products.map((product, index) => ({
        ...product,
        position: products.length - index,
      })),
    );
  }

  private async seedIfEmpty(): Promise<void> {
    if (await this.collection.countDocuments({}, { limit: 1 })) {
      return;
    }

    await this.replaceAll(createSeedProducts());
  }

  private async nextPosition(): Promise<number> {
    const [latest] = await this.collection
      .find({}, { projection: { position: 1 } })
      .sort({ position: -1 })
      .limit(1)
      .toArray();

    return (latest?.position ?? 0) + 1;
  }
}

function toProduct(document: ProductDocument | Document): Product {
  const {
    id,
    name,
    slug,
    category,
    price,
    compareAtPrice,
    cost,
    stock,
    sku,
    color,
    sizes,
    image,
    description,
    tags,
    rating,
    sales,
    featured,
    status,
    createdAt,
    updatedAt,
  } = document as ProductDocument;

  return {
    id,
    name,
    slug,
    category,
    price,
    compareAtPrice,
    cost,
    stock,
    sku,
    color,
    sizes,
    image,
    description,
    tags,
    rating,
    sales,
    featured,
    status,
    createdAt,
    updatedAt,
  };
}
