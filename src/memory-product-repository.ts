import type { Product } from './product-contract.js';
import type { ProductRepository } from './product-repository.js';

export class MemoryProductRepository implements ProductRepository {
  private products: Product[];

  constructor(products: Product[] = []) {
    this.products = [...products];
  }

  async list(): Promise<Product[]> {
    return [...this.products];
  }

  async findById(id: string): Promise<Product | null> {
    return this.products.find((product) => product.id === id) ?? null;
  }

  async insertAtTop(product: Product): Promise<void> {
    this.products = [product, ...this.products];
  }

  async replace(id: string, product: Product): Promise<boolean> {
    const index = this.products.findIndex((item) => item.id === id);

    if (index === -1) {
      return false;
    }

    const nextProducts = [...this.products];
    nextProducts[index] = product;
    this.products = nextProducts;
    return true;
  }

  async remove(id: string): Promise<boolean> {
    const nextProducts = this.products.filter((product) => product.id !== id);

    if (nextProducts.length === this.products.length) {
      return false;
    }

    this.products = nextProducts;
    return true;
  }

  async replaceAll(products: Product[]): Promise<void> {
    this.products = [...products];
  }
}
