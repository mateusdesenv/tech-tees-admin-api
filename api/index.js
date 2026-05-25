import { MongoClient } from 'mongodb';
import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const PRODUCT_STATUSES = ['active', 'draft', 'archived'];
const PRODUCT_CATEGORIES = ['Dev', 'Designer', 'Audiovisual', 'Marketing', 'Gamer', 'Outras Profissões'];
const DEFAULT_IMAGE = 'assets/products/nao-e-bug-feature.webp';
const DEFAULT_COLOR = 'Preta';
const TOKEN_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;

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

    if (segments[0] === 'auth') {
      return handleAuthRoutes(request, response, segments);
    }

    if (segments[0] === 'stores') {
      return handleStoreRoutes(request, response, segments);
    }

    if (segments[0] !== 'products') {
      return sendJson(response, 404, { error: 'Rota não encontrada.' });
    }

    const collection = await getProductsCollection();

    if (segments.length === 1 && request.method === 'GET') {
      const storeId = url.searchParams.get('storeId');
      const query = storeId ? createStoreProductQuery(storeId) : {};
      const products = await collection.find(query, { projection: { _id: 0 } }).sort({ position: -1 }).toArray();
      return sendJson(response, 200, products);
    }

    if (segments.length === 2 && segments[1] === 'export' && request.method === 'GET') {
      await requireAuth(request);
      const storeId = url.searchParams.get('storeId');
      const query = storeId ? createStoreProductQuery(storeId) : {};
      const products = await collection.find(query, { projection: { _id: 0, position: 0 } }).sort({ position: -1 }).toArray();
      return sendJson(response, 200, {
        version: 1,
        exportedAt: new Date().toISOString(),
        storeId: storeId || null,
        products,
      });
    }

    if (segments.length === 2 && segments[1] === 'import' && request.method === 'POST') {
      await requireAuth(request);
      const payload = await readJson(request);
      const productsPayload = Array.isArray(payload) ? payload : payload.products;

      if (!Array.isArray(productsPayload)) {
        throw new HttpError('Envie um array de produtos ou um envelope com "products".', 400);
      }

      const storeId = url.searchParams.get('storeId') || null;
      const products = productsPayload.map((product) => normalizeProduct({ ...product, storeId: product.storeId || storeId }));
      await collection.deleteMany(storeId ? createStoreProductQuery(storeId) : {});

      if (products.length > 0) {
        await collection.insertMany(products.map((product, index) => ({
          ...product,
          position: products.length - index,
        })));
      }

      return sendJson(response, 200, products);
    }

    if (segments.length === 2 && segments[1] === 'reset-seed' && request.method === 'POST') {
      await requireAuth(request);
      const storeId = url.searchParams.get('storeId') || DEFAULT_STORE.id;
      const products = createSeedProducts(storeId);
      await collection.deleteMany(createStoreProductQuery(storeId));
      await collection.insertMany(products.map((product, index) => ({
        ...product,
        position: products.length - index,
      })));

      return sendJson(response, 200, products);
    }

    if (segments.length === 1 && request.method === 'POST') {
      await requireAuth(request);
      const payload = await readJson(request);
      const product = normalizeProduct(payload);
      const position = await nextPosition(collection);

      await collection.insertOne({ ...product, position });
      return sendJson(response, 201, product);
    }

    const id = decodeURIComponent(segments[1] || '');

    if (!id) {
      return sendJson(response, 404, { error: 'Rota não encontrada.' });
    }

    if (segments.length === 3 && segments[2] === 'duplicate' && request.method === 'POST') {
      await requireAuth(request);
      const existingDocument = await collection.findOne({ id });

      if (!existingDocument) {
        return sendJson(response, 404, { error: 'Produto não encontrado.' });
      }

      const duplicatedProduct = duplicateProduct(toProduct(existingDocument));
      const position = await nextPosition(collection);
      await collection.insertOne({ ...duplicatedProduct, position });

      return sendJson(response, 201, duplicatedProduct);
    }

    if (segments.length === 3 && segments[2] === 'status' && request.method === 'PATCH') {
      await requireAuth(request);
      const existingDocument = await collection.findOne({ id });

      if (!existingDocument) {
        return sendJson(response, 404, { error: 'Produto não encontrado.' });
      }

      const existingProduct = toProduct(existingDocument);
      const updatedProduct = {
        ...existingProduct,
        status: existingProduct.status === 'active' ? 'draft' : 'active',
        updatedAt: new Date().toISOString(),
      };

      await collection.replaceOne(
        { id },
        { ...updatedProduct, position: existingDocument.position || 0 },
      );

      return sendJson(response, 200, updatedProduct);
    }

    if (segments.length !== 2) {
      return sendJson(response, 404, { error: 'Rota não encontrada.' });
    }

    if (request.method === 'GET') {
      const product = await collection.findOne({ id }, { projection: { _id: 0, position: 0 } });
      return product
        ? sendJson(response, 200, product)
        : sendJson(response, 404, { error: 'Produto não encontrado.' });
    }

    if (request.method === 'PUT' || request.method === 'PATCH') {
      await requireAuth(request);
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
      await requireAuth(request);
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

async function handleAuthRoutes(request, response, segments) {
  if (segments.length === 2 && segments[1] === 'register' && request.method === 'POST') {
    const payload = await readJson(request);
    const users = await getUsersCollection();
    const name = String(payload.name || '').trim();
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || '');

    if (!name) {
      throw new HttpError('O campo "name" é obrigatório.', 400);
    }

    if (!email) {
      throw new HttpError('O campo "email" é obrigatório.', 400);
    }

    if (password.length < 6) {
      throw new HttpError('A senha deve ter pelo menos 6 caracteres.', 400);
    }

    const now = new Date().toISOString();
    const user = {
      id: generateId(),
      name,
      email,
      passwordHash: hashPassword(password),
      createdAt: now,
      updatedAt: now,
    };

    try {
      await users.insertOne(user);
    } catch (error) {
      if (error?.code === 11000) {
        throw new HttpError('Este email já está cadastrado.', 409);
      }

      throw error;
    }

    return sendJson(response, 201, createAuthResponse(user));
  }

  if (segments.length === 2 && segments[1] === 'login' && request.method === 'POST') {
    const payload = await readJson(request);
    const users = await getUsersCollection();
    const email = normalizeEmail(payload.email);
    const password = String(payload.password || '');
    const user = await users.findOne({ email });

    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new HttpError('Email ou senha inválidos.', 401);
    }

    return sendJson(response, 200, createAuthResponse(user));
  }

  if (segments.length === 2 && segments[1] === 'me' && request.method === 'GET') {
    const user = await requireAuth(request);
    return sendJson(response, 200, { user: toPublicUser(user) });
  }

  return sendJson(response, 404, { error: 'Rota não encontrada.' });
}

async function handleStoreRoutes(request, response, segments) {
  await requireAuth(request);
  const stores = await getStoresCollection();

  if (segments.length === 1 && request.method === 'GET') {
    await ensureDefaultStore(stores);
    const items = await stores.find({}, { projection: { _id: 0 } }).sort({ createdAt: 1 }).toArray();
    return sendJson(response, 200, items);
  }

  if (segments.length === 1 && request.method === 'POST') {
    const payload = await readJson(request);
    const store = normalizeStore(payload);
    await stores.insertOne(store);
    return sendJson(response, 201, store);
  }

  const id = decodeURIComponent(segments[1] || '');

  if (!id || segments.length !== 2) {
    return sendJson(response, 404, { error: 'Rota não encontrada.' });
  }

  if (request.method === 'PUT' || request.method === 'PATCH') {
    const existing = await stores.findOne({ id });

    if (!existing) {
      return sendJson(response, 404, { error: 'Loja não encontrada.' });
    }

    const payload = await readJson(request);
    const store = normalizeStore({ ...existing, ...payload, id }, existing);
    await stores.replaceOne({ id }, store);
    return sendJson(response, 200, store);
  }

  if (request.method === 'DELETE') {
    if (id === DEFAULT_STORE.id) {
      throw new HttpError('A loja padrão não pode ser excluída.', 400);
    }

    const products = await getProductsCollection();
    const productsCount = await products.countDocuments({ storeId: id });

    if (productsCount > 0) {
      throw new HttpError('Exclua ou mova as camisetas desta loja antes de remover a loja.', 409);
    }

    const result = await stores.deleteOne({ id });
    return result.deletedCount
      ? sendEmpty(response, 204)
      : sendJson(response, 404, { error: 'Loja não encontrada.' });
  }

  return sendJson(response, 405, { error: 'Método não permitido para esta rota.' });
}

async function getProductsCollection() {
  const client = await getMongoClient();
  const dbName = process.env.MONGODB_DB || 'tech-tees-admin';
  const collectionName = process.env.MONGODB_COLLECTION || 'products';
  const collection = client.db(dbName).collection(collectionName);

  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex({ position: -1 });

  return collection;
}

async function getStoresCollection() {
  const client = await getMongoClient();
  const dbName = process.env.MONGODB_DB || 'tech-tees-admin';
  const collectionName = process.env.MONGODB_STORES_COLLECTION || 'stores';
  const collection = client.db(dbName).collection(collectionName);

  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex({ slug: 1 }, { unique: true });

  return collection;
}

async function getUsersCollection() {
  const client = await getMongoClient();
  const dbName = process.env.MONGODB_DB || 'tech-tees-admin';
  const collectionName = process.env.MONGODB_USERS_COLLECTION || 'users';
  const collection = client.db(dbName).collection(collectionName);

  await collection.createIndex({ email: 1 }, { unique: true });
  await collection.createIndex({ id: 1 }, { unique: true });

  return collection;
}

async function getMongoClient() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new HttpError('MONGODB_URI não configurada.', 503);
  }

  mongoClientPromise ||= new MongoClient(mongoUri).connect();
  return mongoClientPromise;
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
    storeId: String(input.storeId || existingProduct?.storeId || DEFAULT_STORE.id),
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

const DEFAULT_STORE = {
  id: 'default-store',
  name: 'Tech Tees',
  slug: 'tech-tees',
  description: 'Loja padrão da Tech Tees',
  status: 'active',
};

function normalizeStore(input = {}, existingStore = null) {
  const now = new Date().toISOString();
  const name = String(input.name || '').trim();

  if (!name) {
    throw new HttpError('O campo "name" é obrigatório.', 400);
  }

  const slug = createSlug(input.slug || name);

  return {
    id: String(existingStore?.id || input.id || generateId()),
    name,
    slug,
    description: String(input.description || '').trim(),
    status: input.status === 'archived' ? 'archived' : 'active',
    createdAt: existingStore?.createdAt || String(input.createdAt || now),
    updatedAt: now,
  };
}

async function ensureDefaultStore(stores) {
  const existing = await stores.findOne({ id: DEFAULT_STORE.id });

  if (existing) {
    return;
  }

  const now = new Date().toISOString();
  await stores.insertOne({
    ...DEFAULT_STORE,
    createdAt: now,
    updatedAt: now,
  });
}

function createStoreProductQuery(storeId) {
  if (storeId === DEFAULT_STORE.id) {
    return {
      $or: [
        { storeId },
        { storeId: { $exists: false } },
        { storeId: null },
      ],
    };
  }

  return { storeId };
}

function duplicateProduct(product) {
  const now = new Date().toISOString();

  return {
    ...product,
    id: generateId(),
    name: `${product.name} - Cópia`,
    slug: `${product.slug}-copia-${Date.now()}`,
    sku: `${product.sku}-COPY`,
    status: 'draft',
    sales: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function createSeedProducts(storeId = DEFAULT_STORE.id) {
  const now = new Date().toISOString();

  return [
    {
      id: generateId(),
      storeId,
      name: 'Camiseta Não é Bug, é Feature',
      slug: 'camiseta-nao-e-bug-e-feature',
      category: 'Dev',
      price: 89.9,
      compareAtPrice: 119.9,
      cost: 42,
      stock: 32,
      sku: 'TT-DEV-001',
      color: 'Preta',
      sizes: ['P', 'M', 'G', 'GG'],
      image: DEFAULT_IMAGE,
      description: 'Camiseta preta com frase dev para quem transforma problemas em funcionalidades.',
      tags: ['dev', 'programação', 'humor'],
      rating: 4.9,
      sales: 128,
      featured: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

async function requireAuth(request) {
  const token = getBearerToken(request);

  if (!token) {
    throw new HttpError('Não autorizado.', 401);
  }

  const payload = verifyToken(token);
  const users = await getUsersCollection();
  const user = await users.findOne({ id: payload.sub });

  if (!user) {
    throw new HttpError('Não autorizado.', 401);
  }

  return user;
}

function createAuthResponse(user) {
  return {
    token: createToken(user),
    user: toPublicUser(user),
  };
}

function toPublicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
  };
}

function createToken(user) {
  const header = base64UrlEncode({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlEncode({
    sub: user.id,
    email: user.email,
    name: user.name,
    exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRES_IN_SECONDS,
  });
  const signature = signToken(`${header}.${payload}`);

  return `${header}.${payload}.${signature}`;
}

function verifyToken(token) {
  const [header, payload, signature] = String(token).split('.');

  if (!header || !payload || !signature) {
    throw new HttpError('Não autorizado.', 401);
  }

  const expectedSignature = signToken(`${header}.${payload}`);

  if (!safeEqual(signature, expectedSignature)) {
    throw new HttpError('Não autorizado.', 401);
  }

  let parsedPayload;

  try {
    parsedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError('Não autorizado.', 401);
  }

  if (!parsedPayload.sub || !parsedPayload.exp || parsedPayload.exp < Math.floor(Date.now() / 1000)) {
    throw new HttpError('Sessão expirada.', 401);
  }

  return parsedPayload;
}

function signToken(value) {
  return createHmac('sha256', getAuthSecret()).update(value).digest('base64url');
}

function getAuthSecret() {
  return process.env.AUTH_SECRET || process.env.MONGODB_URI || 'tech-tees-dev-secret';
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const iterations = 120000;
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('base64url');

  return `${iterations}.${salt}.${hash}`;
}

function verifyPassword(password, storedHash) {
  const [iterations, salt, hash] = String(storedHash || '').split('.');

  if (!iterations || !salt || !hash) {
    return false;
  }

  const candidate = pbkdf2Sync(password, salt, Number(iterations), 32, 'sha256').toString('base64url');
  return safeEqual(candidate, hash);
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function base64UrlEncode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function getBearerToken(request) {
  const authorization = request.headers.authorization || '';
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

class HttpError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
