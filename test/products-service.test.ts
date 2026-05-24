import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryProductRepository } from '../src/memory-product-repository.js';
import { ProductsService } from '../src/products-service.js';

function createService(): ProductsService {
  return new ProductsService(new MemoryProductRepository());
}

test('cria produto normalizado e insere no início da lista', async () => {
  const service = createService();

  const existing = await service.list();
  const product = await service.create({
    name: ' Camiseta Café & Código ',
    category: 'Dev',
    price: '99.90',
    stock: '7',
    sizes: 'P, M, , G',
    tags: 'dev, café',
    rating: 8,
    featured: true,
    status: 'active',
  });
  const products = await service.list();

  assert.equal(products.length, existing.length + 1);
  assert.equal(products[0].id, product.id);
  assert.equal(product.name, 'Camiseta Café & Código');
  assert.equal(product.slug, 'camiseta-cafe-codigo');
  assert.equal(product.price, 99.9);
  assert.deepEqual(product.sizes, ['P', 'M', 'G']);
  assert.deepEqual(product.tags, ['dev', 'café']);
  assert.equal(product.rating, 5);
  assert.equal(product.color, 'Preta');
});

test('duplica produto seguindo o contrato do admin', async () => {
  const service = createService();

  const product = await service.create({
    name: 'Camiseta Terminal',
    slug: 'camiseta-terminal',
    category: 'Dev',
    sku: 'TT-DEV-999',
    status: 'active',
    sales: 55,
  });
  const duplicated = await service.duplicate(product.id);

  assert.ok(duplicated);
  assert.notEqual(duplicated.id, product.id);
  assert.equal(duplicated.name, 'Camiseta Terminal - Cópia');
  assert.match(duplicated.slug, /^camiseta-terminal-copia-\d+$/);
  assert.equal(duplicated.sku, 'TT-DEV-999-COPY');
  assert.equal(duplicated.status, 'draft');
  assert.equal(duplicated.sales, 0);
});

test('importa array puro ou envelope de exportação', async () => {
  const service = createService();

  await service.import([
    {
      id: 'produto-1',
      name: 'Camiseta Importada',
      slug: 'camiseta-importada',
      category: 'Designer',
      price: 88,
      compareAtPrice: null,
      cost: 40,
      stock: 2,
      sku: 'TT-DES-001',
      color: 'Branca',
      sizes: ['M'],
      image: 'assets/products/nao-e-bug-feature.webp',
      description: '',
      tags: ['design'],
      rating: 4.2,
      sales: 3,
      featured: false,
      status: 'draft',
      createdAt: '2026-05-24T12:00:00.000Z',
      updatedAt: '2026-05-24T12:00:00.000Z',
    },
  ]);

  assert.equal((await service.list()).length, 1);

  const products = await service.import({
    version: 1,
    exportedAt: '2026-05-24T12:00:00.000Z',
    products: [],
  });

  assert.deepEqual(products, []);
});
