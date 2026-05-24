import type { Product } from './product-contract.js';

export interface ProductRepository {
  list(): Promise<Product[]>;
  findById(id: string): Promise<Product | null>;
  insertAtTop(product: Product): Promise<void>;
  replace(id: string, product: Product): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  replaceAll(products: Product[]): Promise<void>;
}
