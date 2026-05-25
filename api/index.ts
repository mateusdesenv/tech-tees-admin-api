import type { IncomingMessage, ServerResponse } from 'node:http';

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => Promise<void>;

let requestHandlerPromise: Promise<RequestHandler> | null = null;

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (request.method === 'OPTIONS') {
    response.writeHead(204, createCorsHeaders());
    response.end();
    return;
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    response.writeHead(200, {
      ...createCorsHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
    });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  const requestHandler = await getRequestHandler();
  return requestHandler(request, response);
}

async function getRequestHandler(): Promise<RequestHandler> {
  requestHandlerPromise ??= createRequestHandler();
  return requestHandlerPromise;
}

async function createRequestHandler(): Promise<RequestHandler> {
  // Vercel bundles TypeScript functions from source; extensionless imports let
  // its bundler resolve the sibling .ts files instead of looking for .js files.
  const [{ createRequestHandler }, { getProductsServiceLazy }] = await Promise.all([
    // @ts-expect-error See comment above.
    import('../src/app'),
    // @ts-expect-error See comment above.
    import('../src/products-service-factory'),
  ]);

  return createRequestHandler(getProductsServiceLazy);
}

function createCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
