import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError } from './product-contract.js';

export async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

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

export function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

export function sendEmpty(response: ServerResponse, statusCode: number): void {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  response.end();
}

export function sendError(response: ServerResponse, error: unknown): void {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = statusCode === 500
    ? 'Erro interno do servidor.'
    : error instanceof Error
      ? error.message
      : 'Erro inesperado.';

  sendJson(response, statusCode, { error: message });
}
