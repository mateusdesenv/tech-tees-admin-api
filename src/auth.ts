import type { IncomingMessage } from 'node:http';
import { HttpError } from './product-contract.js';

export function assertAdminAuthorized(request: IncomingMessage): void {
  const expectedToken = String(process.env.ADMIN_API_TOKEN || '').trim();
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';

  if (!expectedToken) {
    if (isProduction) {
      throw new HttpError('ADMIN_API_TOKEN não configurado no ambiente de produção.', 500);
    }

    return;
  }

  const receivedToken = getRequestToken(request);

  if (receivedToken !== expectedToken) {
    throw new HttpError('Não autorizado.', 401);
  }
}

function getRequestToken(request: IncomingMessage): string {
  const authorizationHeader = request.headers.authorization;

  if (authorizationHeader?.startsWith('Bearer ')) {
    return authorizationHeader.slice('Bearer '.length).trim();
  }

  const headerToken = request.headers['x-admin-token'];

  if (Array.isArray(headerToken)) {
    return headerToken[0] ?? '';
  }

  return headerToken ?? '';
}
