import { MongoClient } from 'mongodb';

const PRODUCT_STATUSES = ['active', 'draft', 'archived'];
const PRODUCT_CATEGORIES = ['Dev', 'Designer', 'Audiovisual', 'Marketing', 'Gamer', 'Outras Profissões'];
const DEFAULT_IMAGE = 'assets/products/nao-e-bug-feature.webp';
const DEFAULT_COLOR = 'Preta';

let mongoClientPromise = null;

export default async function handler(request, response) {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const segments = url.pathname.split('/').filter(Boolean);

    if (request.method === 'OPTIONS') {
      return sendEmpty(response, 204);
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return sendJson(response, 200, { status: 'ok' });
    }

    if (segments[0] !== 'products') {
      return sendJson(response, 404, { error: 'Rota não encontrada.' });
    }

    const collection = await getProductsCollection();

    if (segments.length === 1 && request.method === 'GET') {
      const products = await collection.find({}, { projection: { _id: 0 } }).sort({ position: -1 }).toArray();
      return sendJson(response, 200, products);
    }

    if (segments.length === 1 && request.method === 'POST') {
      const payload = await readJson(request);
      const product = normalizeProduct(payload);
      const position = await nextPosition(collection);

      await collection.insertOne({ ...product, position });
      return sendJson(response, 201, product);
    }

    const id = decodeURIComponent(segments[1] || '');

    if (!id || segments.length !== 2) {
      return sendJson(response, 404, { error: 'Rota não encontrada.' });
    }

    if (request.method === 'GET') {
      const product = await collection.findOne({ id }, { projection: { _id: 0, position: 0 } });
      return product
        ? sendJson(response, 200, product)
        : sendJson(response, 404, { error: 'Produto não encontrado.' });
    }

    if (request.method === 'PUT' || request.method === 'PATCH') {
      const existingDocument = await collection.findOne({ id });

      if (!existingDocument) {
        return sendJson(response, 404, { error: 'Produto não encontrado.' });
      }

      const payload = await readJson(request);
      const existingProduct = toProduct(existingDocument);
      const nextPayload = request.method === 'PATCH'
        ? { ...existingProduct, ...payload, id }
        : { ...payload, id };
      const updatedProduct = normalizeProduct(nextPayload, existingProduct);

      await collection.replaceOne(
        { id },
        { ...updatedProduct, position: existingDocument.position || 0 },
      );

      return sendJson(response, 200, updatedProduct);
    }

    if (request.method === 'DELETE') {
      const result = await collection.deleteOne({ id });
      return result.deletedCount
        ? sendEmpty(response, 204)
        : sendJson(response, 404, { error: 'Produto não encontrado.' });
    }

    return sendJson(response, 405, { error: 'Método não permitido para esta rota.' });
  } catch (error) {
    return sendError(response, error);
  }
}

async function getProductsCollection() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new HttpError('MONGODB_URI não configurada.', 503);
  }

  mongoClientPromise ||= new MongoClient(mongoUri).connect();
  const client = await mongoClientPromise;
  const dbName = process.env.MONGODB_DB || 'tech-tees-admin';
  const collectionName = process.env.MONGODB_COLLECTION || 'products';
  const collection = client.db(dbName).collection(collectionName);

  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex({ position: -1 });

  return collection;
}

async function nextPosition(collection) {
  const latest = await collection.findOne({}, { sort: { position: -1 }, projection: { position: 1 } });
  return (latest?.position || 0) + 1;
}

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString('utf8');

  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError('JSON inválido.', 400);
  }
}

function normalizeProduct(input = {}, existingProduct = null) {
  const now = new Date().toISOString();
  const name = String(input.name || '').trim();

  if (!name) {
    throw new HttpError('O campo "name" é obrigatório.', 400);
  }

  const category = input.category || existingProduct?.category || 'Dev';
  if (!PRODUCT_CATEGORIES.includes(category)) {
    throw new HttpError(`Categoria inválida. Use um destes valores: ${PRODUCT_CATEGORIES.join(', ')}.`, 400);
  }

  const status = input.status || existingProduct?.status || 'draft';
  if (!PRODUCT_STATUSES.includes(status)) {
    throw new HttpError(`Status inválido. Use um destes valores: ${PRODUCT_STATUSES.join(', ')}.`, 400);
  }

  const slugInput = String(input.slug || '').trim();

  return {
    id: String(existingProduct?.id || input.id || generateId()),
    name,
    slug: slugInput || createSlug(name),
    category,
    price: toNumber(input.price, 0),
    compareAtPrice: toNullableNumber(input.compareAtPrice),
    cost: toNullableNumber(input.cost),
    stock: toNumber(input.stock, 0),
    sku: String(input.sku || '').trim() || generateSku(),
    color: String(input.color || '').trim() || DEFAULT_COLOR,
    sizes: toStringArray(input.sizes),
    image: String(input.image || '').trim() || DEFAULT_IMAGE,
    description: String(input.description || '').trim(),
    tags: toStringArray(input.tags),
    rating: Math.min(5, Math.max(0, toNumber(input.rating, 0))),
    sales: toNumber(input.sales, 0),
    featured: Boolean(input.featured),
    status,
    createdAt: existingProduct?.createdAt || String(input.createdAt || now),
    updatedAt: now,
  };
}

function toProduct(document) {
  const { _id, position, ...product } = document;
  return product;
}

function createSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function generateId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function generateSku() {
  return `TT-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    ...createCorsHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response, statusCode) {
  response.writeHead(statusCode, createCorsHeaders());
  response.end();
}

function sendError(response, error) {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = statusCode === 500
    ? 'Erro interno do servidor.'
    : error instanceof Error
      ? error.message
      : 'Erro inesperado.';

  return sendJson(response, statusCode, { error: message });
}

function createCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

class HttpError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
