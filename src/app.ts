import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { assertAdminAuthorized } from './auth.js';
import { readJson, sendEmpty, sendError, sendJson } from './http-utils.js';
import type { ProductInput } from './product-contract.js';
import type { ProductsService } from './products-service.js';

export type ProductsServiceProvider = ProductsService | (() => ProductsService | Promise<ProductsService>);

export function createRequestHandler(productsServiceProvider: ProductsServiceProvider) {
  return async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const segments = url.pathname.split('/').filter(Boolean);

      if (request.method === 'OPTIONS') {
        return sendEmpty(response, 204, request);
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        return sendJson(response, 200, { status: 'ok' }, request);
      }

      if (segments[0] !== 'products') {
        return sendJson(response, 404, { error: 'Rota não encontrada.' }, request);
      }

      assertAdminAuthorized(request);

      const productsService = await resolveProductsService(productsServiceProvider);

      if (segments.length === 1) {
        if (request.method === 'GET') {
          return sendJson(response, 200, await productsService.list(), request);
        }

        if (request.method === 'POST') {
          return sendJson(response, 201, await productsService.create(
            await readJson(request) as ProductInput,
          ), request);
        }
      }

      if (segments.length === 2 && segments[1] === 'export' && request.method === 'GET') {
        return sendJson(response, 200, await productsService.export(), request);
      }

      if (segments.length === 2 && segments[1] === 'import' && request.method === 'POST') {
        return sendJson(response, 200, await productsService.import(await readJson(request)), request);
      }

      if (segments.length === 2 && segments[1] === 'reset-seed' && request.method === 'POST') {
        return sendJson(response, 200, await productsService.resetSeed(), request);
      }

      const id = decodeURIComponent(segments[1] ?? '');

      if (segments.length === 2 && request.method === 'GET') {
        const product = await productsService.findById(id);
        return product
          ? sendJson(response, 200, product, request)
          : sendJson(response, 404, { error: 'Produto não encontrado.' }, request);
      }

      if (segments.length === 2 && request.method === 'PUT') {
        const product = await productsService.replace(id, await readJson(request) as ProductInput);
        return product
          ? sendJson(response, 200, product, request)
          : sendJson(response, 404, { error: 'Produto não encontrado.' }, request);
      }

      if (segments.length === 2 && request.method === 'PATCH') {
        const product = await productsService.update(id, await readJson(request) as ProductInput);
        return product
          ? sendJson(response, 200, product, request)
          : sendJson(response, 404, { error: 'Produto não encontrado.' }, request);
      }

      if (segments.length === 2 && request.method === 'DELETE') {
        const removed = await productsService.remove(id);
        return removed
          ? sendEmpty(response, 204, request)
          : sendJson(response, 404, { error: 'Produto não encontrado.' }, request);
      }

      if (segments.length === 3 && segments[2] === 'duplicate' && request.method === 'POST') {
        const product = await productsService.duplicate(id);
        return product
          ? sendJson(response, 201, product, request)
          : sendJson(response, 404, { error: 'Produto não encontrado.' }, request);
      }

      if (segments.length === 3 && segments[2] === 'status' && request.method === 'PATCH') {
        const product = await productsService.toggleStatus(id);
        return product
          ? sendJson(response, 200, product, request)
          : sendJson(response, 404, { error: 'Produto não encontrado.' }, request);
      }

      return sendJson(response, 405, { error: 'Método não permitido para esta rota.' }, request);
    } catch (error) {
      return sendError(response, error, request);
    }
  };
}

export function createApp(productsServiceProvider: ProductsServiceProvider) {
  return createServer(createRequestHandler(productsServiceProvider));
}

async function resolveProductsService(provider: ProductsServiceProvider): Promise<ProductsService> {
  if (typeof provider === 'function') {
    return provider();
  }

  return provider;
}
