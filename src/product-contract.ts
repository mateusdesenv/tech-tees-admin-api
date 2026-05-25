export const PRODUCT_STATUSES = ['active', 'draft', 'archived'] as const;

export const PRODUCT_CATEGORIES = [
  'Dev',
  'Designer',
  'Audiovisual',
  'Marketing',
  'Gamer',
  'Outras Profissões',
] as const;

export const DEFAULT_IMAGE = 'assets/products/nao-e-bug-feature.webp';
export const DEFAULT_COLOR = 'Preta';

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export interface Product {
  id: string;
  name: string;
  slug: string;
  category: ProductCategory;
  price: number;
  compareAtPrice: number | null;
  cost: number | null;
  stock: number;
  sku: string;
  color: string;
  sizes: string[];
  image: string;
  description: string;
  tags: string[];
  rating: number;
  sales: number;
  featured: boolean;
  status: ProductStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProductsExport {
  version: 1;
  exportedAt: string;
  products: Product[];
}

export type ProductInput = Record<string, unknown>;

export class HttpError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function createSlug(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function generateSku(): string {
  const suffix = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `TT-${suffix}`;
}

export function generateId(): string {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

export function toBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();

    if (['true', '1', 'yes', 'sim', 's'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'nao', 'não', 'n'].includes(normalized)) {
      return false;
    }
  }

  return fallback;
}

export function normalizeProduct(
  input: ProductInput,
  existingProduct: Product | null = null,
): Product {
  const now = new Date().toISOString();
  const name = String(input?.name ?? '').trim();

  if (!name) {
    throw validationError('O campo "name" é obrigatório.');
  }

  const category = input?.category ?? existingProduct?.category ?? 'Dev';
  if (!isProductCategory(category)) {
    throw validationError(`Categoria inválida. Use um destes valores: ${PRODUCT_CATEGORIES.join(', ')}.`);
  }

  const status = input?.status ?? existingProduct?.status ?? 'draft';
  if (!isProductStatus(status)) {
    throw validationError(`Status inválido. Use um destes valores: ${PRODUCT_STATUSES.join(', ')}.`);
  }

  const slugInput = String(input?.slug ?? '').trim();
  const slug = slugInput || createSlug(name);

  if (!slug) {
    throw validationError('Não foi possível gerar um slug válido para o produto.');
  }

  const price = readNonNegativeNumber(input?.price, 'price', 0);
  const compareAtPrice = readNullableNonNegativeNumber(input?.compareAtPrice, 'compareAtPrice');
  const cost = readNullableNonNegativeNumber(input?.cost, 'cost');
  const stock = readNonNegativeInteger(input?.stock, 'stock', 0);
  const sales = readNonNegativeInteger(input?.sales, 'sales', 0);
  const rating = Math.min(5, Math.max(0, toNumber(input?.rating, 0)));

  return {
    id: String(existingProduct?.id ?? input?.id ?? generateId()),
    name,
    slug,
    category,
    price,
    compareAtPrice,
    cost,
    stock,
    sku: String(input?.sku ?? '').trim() || generateSku(),
    color: String(input?.color ?? '').trim() || DEFAULT_COLOR,
    sizes: toStringArray(input?.sizes),
    image: String(input?.image ?? '').trim() || DEFAULT_IMAGE,
    description: String(input?.description ?? '').trim(),
    tags: toStringArray(input?.tags),
    rating,
    sales,
    featured: toBoolean(input?.featured, existingProduct?.featured ?? false),
    status,
    createdAt: existingProduct?.createdAt ?? String(input?.createdAt ?? now),
    updatedAt: now,
  };
}

export function validateImportedProduct(input: ProductInput): Product {
  const product = normalizeProduct(input, null);

  if (input?.createdAt) {
    product.createdAt = String(input.createdAt);
  }

  if (input?.updatedAt) {
    product.updatedAt = String(input.updatedAt);
  }

  return product;
}

export function duplicateProduct(product: Product): Product {
  const now = new Date().toISOString();
  const suffix = Date.now();

  return {
    ...product,
    id: generateId(),
    name: `${product.name} - Cópia`,
    slug: `${product.slug}-copia-${suffix}`,
    sku: `${product.sku}-COPY-${String(suffix).slice(-6)}`,
    status: 'draft' as const,
    sales: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function toggleStatus(product: Product): Product {
  return {
    ...product,
    status: product.status === 'active' ? 'draft' : 'active',
    updatedAt: new Date().toISOString(),
  };
}

export function validationError(message: string): HttpError {
  return new HttpError(message, 400);
}

function readNonNegativeNumber(value: unknown, field: string, fallback: number): number {
  const number = toNumber(value, fallback);

  if (number < 0) {
    throw validationError(`O campo "${field}" não pode ser negativo.`);
  }

  return number;
}

function readNullableNonNegativeNumber(value: unknown, field: string): number | null {
  const number = toNullableNumber(value);

  if (number !== null && number < 0) {
    throw validationError(`O campo "${field}" não pode ser negativo.`);
  }

  return number;
}

function readNonNegativeInteger(value: unknown, field: string, fallback: number): number {
  const number = readNonNegativeNumber(value, field, fallback);

  if (!Number.isInteger(number)) {
    throw validationError(`O campo "${field}" precisa ser um número inteiro.`);
  }

  return number;
}

function isProductCategory(value: unknown): value is ProductCategory {
  return PRODUCT_CATEGORIES.includes(value as ProductCategory);
}

function isProductStatus(value: unknown): value is ProductStatus {
  return PRODUCT_STATUSES.includes(value as ProductStatus);
}
