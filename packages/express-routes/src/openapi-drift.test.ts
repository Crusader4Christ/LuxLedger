import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ApplicationServices } from '@luxledger/core/application';
import { registerLedgerAdapter as registerFastifyLedgerAdapter } from '@luxledger/fastify-routes';
import type { Application } from 'express';
import Fastify from 'fastify';
import { registerLedgerAdapter as registerExpressLedgerAdapter } from './index';

type OpenApiParameter = { $ref?: string; name?: string; in?: string };
type OpenApiOperation = { parameters?: OpenApiParameter[] };
type OpenApiDocument = {
  paths: Record<string, Record<string, unknown>>;
  components?: { parameters?: Record<string, OpenApiParameter> };
};

const openapiPath = resolve(import.meta.dir, '../../http/openapi/openapi.yaml');
const services = {} as unknown as ApplicationServices;
const httpMethods = ['get', 'post', 'put', 'patch', 'delete'] as const;
const hostedByApplication = (operation: string): boolean => !operation.includes(' /v1/');
const authOperations = (operation: string): boolean => operation.includes(' /v1/auth/');

const toTemplate = (path: string): string => path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
const pathParams = (template: string): string[] =>
  [...template.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] as string);

const document = Bun.YAML.parse(readFileSync(openapiPath, 'utf8')) as OpenApiDocument;

const resolveParameter = (parameter: OpenApiParameter): OpenApiParameter => {
  if (!parameter.$ref) return parameter;
  const name = parameter.$ref.replace('#/components/parameters/', '');
  const resolved = document.components?.parameters?.[name];
  if (!resolved) throw new Error(`Unresolved OpenAPI parameter reference ${parameter.$ref}`);
  return resolved;
};

const documentedOperations = (): Map<string, OpenApiOperation> => {
  const operations = new Map<string, OpenApiOperation>();
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of httpMethods) {
      const operation = item[method];
      if (operation) operations.set(`${method.toUpperCase()} ${path}`, operation);
    }
  }
  return operations;
};

const fastifyOperations = (): string[] => {
  const operations: string[] = [];
  const server = Fastify();
  server.decorateRequest('tenantId');
  server.decorateRequest('apiKeyId');
  server.decorateRequest('apiKeyRole');
  server.addHook('onRoute', (route) => {
    for (const method of [route.method].flat()) {
      if (method !== 'HEAD' && method !== 'OPTIONS') {
        operations.push(`${method} ${toTemplate(route.url)}`);
      }
    }
  });
  registerFastifyLedgerAdapter(server, services);
  return operations.sort();
};

const expressOperations = (): string[] => {
  const operations: string[] = [];
  const recorder: Record<string, unknown> = { use: () => recorder };
  for (const method of httpMethods) {
    recorder[method] = (path: string) => {
      operations.push(`${method.toUpperCase()} ${toTemplate(path)}`);
      return recorder;
    };
  }
  registerExpressLedgerAdapter(recorder as unknown as Application, services);
  return operations.sort();
};

describe('openapi route drift governance', () => {
  it('registers the same operations and path parameter names in fastify and express', () => {
    expect(expressOperations()).toEqual(fastifyOperations());
  });

  it('documents every registered /v1 operation and registers every documented one', () => {
    const documented = [...documentedOperations().keys()].filter(
      (operation) => !hostedByApplication(operation) && !authOperations(operation),
    );
    const registered = fastifyOperations().filter((operation) => !authOperations(operation));
    expect(registered).toEqual([...documented].sort());
  });

  it('declares every path parameter of an operation in openapi', () => {
    for (const [operation, definition] of documentedOperations()) {
      const template = operation.slice(operation.indexOf(' ') + 1);
      const declared = (definition.parameters ?? [])
        .map(resolveParameter)
        .filter((parameter) => parameter.in === 'path')
        .map((parameter) => parameter.name)
        .sort();
      expect({ operation, declared }).toEqual({ operation, declared: pathParams(template).sort() });
    }
  });

  it('covers every credit lifecycle endpoint', () => {
    const documented = documentedOperations();
    for (const operation of [
      'POST /v1/credit-grants',
      'GET /v1/credit-grants',
      'GET /v1/credit-grants/{id}',
      'POST /v1/credit-grants/{id}/reversal',
      'POST /v1/credit-grants/{id}/refund',
      'GET /v1/credit-grants/{id}/allocations',
      'POST /v1/credit-grants/expiration/preview',
      'POST /v1/credit-grants/expiration/run',
      'GET /v1/transactions/{id}/credit-allocations',
      'GET /v1/accounts/{id}/credit-balance',
      'GET /v1/accounts/{id}/credit-lots',
      'GET /v1/accounts/{id}/statement',
      'GET /v1/accounts/{id}/credit-statement',
      'POST /v1/adjustments/credit',
      'POST /v1/adjustments/debit',
      'POST /v1/holds',
      'POST /v1/holds/{id}/commit',
      'POST /v1/holds/{id}/void',
    ]) {
      expect(documented.has(operation)).toBeTrue();
    }
  });
});
