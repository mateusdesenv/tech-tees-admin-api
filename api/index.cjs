let requestHandlerPromise = null;

module.exports = async (request, response) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

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
};

async function getRequestHandler() {
  requestHandlerPromise ||= createRequestHandler();
  return requestHandlerPromise;
}

async function createRequestHandler() {
  const [{ createRequestHandler }, { getProductsServiceLazy }] = await Promise.all([
    import('../dist/src/app.js'),
    import('../dist/src/products-service-factory.js'),
  ]);

  return createRequestHandler(getProductsServiceLazy);
}

function createCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Token',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
