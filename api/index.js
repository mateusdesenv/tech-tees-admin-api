import { MongoClient } from 'mongodb';
import { createHmac, pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const PRODUCT_STATUSES = ['active', 'draft', 'archived'];
const PRODUCT_CATEGORIES = ['Dev', 'Designer', 'Audiovisual', 'Marketing', 'Gamer', 'Outras Profissões'];
const DEFAULT_IMAGE = 'assets/products/nao-e-bug-feature.webp';
const DEFAULT_COLOR = 'Preta';
const TOKEN_EXPIRES_IN_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_CORS_ORIGINS = [
  'https://hml.admin.techtees.online',
  'https://admin.techtees.online',
  'http://localhost:4200',
  'http://localhost:5173',
];
const INITIAL_COLORS = [
  ['Preto', 15, 15, 15],
  ['Branco', 255, 255, 255],
  ['Cinza Mescla', 176, 178, 176],
  ['Azul Royal', 0, 83, 160],
  ['Azul Marinho', 8, 35, 73],
  ['Verde Bandeira', 0, 118, 61],
  ['Amarelo Canário', 255, 232, 0],
  ['Amarelo Ouro', 245, 176, 37],
  ['Laranja', 241, 105, 35],
  ['Vermelho', 213, 28, 41],
  ['Vinho', 115, 18, 37],
  ['Rosa Pink', 232, 0, 123],
];
const INITIAL_CATEGORIES = PRODUCT_CATEGORIES;

let mongoClientPromise = null;
const requestByResponse = new WeakMap();

export default async function handler(request, response) {
  requestByResponse.set(response, request);

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
      return await handleAuthRoutes(request, response, segments);
    }

    if (segments[0] === 'stores') {
      return await handleStoreRoutes(request, response, segments);
    }

    if (segments[0] === 'checkout') {
      return await handleCheckoutRoutes(request, response, segments);
    }

    if (segments[0] === 'orders') {
      return await handleOrderRoutes(request, response, segments);
    }

    if (segments[0] === 'colors') {
      return await handleColorRoutes(request, response, segments);
    }

    if (segments[0] === 'categories') {
      return await handleCategoryRoutes(request, response, segments);
    }

    if (segments[0] === 'admin') {
      return await handleAdminRoutes(request, response, segments);
    }

    if (segments[0] === 'webhooks' && segments[1] === 'mercado-pago' && request.method === 'POST') {
      await handleMercadoPagoWebhook(request, url);
      return sendJson(response, 200, { received: true });
    }

    if (segments[0] !== 'products') {
      return sendJson(response, 404, { error: 'Rota não encontrada.' });
    }

    const collection = await getProductsCollection();

    if (segments.length === 1 && request.method === 'GET') {
      const storeId = url.searchParams.get('storeId');
      const query = storeId ? createStoreProductQuery(storeId) : {};
      const products = await collection.find(query, { projection: { _id: 0 } }).sort({ position: -1 }).toArray();
      return sendJson(response, 200, await attachCatalogColors(products));
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
        ? sendJson(response, 200, (await attachCatalogColors([product]))[0])
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
      const user = await requireAuth(request);
      await requirePasswordConfirmation(request, user);
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
  if (segments.length === 2 && segments[1] === 'google' && request.method === 'POST') {
    const payload = await readJson(request);
    const firebaseUser = await verifyFirebaseIdToken(String(payload.idToken || ''));
    const email = normalizeEmail(firebaseUser.email);

    if (!isAuthorizedAdminEmail(email)) {
      throw new HttpError('Usuário não autorizado para acessar o painel administrativo.', 403);
    }

    const users = await getUsersCollection();
    const now = new Date().toISOString();
    const existingUser = await users.findOne({ email });
    const user = {
      ...(existingUser || {}),
      id: existingUser?.id || generateId(),
      name: String(firebaseUser.displayName || existingUser?.name || email.split('@')[0]),
      email,
      firebaseUid: String(firebaseUser.localId || ''),
      photoURL: String(firebaseUser.photoUrl || ''),
      provider: 'google',
      role: existingUser?.role || 'admin',
      status: 'active',
      createdAt: existingUser?.createdAt || now,
      updatedAt: now,
    };

    await users.replaceOne({ email }, user, { upsert: true });
    return sendJson(response, 200, createAuthResponse(user));
  }

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
  const stores = await getStoresCollection();
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  if (segments.length === 2 && segments[1] === 'public' && request.method === 'GET') {
    const slug = createSlug(url.searchParams.get('slug') || '');

    if (!slug) {
      throw new HttpError('Informe o slug da loja.', 400);
    }

    const store = await stores.findOne(
      { slug, status: 'active' },
      { projection: { _id: 0, id: 1, name: 1, slug: 1, description: 1, defaultShipping: 1, status: 1 } },
    );

    return store
      ? sendJson(response, 200, store)
      : sendJson(response, 404, { error: 'Loja não encontrada.' });
  }

  await requireAuth(request);

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
    const user = await requireAuth(request);
    await requirePasswordConfirmation(request, user);

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

async function handleCheckoutRoutes(request, response, segments) {
  if (segments.length === 2 && segments[1] === 'create-preference' && request.method === 'POST') {
    const payload = await readJson(request);
    const preference = await createMercadoPagoPreference(payload);
    return sendJson(response, 201, preference);
  }

  if (segments.length === 2 && segments[1] === 'process-payment' && request.method === 'POST') {
    const payload = await readJson(request);
    const payment = await createMercadoPagoPayment(payload);
    return sendJson(response, 201, payment);
  }

  return sendJson(response, 404, { error: 'Rota não encontrada.' });
}

async function handleMercadoPagoWebhook(request, url) {
  const payload = await readJson(request);
  const paymentId = payload?.data?.id || payload?.id || url.searchParams.get('data.id') || url.searchParams.get('id');
  const eventType = payload?.type || payload?.topic || url.searchParams.get('type') || url.searchParams.get('topic');

  if (!paymentId || !String(eventType || '').includes('payment')) {
    return;
  }

  const payment = await fetchMercadoPagoPayment(paymentId);

  if (payment.status !== 'approved') {
    return;
  }

  const metadata = payment.metadata || {};
  const metadataItems = normalizePaymentMetadataItems(metadata.items);
  const items = metadataItems.map(normalizeCheckoutItem);

  await registerApprovedCheckout(items, {
    externalReference: payment.external_reference || metadata.order_id,
    paymentId: payment.id,
    paymentStatus: payment.status,
    buyerName: metadata.buyer_name || payment.card?.cardholder?.name,
    payerEmail: payment.payer?.email,
    shippingCost: metadata.shipping_cost,
    totalAmount: payment.transaction_amount,
    storeId: metadata.store_id,
  });
}

async function fetchMercadoPagoPayment(paymentId) {
  const accessToken = String(process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim();

  if (!accessToken) {
    throw new HttpError('MERCADO_PAGO_ACCESS_TOKEN não configurado.', 503);
  }

  const mercadoPagoResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const responseBody = await mercadoPagoResponse.json().catch(() => ({}));

  if (!mercadoPagoResponse.ok) {
    const mercadoPagoError = normalizeMercadoPagoError(responseBody);
    throw new HttpError(createMercadoPagoErrorMessage(mercadoPagoResponse.status, mercadoPagoError), mercadoPagoResponse.status);
  }

  return responseBody;
}

async function handleOrderRoutes(request, response, segments) {
  await requireAuth(request);

  if (segments.length === 1 && request.method === 'GET') {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const storeId = url.searchParams.get('storeId');
    const orders = await getOrdersCollection();
    const query = storeId ? { storeId } : {};
    const items = await orders.find(query, { projection: { _id: 0 } }).sort({ createdAt: -1 }).toArray();
    return sendJson(response, 200, items);
  }

  return sendJson(response, 404, { error: 'Rota não encontrada.' });
}

async function handleColorRoutes(request, response, segments) {
  const user = await requireAuth(request);
  const colors = await getColorsCollection();

  if (segments.length === 1 && request.method === 'GET') {
    const items = await colors.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
    return sendJson(response, 200, items);
  }

  if (segments.length === 1 && request.method === 'POST') {
    const payload = await readJson(request);
    const color = normalizeColor(payload);
    await assertUniqueActiveColorName(colors, color);
    await colors.insertOne(color);
    return sendJson(response, 201, color);
  }

  const id = decodeURIComponent(segments[1] || '');

  if (!id || segments.length !== 2) {
    return sendJson(response, 404, { error: 'Cor não encontrada.' });
  }

  const existingColor = await colors.findOne({ id }, { projection: { _id: 0 } });

  if (!existingColor) {
    return sendJson(response, 404, { error: 'Cor não encontrada.' });
  }

  if (request.method === 'PUT' || request.method === 'PATCH') {
    const payload = await readJson(request);
    const color = normalizeColor(
      request.method === 'PATCH' ? { ...existingColor, ...payload, id } : { ...payload, id },
      existingColor,
    );
    await assertUniqueActiveColorName(colors, color);
    await colors.replaceOne({ id }, color);
    return sendJson(response, 200, color);
  }

  if (request.method === 'DELETE') {
    await requirePasswordConfirmation(request, user);
    const products = await getProductsCollection();
    const linkedProduct = await products.findOne({
      $or: [
        { colorId: id },
        { 'colors.colorId': id },
      ],
    }, { projection: { _id: 0, id: 1, name: 1 } });

    if (linkedProduct) {
      throw new HttpError(`A cor está vinculada ao produto "${linkedProduct.name}". Inative a cor em vez de excluí-la.`, 409);
    }

    await colors.deleteOne({ id });
    return sendEmpty(response, 204);
  }

  return sendJson(response, 405, { error: 'Método não permitido para esta rota.' });
}


async function handleCategoryRoutes(request, response, segments) {
  const categories = await getCategoriesCollection();

  if (segments.length === 2 && segments[1] === 'public' && request.method === 'GET') {
    const items = await categories
      .find({ active: { $ne: false } }, { projection: { _id: 0 } })
      .sort({ name: 1 })
      .toArray();
    return sendJson(response, 200, items);
  }

  const user = await requireAuth(request);

  if (segments.length === 1 && request.method === 'GET') {
    const items = await categories.find({}, { projection: { _id: 0 } }).sort({ name: 1 }).toArray();
    return sendJson(response, 200, items);
  }

  if (segments.length === 1 && request.method === 'POST') {
    const payload = await readJson(request);
    const category = normalizeCatalogCategory(payload);
    await assertUniqueActiveCategoryName(categories, category);
    await categories.insertOne(category);
    return sendJson(response, 201, category);
  }

  const id = decodeURIComponent(segments[1] || '');

  if (!id || segments.length !== 2) {
    return sendJson(response, 404, { error: 'Categoria não encontrada.' });
  }

  const existingCategory = await categories.findOne({ id }, { projection: { _id: 0 } });

  if (!existingCategory) {
    return sendJson(response, 404, { error: 'Categoria não encontrada.' });
  }

  if (request.method === 'PUT' || request.method === 'PATCH') {
    const payload = await readJson(request);
    const category = normalizeCatalogCategory(
      request.method === 'PATCH' ? { ...existingCategory, ...payload, id } : { ...payload, id },
      existingCategory,
    );
    await assertUniqueActiveCategoryName(categories, category);
    await categories.replaceOne({ id }, category);

    if (existingCategory.name !== category.name) {
      const products = await getProductsCollection();
      await products.updateMany({ category: existingCategory.name }, { $set: { category: category.name } });
      await products.updateMany({ categories: existingCategory.name }, { $set: { 'categories.$': category.name } });
    }

    return sendJson(response, 200, category);
  }

  if (request.method === 'DELETE') {
    await requirePasswordConfirmation(request, user);
    const products = await getProductsCollection();
    const linkedProduct = await products.findOne({
      $or: [
        { category: existingCategory.name },
        { categories: existingCategory.name },
        { categoryIds: id },
      ],
    }, { projection: { _id: 0, id: 1, name: 1 } });

    if (linkedProduct) {
      throw new HttpError(`A categoria está vinculada ao produto "${linkedProduct.name}". Inative a categoria em vez de excluí-la.`, 409);
    }

    await categories.deleteOne({ id });
    return sendEmpty(response, 204);
  }

  return sendJson(response, 405, { error: 'Método não permitido para esta rota.' });
}

async function handleAdminRoutes(request, response, segments) {
  const user = await requireAuth(request);

  if (segments.length === 2 && segments[1] === 'collections' && request.method === 'GET') {
    const entries = await Promise.all(
      ['products', 'stores', 'orders', 'users'].map(async (collectionKey) => {
        const collection = await getKnownCollection(collectionKey);
        return [collectionKey, await collection.countDocuments({})];
      }),
    );

    return sendJson(response, 200, Object.fromEntries(entries));
  }

  if (segments.length === 3 && segments[1] === 'collections' && request.method === 'DELETE') {
    await requirePasswordConfirmation(request, user);
    const collectionKey = decodeURIComponent(segments[2] || '');
    const collection = await getKnownCollection(collectionKey);
    const result = await collection.deleteMany({});

    if (collectionKey === 'stores') {
      await ensureDefaultStore(collection);
    }

    return sendJson(response, 200, {
      collection: collectionKey,
      deletedCount: result.deletedCount || 0,
    });
  }

  return sendJson(response, 404, { error: 'Rota não encontrada.' });
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

async function getOrdersCollection() {
  const client = await getMongoClient();
  const dbName = process.env.MONGODB_DB || 'tech-tees-admin';
  const collectionName = process.env.MONGODB_ORDERS_COLLECTION || 'orders';
  const collection = client.db(dbName).collection(collectionName);

  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex({ storeId: 1, createdAt: -1 });
  await collection.createIndex({ externalReference: 1 });

  return collection;
}

async function getColorsCollection() {
  const client = await getMongoClient();
  const dbName = process.env.MONGODB_DB || 'tech-tees-admin';
  const collectionName = process.env.MONGODB_COLORS_COLLECTION || 'colors';
  const collection = client.db(dbName).collection(collectionName);

  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex({ normalizedName: 1 });
  await ensureInitialColors(collection);

  return collection;
}

async function getCategoriesCollection() {
  const client = await getMongoClient();
  const dbName = process.env.MONGODB_DB || 'tech-tees-admin';
  const collectionName = process.env.MONGODB_CATEGORIES_COLLECTION || 'categories';
  const collection = client.db(dbName).collection(collectionName);

  await collection.createIndex({ id: 1 }, { unique: true });
  await collection.createIndex({ normalizedName: 1 });
  await collection.createIndex({ slug: 1 });
  await ensureInitialCategories(collection);

  return collection;
}

async function getKnownCollection(collectionKey) {
  if (collectionKey === 'products') {
    return await getProductsCollection();
  }

  if (collectionKey === 'stores') {
    return await getStoresCollection();
  }

  if (collectionKey === 'users') {
    return await getUsersCollection();
  }

  if (collectionKey === 'orders') {
    return await getOrdersCollection();
  }

  if (collectionKey === 'categories') {
    return await getCategoriesCollection();
  }

  throw new HttpError('Collection inválida.', 400);
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

async function createMercadoPagoPreference(payload = {}) {
  const accessToken = String(process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim();

  if (!accessToken) {
    throw new HttpError('MERCADO_PAGO_ACCESS_TOKEN não configurado.', 503);
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const normalizedItems = items.map(normalizeCheckoutItem);

  if (normalizedItems.length === 0) {
    throw new HttpError('O carrinho está vazio.', 400);
  }

  validateCheckoutSelections(normalizedItems);
  await validateCheckoutInventory(normalizedItems);

  const shippingCost = toNumber(payload.shipping ?? payload.shippingCost, 0);
  if (shippingCost > 0) {
    normalizedItems.push({
      id: 'shipping',
      title: 'Frete',
      quantity: 1,
      unit_price: Number(shippingCost.toFixed(2)),
      currency_id: 'BRL',
    });
  }

  const ecommerceBaseUrl = String(process.env.ECOMMERCE_BASE_URL || 'http://localhost:4200').replace(/\/+$/, '');
  const appBaseUrl = String(process.env.APP_BASE_URL || process.env.API_BASE_URL || '').replace(/\/+$/, '');
  const externalReference = payload.orderId || generateId();
  const backUrls = createCheckoutBackUrls(ecommerceBaseUrl);
  const notificationUrl = createMercadoPagoNotificationUrl(appBaseUrl);

  const preferencePayload = {
    items: normalizedItems.map((item) => ({
      id: item.id,
      title: item.title,
      quantity: item.quantity,
      unit_price: item.unit_price,
      currency_id: item.currency_id,
      picture_url: item.picture_url,
    })),
    external_reference: externalReference,
    statement_descriptor: 'TECH TEES',
    metadata: {
      order_id: externalReference,
      store_id: payload.storeId || null,
    },
    back_urls: backUrls,
    notification_url: notificationUrl,
    auto_return: isPublicHttpUrl(backUrls?.success) ? 'approved' : undefined,
  };

  const mercadoPagoResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(preferencePayload),
  });

  const responseBody = await mercadoPagoResponse.json().catch(() => ({}));

  if (!mercadoPagoResponse.ok) {
    const mercadoPagoError = normalizeMercadoPagoError(responseBody);
    console.error('Mercado Pago preference error', {
      status: mercadoPagoResponse.status,
      error: mercadoPagoError.error,
      message: mercadoPagoError.message,
      cause: mercadoPagoError.cause,
    });

    throw new HttpError(
      createMercadoPagoErrorMessage(mercadoPagoResponse.status, mercadoPagoError),
      mercadoPagoResponse.status,
    );
  }

  return {
    id: responseBody.id,
    initPoint: responseBody.init_point,
    sandboxInitPoint: responseBody.sandbox_init_point,
    externalReference,
  };
}

function createCheckoutBackUrls(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');

  if (!normalizedBaseUrl) {
    return undefined;
  }

  try {
    const success = new URL('/?payment=success', normalizedBaseUrl);
    const failure = new URL('/?payment=failure', normalizedBaseUrl);
    const pending = new URL('/?payment=pending', normalizedBaseUrl);

    return {
      success: success.toString(),
      failure: failure.toString(),
      pending: pending.toString(),
    };
  } catch {
    throw new HttpError('ECOMMERCE_BASE_URL precisa ser uma URL absoluta válida.', 503);
  }
}

function createMercadoPagoNotificationUrl(baseUrl) {
  const normalizedBaseUrl = String(baseUrl || '').trim().replace(/\/+$/, '');

  if (!normalizedBaseUrl) {
    return undefined;
  }

  let notificationUrl;

  try {
    notificationUrl = new URL('/webhooks/mercado-pago', normalizedBaseUrl).toString();
  } catch {
    throw new HttpError('APP_BASE_URL/API_BASE_URL precisa ser uma URL absoluta válida.', 503);
  }

  return isPublicHttpUrl(notificationUrl) ? notificationUrl : undefined;
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const isLocalhost = hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname.endsWith('.local');
    const isPrivateIp = /^10\./.test(hostname)
      || /^192\.168\./.test(hostname)
      || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname);

    return ['http:', 'https:'].includes(url.protocol) && !isLocalhost && !isPrivateIp;
  } catch {
    return false;
  }
}

function normalizeMercadoPagoError(responseBody = {}) {
  const cause = Array.isArray(responseBody.cause)
    ? responseBody.cause.map((item) => ({
        code: item?.code,
        description: item?.description,
      }))
    : [];

  return {
    error: responseBody.error || null,
    message: responseBody.message || null,
    cause,
  };
}

function createMercadoPagoErrorMessage(statusCode, mercadoPagoError) {
  const causeText = mercadoPagoError.cause
    .map((item) => [item.code, item.description].filter(Boolean).join(': '))
    .filter(Boolean)
    .join(' | ');
  const rawMessage = mercadoPagoError.message || mercadoPagoError.error || causeText;
  const unauthorizedPolicy = statusCode === 403
    && /unauthorized|policy/i.test([mercadoPagoError.error, rawMessage, causeText].filter(Boolean).join(' '));

  if (unauthorizedPolicy) {
    return 'Mercado Pago recusou a operação: confira se MERCADO_PAGO_ACCESS_TOKEN é um Access Token válido, ativo e do mesmo ambiente da conta.';
  }

  if (statusCode === 401 && /unauthorized use of live credentials/i.test(rawMessage)) {
    return 'Mercado Pago recusou credenciais de produção neste pagamento. Para testar, use Public Key e Access Token TEST- e um comprador/cartão de teste; em produção, use APP_USR- com comprador real.';
  }

  if (statusCode === 401 && /access_token/i.test(rawMessage)) {
    return 'Mercado Pago não reconheceu o Access Token. Confira se MERCADO_PAGO_ACCESS_TOKEN recebeu o Access Token TEST-/APP_USR-, não a Public Key.';
  }

  return rawMessage || 'Não foi possível criar a preferência de pagamento.';
}

async function createMercadoPagoPayment(payload = {}) {
  const accessToken = String(process.env.MERCADO_PAGO_ACCESS_TOKEN || '').trim();

  if (!accessToken) {
    throw new HttpError('MERCADO_PAGO_ACCESS_TOKEN não configurado.', 503);
  }

  const items = Array.isArray(payload.items) ? payload.items : [];
  const normalizedItems = items.map(normalizeCheckoutItem);

  if (normalizedItems.length === 0) {
    throw new HttpError('O carrinho está vazio.', 400);
  }

  validateCheckoutSelections(normalizedItems);
  await validateCheckoutInventory(normalizedItems);

  const shippingCost = toNumber(payload.shipping ?? payload.shippingCost, 0);
  const transactionAmount = calculateCheckoutAmount(normalizedItems, shippingCost);
  const formData = await normalizeMercadoPagoPaymentFormData(payload.payment || payload.formData || {});
  const externalReference = payload.orderId || generateId();
  const buyerName = String(payload.buyerName || formData.shippingAddress?.fullName || formData.cardholderName || '').trim();
  const appBaseUrl = String(process.env.APP_BASE_URL || process.env.API_BASE_URL || '').replace(/\/+$/, '');
  const notificationUrl = createMercadoPagoNotificationUrl(appBaseUrl);
  const paymentMetadata = removeUndefinedValues({
    order_id: externalReference,
    store_id: payload.storeId,
    buyer_name: buyerName,
  });

  await upsertCheckoutOrderDraft(normalizedItems, {
    externalReference,
    buyerName,
    payerEmail: formData.payerEmail,
    shippingAddress: formData.shippingAddress,
    shippingCost,
    totalAmount: transactionAmount,
    storeId: payload.storeId,
  });

  const paymentPayload = removeUndefinedValues({
    token: formData.token,
    issuer_id: formData.issuerId,
    payment_method_id: formData.paymentMethodId,
    transaction_amount: transactionAmount,
    installments: formData.installments,
    description: `Tech Tees - pedido ${externalReference}`,
    external_reference: externalReference,
    notification_url: notificationUrl,
    metadata: paymentMetadata,
    payer: {
      email: formData.payerEmail,
      identification: formData.identification,
    },
  });

  const mercadoPagoResponse = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': randomUUID(),
    },
    body: JSON.stringify(paymentPayload),
  });

  const responseBody = await mercadoPagoResponse.json().catch(() => ({}));

  if (!mercadoPagoResponse.ok) {
    const mercadoPagoError = normalizeMercadoPagoError(responseBody);
    console.error('Mercado Pago payment error', {
      status: mercadoPagoResponse.status,
      error: mercadoPagoError.error,
      message: mercadoPagoError.message,
      statusDetail: responseBody.status_detail,
      cause: mercadoPagoError.cause,
      payment: {
        transactionAmount: paymentPayload.transaction_amount,
        installments: paymentPayload.installments,
        paymentMethodId: paymentPayload.payment_method_id,
        issuerId: paymentPayload.issuer_id,
        payerEmail: paymentPayload.payer?.email,
        notificationUrlPresent: Boolean(paymentPayload.notification_url),
      },
    });

    throw new HttpError(
      createMercadoPagoErrorMessage(mercadoPagoResponse.status, mercadoPagoError),
      mercadoPagoResponse.status,
    );
  }

  if (responseBody.status === 'approved') {
    await registerApprovedCheckout(normalizedItems, {
      externalReference,
      paymentId: responseBody.id,
      paymentStatus: responseBody.status,
      buyerName,
      payerEmail: formData.payerEmail,
      shippingAddress: formData.shippingAddress,
      shippingCost,
      totalAmount: transactionAmount,
      storeId: payload.storeId,
    });
  }

  return {
    id: responseBody.id,
    status: responseBody.status,
    statusDetail: responseBody.status_detail,
    paymentMethodId: responseBody.payment_method_id,
    externalReference,
  };
}

async function validateCheckoutInventory(items) {
  const products = await getProductsCollection();
  const saleItems = items.filter((item) => item.id !== 'shipping');

  await Promise.all(
    saleItems.map(async (item) => {
      const product = await products.findOne(
        { id: item.id },
        { projection: { id: 1, name: 1, stock: 1, status: 1 } },
      );

      if (!product || product.status !== 'active') {
        throw new HttpError(`Produto indisponível: ${item.title}.`, 409);
      }

      if (toNumber(product.stock, 0) < item.quantity) {
        throw new HttpError(`Estoque insuficiente para ${product.name || item.title}.`, 409);
      }
    }),
  );
}

async function registerApprovedCheckout(items, orderInput = {}) {
  const products = await getProductsCollection();
  const orders = await getOrdersCollection();
  const now = new Date().toISOString();
  const saleItems = items.filter((item) => item.id !== 'shipping');
  const externalReference = String(orderInput.externalReference || generateId());
  const existingOrder = await orders.findOne({ externalReference }, { projection: { _id: 0 } });

  if (existingOrder?.paymentStatus === 'approved') {
    return;
  }

  const orderItems = saleItems.length > 0
    ? saleItems
    : (existingOrder?.items || []).map((item) => ({
        id: item.productId,
        title: item.title,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        selectedColor: item.selectedColor,
        selectedSize: item.selectedSize,
        selectedGender: item.selectedGender,
      }));

  if (orderItems.length === 0) {
    console.warn('Approved checkout without order items', { externalReference });
    return;
  }

  const productDocuments = await products.find(
    { id: { $in: orderItems.map((item) => item.id) } },
    { projection: { _id: 0, id: 1, storeId: 1 } },
  ).toArray();
  const productById = new Map(productDocuments.map((product) => [product.id, product]));
  const storeId = String(orderInput.storeId || productDocuments[0]?.storeId || DEFAULT_STORE.id);

  await Promise.all(
    orderItems.map((item) =>
      products.updateOne(
        { id: item.id },
        {
          $inc: {
            sales: item.quantity,
            stock: -item.quantity,
          },
          $set: {
            updatedAt: now,
          },
        },
      ),
    ),
  );

  const subtotal = Number(orderItems.reduce((total, item) => total + item.unit_price * item.quantity, 0).toFixed(2));
  const shipping = Number(Math.max(0, toNumber(orderInput.shippingCost ?? existingOrder?.shipping, 0)).toFixed(2));
  const total = Number(toNumber(orderInput.totalAmount, subtotal + shipping).toFixed(2));
  const order = {
    id: existingOrder?.id || generateId(),
    externalReference,
    paymentId: orderInput.paymentId ? String(orderInput.paymentId) : '',
    paymentStatus: String(orderInput.paymentStatus || 'approved'),
    storeId,
    buyerName: String(orderInput.buyerName || existingOrder?.buyerName || '').trim() || 'Comprador não informado',
    payerEmail: String(orderInput.payerEmail || existingOrder?.payerEmail || '').trim(),
    quantity: orderItems.reduce((totalQuantity, item) => totalQuantity + item.quantity, 0),
    subtotal,
    shipping,
    total,
    items: orderItems.map((item) => ({
      productId: item.id,
      title: item.title,
      quantity: item.quantity,
      unitPrice: item.unit_price,
      storeId: productById.get(item.id)?.storeId || storeId,
      selectedColor: item.selectedColor || null,
      selectedSize: item.selectedSize || null,
      selectedGender: item.selectedGender || null,
    })),
    shippingAddress: orderInput.shippingAddress || existingOrder?.shippingAddress || null,
    createdAt: existingOrder?.createdAt || now,
    updatedAt: now,
  };

  await orders.updateOne(
    { externalReference: order.externalReference },
    { $set: order },
    { upsert: true },
  );
}

async function upsertCheckoutOrderDraft(items, orderInput = {}) {
  const products = await getProductsCollection();
  const orders = await getOrdersCollection();
  const now = new Date().toISOString();
  const saleItems = items.filter((item) => item.id !== 'shipping');
  const productDocuments = await products.find(
    { id: { $in: saleItems.map((item) => item.id) } },
    { projection: { _id: 0, id: 1, storeId: 1 } },
  ).toArray();
  const productById = new Map(productDocuments.map((product) => [product.id, product]));
  const storeId = String(orderInput.storeId || productDocuments[0]?.storeId || DEFAULT_STORE.id);
  const subtotal = Number(saleItems.reduce((total, item) => total + item.unit_price * item.quantity, 0).toFixed(2));
  const shipping = Number(Math.max(0, toNumber(orderInput.shippingCost, 0)).toFixed(2));
  const total = Number(toNumber(orderInput.totalAmount, subtotal + shipping).toFixed(2));

  await orders.updateOne(
    { externalReference: String(orderInput.externalReference) },
    {
      $setOnInsert: {
        id: generateId(),
        externalReference: String(orderInput.externalReference),
        paymentStatus: 'created',
        createdAt: now,
      },
      $set: {
        storeId,
        buyerName: String(orderInput.buyerName || '').trim() || 'Comprador não informado',
        payerEmail: String(orderInput.payerEmail || '').trim(),
        quantity: saleItems.reduce((totalQuantity, item) => totalQuantity + item.quantity, 0),
        subtotal,
        shipping,
        total,
        items: saleItems.map((item) => ({
          productId: item.id,
          title: item.title,
          quantity: item.quantity,
          unitPrice: item.unit_price,
          storeId: productById.get(item.id)?.storeId || storeId,
          selectedColor: item.selectedColor || null,
          selectedSize: item.selectedSize || null,
          selectedGender: item.selectedGender || null,
        })),
        shippingAddress: orderInput.shippingAddress || null,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
}

function calculateCheckoutAmount(items, shippingCost = 0) {
  const itemsAmount = items.reduce((total, item) => total + item.unit_price * item.quantity, 0);
  return Number((itemsAmount + Math.max(0, shippingCost)).toFixed(2));
}

function validateCheckoutSelections(items) {
  const invalidItem = items.find((item) => item.id !== 'shipping' && (!item.selectedSize || !item.selectedGender));

  if (invalidItem) {
    throw new HttpError(`Selecione tamanho e gênero para ${invalidItem.title}.`, 400);
  }
}

async function normalizeMercadoPagoPaymentFormData(formData = {}) {
  const cardData = formData.card || {};
  const cardTokenData = formData.token ? null : await createMercadoPagoCardToken(cardData, formData);
  const token = String(formData.token || '').trim();
  const paymentMethodId = String(
    formData.payment_method_id
      || formData.paymentMethodId
      || cardTokenData?.paymentMethodId
      || '',
  ).trim();
  const issuerId = String(formData.issuer_id || formData.issuerId || cardTokenData?.issuerId || '').trim();
  const installments = Math.max(1, Math.floor(toNumber(formData.installments, 1)));
  const payer = formData.payer || {};
  const payerEmail = String(payer.email || formData.payer_email || formData.email || cardData.email || '').trim();
  const identification = payer.identification || formData.identification || {};
  const identificationType = String(identification.type || '').trim();
  const identificationNumber = String(identification.number || '').replace(/\D/g, '');

  if (!token && !cardTokenData?.token) {
    throw new HttpError('Token do cartão não informado.', 400);
  }

  if (!paymentMethodId) {
    throw new HttpError('Meio de pagamento não informado.', 400);
  }

  if (!payerEmail) {
    throw new HttpError('E-mail do pagador não informado.', 400);
  }

  if (!identificationType || !identificationNumber) {
    throw new HttpError('Documento do pagador não informado.', 400);
  }

  return {
    token: token || cardTokenData.token,
    paymentMethodId,
    issuerId,
    installments,
    payerEmail,
    shippingAddress: formData.shippingAddress || null,
    cardholderName: String(formData.cardholderName || cardData.cardholderName || '').trim(),
    identification: {
      type: identificationType,
      number: identificationNumber,
    },
  };
}

async function createMercadoPagoCardToken(cardData = {}, formData = {}) {
  const publicKey = String(process.env.MERCADO_PAGO_PUBLIC_KEY || '').trim();

  if (!publicKey) {
    throw new HttpError('MERCADO_PAGO_PUBLIC_KEY não configurada para tokenização local.', 503);
  }

  const cardNumber = String(cardData.cardNumber || '').replace(/\D/g, '');
  const securityCode = String(cardData.securityCode || '').replace(/\D/g, '');
  const cardholderName = String(cardData.cardholderName || '').trim();
  const expiration = parseCardExpiration(cardData.expirationDate || cardData.expiration);
  const identificationType = String(cardData.identificationType || formData.identification?.type || 'CPF').trim();
  const identificationNumber = String(cardData.identificationNumber || formData.identification?.number || '').replace(/\D/g, '');

  if (!cardNumber || cardNumber.length < 12) {
    throw new HttpError('Número do cartão inválido.', 400);
  }

  if (!securityCode || !cardholderName || !identificationNumber) {
    throw new HttpError('Preencha nome, CVV e documento do cartão.', 400);
  }

  const cardTokenResponse = await fetch(`https://api.mercadopago.com/v1/card_tokens?public_key=${encodeURIComponent(publicKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      card_number: cardNumber,
      expiration_month: expiration.month,
      expiration_year: expiration.year,
      security_code: securityCode,
      cardholder: {
        name: cardholderName,
        identification: {
          type: identificationType,
          number: identificationNumber,
        },
      },
    }),
  });
  const cardTokenBody = await cardTokenResponse.json().catch(() => ({}));

  if (!cardTokenResponse.ok) {
    const mercadoPagoError = normalizeMercadoPagoError(cardTokenBody);
    throw new HttpError(createMercadoPagoErrorMessage(cardTokenResponse.status, mercadoPagoError), cardTokenResponse.status);
  }

  const paymentMethod = await findMercadoPagoPaymentMethod(publicKey, cardNumber.slice(0, 6));

  return {
    token: cardTokenBody.id,
    paymentMethodId: paymentMethod.id,
    issuerId: paymentMethod.issuerId,
  };
}

async function findMercadoPagoPaymentMethod(publicKey, bin) {
  const paymentMethodsResponse = await fetch(
    `https://api.mercadopago.com/v1/payment_methods/search?public_key=${encodeURIComponent(publicKey)}&bins=${encodeURIComponent(bin)}`,
  );
  const paymentMethodsBody = await paymentMethodsResponse.json().catch(() => ({}));
  const paymentMethod = Array.isArray(paymentMethodsBody.results) ? paymentMethodsBody.results[0] : null;

  if (!paymentMethodsResponse.ok || !paymentMethod?.id) {
    throw new HttpError('Não foi possível identificar a bandeira do cartão.', 400);
  }

  return {
    id: paymentMethod.id,
    issuerId: paymentMethod.issuer?.id ? String(paymentMethod.issuer.id) : '',
  };
}

function parseCardExpiration(value) {
  const [monthValue, yearValue] = String(value || '').split('/').map((part) => part.trim());
  const month = Number(monthValue);
  const year = Number(yearValue?.length === 2 ? `20${yearValue}` : yearValue);

  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < new Date().getFullYear()) {
    throw new HttpError('Validade do cartão inválida. Use MM/AAAA.', 400);
  }

  return { month, year };
}

function removeUndefinedValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined && entryValue !== ''),
  );
}

function normalizeCheckoutItem(item = {}) {
  const title = String(item.title || item.name || '').trim();
  const quantity = Math.max(1, Math.floor(toNumber(item.quantity, 1)));
  const unitPrice = toNumber(item.unitPrice ?? item.unit_price ?? item.price, 0);

  if (!title) {
    throw new HttpError('Todos os itens precisam de título.', 400);
  }

  if (unitPrice <= 0) {
    throw new HttpError('Todos os itens precisam ter preço maior que zero.', 400);
  }

  return {
    id: String(item.id || item.productId || generateId()),
    title,
    quantity,
    unit_price: Number(unitPrice.toFixed(2)),
    currency_id: 'BRL',
    picture_url: item.image || undefined,
    selectedColor: item.selectedColor || item.color || null,
    selectedSize: String(item.selectedSize || item.size || '').trim() || null,
    selectedGender: String(item.selectedGender || item.gender || '').trim() || null,
  };
}

function normalizePaymentMetadataItems(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    try {
      const parsedValue = JSON.parse(value);
      return Array.isArray(parsedValue) ? parsedValue : [];
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeProduct(input = {}, existingProduct = null) {
  const now = new Date().toISOString();
  const name = String(input.name || '').trim();

  if (!name) {
    throw new HttpError('O campo "name" é obrigatório.', 400);
  }

  const categories = toUniqueStringArray(input.categories).length
    ? toUniqueStringArray(input.categories)
    : toUniqueStringArray(existingProduct?.categories).length
      ? toUniqueStringArray(existingProduct.categories)
      : [];
  const category = normalizeWhitespace(input.category || existingProduct?.category || categories[0] || 'Dev');
  const productCategories = categories.length ? categories : [category];

  const status = input.status || existingProduct?.status || 'draft';
  if (!PRODUCT_STATUSES.includes(status)) {
    throw new HttpError(`Status inválido. Use um destes valores: ${PRODUCT_STATUSES.join(', ')}.`, 400);
  }

  const slugInput = String(input.slug || '').trim();
  const fallbackVariation = {
    id: existingProduct?.colors?.[0]?.id || generateId(),
    color: String(input.color || existingProduct?.color || '').trim() || DEFAULT_COLOR,
    colorId: String(input.colorId || existingProduct?.colorId || '').trim(),
    colorHex: String(input.colorHex || existingProduct?.colorHex || '').trim(),
    colorRgb: input.colorRgb || existingProduct?.colorRgb || null,
    image: String(input.image || existingProduct?.image || '').trim() || DEFAULT_IMAGE,
    imageBack: String(input.imageBack || existingProduct?.imageBack || '').trim(),
  };
  const colors = normalizeProductColors(input, existingProduct, fallbackVariation);
  const primaryVariation = colors[0] || fallbackVariation;

  return {
    id: String(existingProduct?.id || input.id || generateId()),
    storeId: String(input.storeId || existingProduct?.storeId || DEFAULT_STORE.id),
    name,
    slug: slugInput || createSlug(name),
    category: productCategories[0] || category,
    categories: productCategories,
    price: toNumber(input.price, 0),
    compareAtPrice: toNullableNumber(input.compareAtPrice),
    cost: toNullableNumber(input.cost),
    stock: toNumber(input.stock, 0),
    sku: String(input.sku || '').trim() || generateSku(),
    color: primaryVariation.color,
    colorId: primaryVariation.colorId || '',
    colorHex: primaryVariation.colorHex || '',
    colorRgb: primaryVariation.colorRgb || null,
    colors,
    sizes: toStringArray(input.sizes).length ? toStringArray(input.sizes) : ['P', 'M', 'G'],
    genders: toStringArray(input.genders).length ? toStringArray(input.genders) : ['Masculino', 'Feminino'],
    image: primaryVariation.image,
    imageBack: primaryVariation.imageBack || '',
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

function normalizeProductColors(input = {}, existingProduct = null, fallbackVariation) {
  const hasColorsPayload = Object.prototype.hasOwnProperty.call(input, 'colors');
  const source = hasColorsPayload
    ? input.colors
    : Array.isArray(existingProduct?.colors) && existingProduct.colors.length > 0
      ? existingProduct.colors
      : [fallbackVariation];

  const normalizedColors = Array.isArray(source)
    ? source.map((variation, index) => normalizeProductColorVariation(variation, fallbackVariation, index))
    : [];

  const validColors = normalizedColors.filter((variation) => variation.color || variation.image || variation.imageBack);

  if (validColors.length === 0) {
    return [normalizeProductColorVariation(fallbackVariation, fallbackVariation, 0)];
  }

  return validColors.map((variation, index) => ({
    ...variation,
    id: variation.id || generateId(),
    color: variation.color || (index === 0 ? DEFAULT_COLOR : `Cor ${index + 1}`),
    image: variation.image || fallbackVariation.image || DEFAULT_IMAGE,
  }));
}

function normalizeProductColorVariation(variation = {}, fallbackVariation = {}, index = 0) {
  return {
    id: String(variation.id || '').trim() || generateId(),
    color: String(variation.color || (index === 0 ? fallbackVariation.color : '') || '').trim(),
    colorId: String(variation.colorId || (index === 0 ? fallbackVariation.colorId : '') || '').trim(),
    colorHex: normalizeHex(variation.colorHex || (index === 0 ? fallbackVariation.colorHex : ''), true),
    colorRgb: normalizeOptionalRgb(variation.colorRgb || (index === 0 ? fallbackVariation.colorRgb : null)),
    image: String(variation.image || (index === 0 ? fallbackVariation.image : '') || '').trim(),
    imageBack: String(variation.imageBack || (index === 0 ? fallbackVariation.imageBack : '') || '').trim(),
  };
}

function normalizeColor(input = {}, existingColor = null) {
  const now = new Date().toISOString();
  const name = normalizeWhitespace(input.name);

  if (!name) {
    throw new HttpError('O nome da cor é obrigatório.', 400);
  }

  const rgb = normalizeRgb(input.rgb);

  return {
    id: String(existingColor?.id || input.id || generateId()),
    name,
    normalizedName: normalizeColorName(name),
    rgb,
    hex: rgbToHex(rgb),
    active: input.active !== false,
    createdAt: existingColor?.createdAt || String(input.createdAt || now),
    updatedAt: now,
  };
}

async function assertUniqueActiveColorName(collection, color) {
  if (!color.active) {
    return;
  }

  const duplicate = await collection.findOne({
    id: { $ne: color.id },
    normalizedName: color.normalizedName,
    active: true,
  });

  if (duplicate) {
    throw new HttpError(`Já existe uma cor ativa chamada "${color.name}".`, 409);
  }
}

async function ensureInitialColors(collection) {
  const now = new Date().toISOString();
  const operations = INITIAL_COLORS.map(([name, r, g, b]) => {
    const rgb = { r, g, b };
    const normalizedName = normalizeColorName(name);
    return {
      updateOne: {
        filter: { normalizedName },
        update: {
          $setOnInsert: {
            id: generateId(),
            name,
            normalizedName,
            rgb,
            hex: rgbToHex(rgb),
            active: true,
            createdAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    };
  });

  await collection.bulkWrite(operations, { ordered: false });
}


function normalizeCatalogCategory(input = {}, existingCategory = null) {
  const now = new Date().toISOString();
  const name = normalizeWhitespace(input.name);

  if (!name) {
    throw new HttpError('O nome da categoria é obrigatório.', 400);
  }

  return {
    id: String(existingCategory?.id || input.id || generateId()),
    name,
    slug: createSlug(input.slug || name),
    normalizedName: normalizeCategoryName(name),
    active: input.active !== false,
    createdAt: existingCategory?.createdAt || String(input.createdAt || now),
    updatedAt: now,
  };
}

async function assertUniqueActiveCategoryName(collection, category) {
  if (!category.active) {
    return;
  }

  const duplicate = await collection.findOne({
    id: { $ne: category.id },
    normalizedName: category.normalizedName,
    active: true,
  });

  if (duplicate) {
    throw new HttpError(`Já existe uma categoria ativa chamada "${category.name}".`, 409);
  }
}

async function ensureInitialCategories(collection) {
  const now = new Date().toISOString();
  const operations = INITIAL_CATEGORIES.map((name) => {
    const normalizedName = normalizeCategoryName(name);
    return {
      updateOne: {
        filter: { normalizedName },
        update: {
          $setOnInsert: {
            id: generateId(),
            name,
            slug: createSlug(name),
            normalizedName,
            active: true,
            createdAt: now,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    };
  });

  if (operations.length) {
    await collection.bulkWrite(operations, { ordered: false });
  }
}

function normalizeRgb(value = {}) {
  const rgb = {
    r: normalizeRgbChannel(value.r, 'R'),
    g: normalizeRgbChannel(value.g, 'G'),
    b: normalizeRgbChannel(value.b, 'B'),
  };
  return rgb;
}

function normalizeOptionalRgb(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  try {
    return normalizeRgb(value);
  } catch {
    return null;
  }
}

function normalizeRgbChannel(value, channel) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 0 || number > 255) {
    throw new HttpError(`O canal ${channel} deve ser um número inteiro entre 0 e 255.`, 400);
  }

  return number;
}

function rgbToHex(rgb) {
  return `#${[rgb.r, rgb.g, rgb.b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function normalizeHex(value, optional = false) {
  const hex = String(value || '').trim().toUpperCase();

  if (!hex && optional) {
    return '';
  }

  if (!/^#[0-9A-F]{6}$/.test(hex)) {
    throw new HttpError('HEX inválido.', 400);
  }

  return hex;
}

function normalizeWhitespace(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeColorName(value) {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeCategoryName(value) {
  return normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

async function attachCatalogColors(products) {
  const colorsCollection = await getColorsCollection();
  const catalogColors = await colorsCollection.find({}, { projection: { _id: 0 } }).toArray();
  const colorsByName = new Map(catalogColors.map((color) => [color.normalizedName, color]));
  const aliases = new Map([
    ['preta', 'preto'],
    ['branca', 'branco'],
    ['verde', 'verde bandeira'],
    ['cinza', 'cinza mescla'],
  ]);

  const resolveColor = (name) => {
    const normalizedName = normalizeColorName(name);
    return colorsByName.get(aliases.get(normalizedName) || normalizedName);
  };

  return products.map((product) => {
    const sourceVariations = Array.isArray(product.colors) && product.colors.length > 0
      ? product.colors
      : [{
          id: product.id,
          color: product.color,
          colorId: product.colorId,
          colorHex: product.colorHex,
          colorRgb: product.colorRgb,
          image: product.image,
          imageBack: product.imageBack,
        }];
    const colors = sourceVariations.map((variation) => {
      const catalogColor = variation.colorId
        ? catalogColors.find((color) => color.id === variation.colorId)
        : resolveColor(variation.color);

      return catalogColor
        ? {
            ...variation,
            color: catalogColor.name,
            colorId: catalogColor.id,
            colorHex: catalogColor.hex,
            colorRgb: catalogColor.rgb,
          }
        : variation;
    });
    const primaryColor = colors[0];

    return {
      ...product,
      color: primaryColor?.color || product.color,
      colorId: primaryColor?.colorId || product.colorId || '',
      colorHex: primaryColor?.colorHex || product.colorHex || '',
      colorRgb: primaryColor?.colorRgb || product.colorRgb || null,
      colors,
    };
  });
}

const DEFAULT_STORE = {
  id: 'default-store',
  name: 'Tech Tees',
  slug: 'tech-tees',
  description: 'Loja padrão da Tech Tees',
  defaultShipping: 0,
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
    defaultShipping: Math.max(0, toNumber(input.defaultShipping ?? existingStore?.defaultShipping, 0)),
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
      categories: ['Dev'],
      price: 89.9,
      compareAtPrice: 119.9,
      cost: 42,
      stock: 32,
      sku: 'TT-DEV-001',
      color: 'Preta',
      sizes: ['P', 'M', 'G', 'GG'],
      image: DEFAULT_IMAGE,
      imageBack: '',
      colors: [{
        id: generateId(),
        color: 'Preta',
        image: DEFAULT_IMAGE,
        imageBack: '',
      }],
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

async function requirePasswordConfirmation(request, user) {
  const payload = await readJson(request);
  const password = String(payload.password || '').trim();

  if (!password) {
    throw new HttpError('Informe sua senha para confirmar a exclusão.', 400);
  }

  if (!verifyPassword(password, user.passwordHash)) {
    throw new HttpError('Senha inválida. Exclusão cancelada.', 403);
  }
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
    photoURL: user.photoURL || '',
  };
}

async function verifyFirebaseIdToken(idToken) {
  const apiKey = String(process.env.FIREBASE_API_KEY || '').trim();

  if (!apiKey) {
    throw new HttpError('FIREBASE_API_KEY não configurada na API.', 503);
  }

  if (!idToken) {
    throw new HttpError('Token do Firebase não informado.', 400);
  }

  const firebaseResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    },
  );
  const responseBody = await firebaseResponse.json().catch(() => ({}));
  const firebaseUser = Array.isArray(responseBody.users) ? responseBody.users[0] : null;

  if (!firebaseResponse.ok || !firebaseUser?.localId || !firebaseUser?.email) {
    throw new HttpError('Não foi possível validar sua conta Google.', 401);
  }

  return firebaseUser;
}

function isAuthorizedAdminEmail(email) {
  const authorizedEmails = String(process.env.AUTHORIZED_ADMIN_EMAILS || '')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);

  return authorizedEmails.includes(normalizeEmail(email));
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

function toUniqueStringArray(value) {
  return [...new Set(toStringArray(value).map((item) => normalizeWhitespace(item)).filter(Boolean))];
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    ...createCorsHeaders(response),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function sendEmpty(response, statusCode) {
  response.writeHead(statusCode, createCorsHeaders(response));
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

function createCorsHeaders(response) {
  const requestOrigin = String(requestByResponse.get(response)?.headers?.origin || '').trim();
  const configuredOrigins = String(
    process.env.CORS_ORIGINS
    || process.env.CORS_ORIGIN
    || DEFAULT_CORS_ORIGINS.join(','),
  )
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  const normalizedRequestOrigin = requestOrigin.replace(/\/+$/, '');
  const allowOrigin = configuredOrigins.includes(normalizedRequestOrigin)
    ? normalizedRequestOrigin
    : configuredOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

class HttpError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}
