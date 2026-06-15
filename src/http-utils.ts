import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './product-contract.js';

const DEFAULT_MAX_BODY_BYTES = 1_000_000;

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const maxBodyBytes = Number(process.env.MAX_BODY_BYTES || DEFAULT_MAX_BODY_BYTES);
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  const contentLength = Number(request.headers['content-length'] || 0);
  if (contentLength > maxBodyBytes) {
    throw new HttpError(`Payload muito grande. Limite atual: ${maxBodyBytes} bytes.`, 413);
  }

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;

    if (totalBytes > maxBodyBytes) {
      throw new HttpError(`Payload muito grande. Limite atual: ${maxBodyBytes} bytes.`, 413);
    }

    chunks.push(buffer);
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

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  request?: IncomingMessage,
): void {
  response.writeHead(statusCode, {
    ...createCorsHeaders(request),
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

export function sendEmpty(
  response: ServerResponse,
  statusCode: number,
  request?: IncomingMessage,
): void {
  response.writeHead(statusCode, createCorsHeaders(request));
  response.end();
}

export function sendError(response: ServerResponse, error: unknown, request?: IncomingMessage): void {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = statusCode === 500
    ? 'Erro interno do servidor.'
    : error instanceof Error
      ? error.message
      : 'Erro inesperado.';

  sendJson(response, statusCode, { error: message }, request);
}

function createCorsHeaders(request?: IncomingMessage): Record<string, string> {
  const requestOrigin = request?.headers.origin;
  const configuredOrigins = String(
    process.env.CORS_ORIGINS
    || process.env.CORS_ORIGIN
    || [
      'https://hml.admin.techtees.online',
      'https://admin.techtees.online',
      'https://hml.techtees.online',
      'https://techtees.online',
      'https://www.techtees.online',
      'http://localhost:4200',
      'http://localhost:5173',
    ].join(','),
  )
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const normalizedRequestOrigin = String(requestOrigin || '').trim().replace(/\/+$/, '');
  const allowAnyOrigin = configuredOrigins.includes('*');
  const allowOrigin = allowAnyOrigin
    ? '*'
    : configuredOrigins.includes(normalizedRequestOrigin)
      ? normalizedRequestOrigin
      : '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (allowOrigin) {
    headers['Access-Control-Allow-Origin'] = allowOrigin;
  }

  return headers;
}
