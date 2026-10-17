import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApplicationServices } from '@luxledger/core/application';
import { registerLedgerAdapter as registerFastifyLedgerAdapter } from '@luxledger/fastify-routes';
import express from 'express';
import Fastify from 'fastify';
import { registerLedgerAdapter as registerExpressLedgerAdapter } from './index';

const openapiPath = resolve(import.meta.dir, '../../http/openapi/openapi.yaml');
const services = {} as unknown as ApplicationServices;
const httpMethods = ['get', 'post', 'put', 'patch', 'delete'];

const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z_]+)/g, '{$1}');

const readOpenApiOperations = (): string[] => {
  const operations: string[] = [];
  let currentPath: string | null = null;
  for (const line of readFileSync(openapiPath, 'utf8').split('\n')) {
    const pathMatch = /^ {2}(\/\S+):\s*$/.exec(line);
    if (pathMatch) {
      currentPath = pathMatch[1] ?? null;
      continue;
    }
    if (/^\S/.test(line)) currentPath = null;
    const methodMatch = /^ {4}([a-z]+):\s*$/.exec(line);
    if (currentPath && methodMatch && httpMethods.includes(methodMatch[1] as string)) {
      operations.push(`${(methodMatch[1] as string).toUpperCase()} ${currentPath}`);
    }
  }
  return operations.sort();
};

const readFastifyOperations = (): string[] => {
  const operations: string[] = [];
  const server = Fastify();
  server.decorateRequest('tenantId');
  server.decorateRequest('apiKeyId');
  server.decorateRequest('apiKeyRole');
  server.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD' || method === 'OPTIONS') continue;
      operations.push(`${method} ${toOpenApiPath(route.url)}`);
    }
  });
  registerFastifyLedgerAdapter(server, services);
  return operations.sort();
};

const readExpressOperations = (): string[] => {
  const app = express();
  registerExpressLedgerAdapter(app, services);
  const stack = (
    app as unknown as {
      router: {
        stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>;
      };
    }
  ).router.stack;
  const operations: string[] = [];
  for (const layer of stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      operations.push(`${method.toUpperCase()} ${toOpenApiPath(layer.route.path)}`);
    }
  }
  return operations.sort();
};

const hostPathParam = (operation: string): string => operation.replace(/\{[^}]+\}/g, '{param}');

describe('openapi route drift governance', () => {
  const documented = readOpenApiOperations();
  const normalize = (operations: string[]) => operations.map(hostPathParam).sort();

  it('registers the same operations in the fastify and express adapters', () => {
    expect(normalize(readExpressOperations())).toEqual(normalize(readFastifyOperations()));
  });

  it('documents every registered operation in openapi', () => {
    const registered = normalize(readFastifyOperations());
    const documentedOperations = normalize(documented);
    expect(registered.filter((operation) => !documentedOperations.includes(operation))).toEqual([]);
    expect(
      documentedOperations.filter(
        (operation) =>
          operation.includes(' /v1/') &&
          !registered.includes(operation) &&
          !operation.includes('/v1/auth/'),
      ),
    ).toEqual([]);
  });

  it('covers every credit lifecycle endpoint in openapi', () => {
    for (const operation of [
      'POST /v1/credit-grants',
      'GET /v1/credit-grants/{id}',
      'POST /v1/credit-grants/{id}/reversal',
      'GET /v1/credit-grants/{id}/allocations',
      'POST /v1/credit-grants/expiration/preview',
      'POST /v1/credit-grants/expiration/run',
      'GET /v1/transactions/{id}/credit-allocations',
      'GET /v1/accounts/{id}/credit-balance',
      'POST /v1/holds',
      'POST /v1/holds/{id}/commit',
      'POST /v1/holds/{id}/void',
    ]) {
      expect(documented).toContain(operation);
    }
  });
});
