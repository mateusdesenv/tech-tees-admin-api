import {
  duplicateProduct,
  normalizeProduct,
  toggleStatus,
  validateImportedProduct,
  HttpError,
} from './product-contract.js';
import type { Product, ProductInput, ProductsExport } from './product-contract.js';
import type { ProductRepository } from './product-repository.js';
import { createSeedProducts } from './seeds.js';

export class ProductsService {
  private readonly repository: ProductRepository;

  constructor(repository: ProductRepository) {
    this.repository = repository;
  }

  async list(): Promise<Product[]> {
    return this.repository.list();
  }

  async findById(id: string): Promise<Product | null> {
    return this.repository.findById(id);
  }

  async create(payload: ProductInput): Promise<Product> {
    const product = normalizeProduct(payload);

    await this.repository.insertAtTop(product);
    return product;
  }

  async replace(id: string, payload: ProductInput): Promise<Product | null> {
    const existing = await this.repository.findById(id);

    if (!existing) {
      return null;
    }

    const updated = normalizeProduct({ ...payload, id }, existing);
    await this.repository.replace(id, updated);

    return updated;
  }

  async update(id: string, payload: ProductInput): Promise<Product | null> {
    const existing = await this.repository.findById(id);

    if (!existing) {
      return null;
    }

    const updated = normalizeProduct({ ...existing, ...payload, id }, existing);
    await this.repository.replace(id, updated);

    return updated;
  }

  async remove(id: string): Promise<boolean> {
    return this.repository.remove(id);
  }

  async duplicate(id: string): Promise<Product | null> {
    const product = await this.repository.findById(id);

    if (!product) {
      return null;
    }

    const duplicated = duplicateProduct(product);
    await this.repository.insertAtTop(duplicated);

    return duplicated;
  }

  async toggleStatus(id: string): Promise<Product | null> {
    const product = await this.repository.findById(id);

    if (!product) {
      return null;
    }

    const updated = toggleStatus(product);
    await this.repository.replace(id, updated);

    return updated;
  }

  async resetSeed(): Promise<Product[]> {
    const products = createSeedProducts();
    await this.repository.replaceAll(products);
    return products;
  }

  async export(): Promise<ProductsExport> {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      products: await this.list(),
    };
  }

  async import(payload: unknown): Promise<Product[]> {
    const products = Array.isArray(payload)
      ? payload
      : payload && typeof payload === 'object' && 'products' in payload
        ? (payload as { products?: unknown }).products
        : null;

    if (!Array.isArray(products)) {
      throw new HttpError('Envie um array de produtos ou um envelope com "products".', 400);
    }

    const normalizedProducts = products.map((product) =>
      validateImportedProduct(product as ProductInput),
    );
    await this.repository.replaceAll(normalizedProducts);

    return normalizedProducts;
  }
}
