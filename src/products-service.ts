import {
  duplicateProduct,
  normalizeProduct,
  toggleStatus,
  validateImportedProduct,
  HttpError,
} from './product-contract.js';
import type { Product, ProductInput, ProductsExport } from './product-contract.js';
import type { ProductRepository } from './product-repository.js';

const DEFAULT_MAX_IMPORT_PRODUCTS = 1000;

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
    await this.assertUniqueProductFields(product);

    await this.repository.insertAtTop(product);
    return product;
  }

  async replace(id: string, payload: ProductInput): Promise<Product | null> {
    const existing = await this.repository.findById(id);

    if (!existing) {
      return null;
    }

    const updated = normalizeProduct({ ...payload, id }, existing);
    await this.assertUniqueProductFields(updated, id);
    await this.repository.replace(id, updated);

    return updated;
  }

  async update(id: string, payload: ProductInput): Promise<Product | null> {
    const existing = await this.repository.findById(id);

    if (!existing) {
      return null;
    }

    const updated = normalizeProduct({ ...existing, ...payload, id }, existing);
    await this.assertUniqueProductFields(updated, id);
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
    await this.assertUniqueProductFields(duplicated);
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

    const maxImportProducts = Number(process.env.MAX_IMPORT_PRODUCTS || DEFAULT_MAX_IMPORT_PRODUCTS);
    if (products.length > maxImportProducts) {
      throw new HttpError(`Importação excede o limite de ${maxImportProducts} produtos.`, 413);
    }

    const normalizedProducts = products.map((product) =>
      validateImportedProduct(product as ProductInput),
    );

    this.assertUniqueProductList(normalizedProducts);
    await this.repository.replaceAll(normalizedProducts);

    return normalizedProducts;
  }

  private async assertUniqueProductFields(product: Product, ignoredId = ''): Promise<void> {
    const products = await this.repository.list();
    const duplicated = products.find((item) =>
      item.id !== ignoredId
      && (
        item.id === product.id
        || item.slug === product.slug
        || item.sku === product.sku
      ),
    );

    if (!duplicated) {
      return;
    }

    if (duplicated.id === product.id) {
      throw new HttpError(`Já existe um produto com o id "${product.id}".`, 409);
    }

    if (duplicated.slug === product.slug) {
      throw new HttpError(`Já existe um produto com o slug "${product.slug}".`, 409);
    }

    throw new HttpError(`Já existe um produto com o SKU "${product.sku}".`, 409);
  }

  private assertUniqueProductList(products: Product[]): void {
    this.assertUniqueValues(products, 'id');
    this.assertUniqueValues(products, 'slug');
    this.assertUniqueValues(products, 'sku');
  }

  private assertUniqueValues(products: Product[], field: 'id' | 'slug' | 'sku'): void {
    const seen = new Set<string>();

    for (const product of products) {
      const value = product[field];

      if (seen.has(value)) {
        throw new HttpError(`Importação inválida: valor duplicado no campo "${field}": "${value}".`, 400);
      }

      seen.add(value);
    }
  }
}
