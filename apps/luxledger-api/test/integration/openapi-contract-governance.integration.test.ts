import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createTransactionRequestSchema,
  transactionResponseSchema,
} from '@lux/ledger-http/contracts';
import { assertOpenApiAccountsContractsSynced } from './accounts-contract.fixtures';
import { assertOpenApiAuthAdminContractsSynced } from './auth-admin-contract.fixtures';
import { assertOpenApiEntriesContractsSynced } from './entries-contract.fixtures';
import { assertOpenApiLedgersContractsSynced } from './ledgers-contract.fixtures';
import { assertOpenApiTransactionContractsSynced } from './transactions-contract.fixtures';

const OPENAPI_SPEC_PATH = resolve(import.meta.dir, '../../openapi/openapi.yaml');

const readOpenApiSpec = (): string => readFileSync(OPENAPI_SPEC_PATH, 'utf8');

const extractSection = (source: string, startPattern: RegExp, endPattern: RegExp): string => {
  const startMatch = source.match(startPattern);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(`Start pattern not found: ${startPattern}`);
  }

  const tail = source.slice(startMatch.index + startMatch[0].length);
  const endMatch = tail.match(endPattern);
  const end = endMatch?.index ?? tail.length;
  return tail.slice(0, end);
};

const extractPathMethodSection = (source: string, path: string, method: string): string => {
  const pathLinePattern = new RegExp(`^\\s*${path.replaceAll('/', '\\/')}:\\s*$`, 'm');
  const pathMatch = source.match(pathLinePattern);
  if (!pathMatch || pathMatch.index === undefined) {
    throw new Error(`OpenAPI path not found: ${path}`);
  }

  const fromPath = source.slice(pathMatch.index);
  const methodPattern = new RegExp(`^\\s*${method}:\\s*$`, 'm');
  const methodMatch = fromPath.match(methodPattern);
  if (!methodMatch || methodMatch.index === undefined) {
    throw new Error(`OpenAPI method not found: ${method} under ${path}`);
  }

  const methodStart = pathMatch.index + methodMatch.index;
  const tail = source.slice(methodStart);
  const nextPathMatch = tail.match(/\n\s*\/[A-Za-z0-9_/{-}]+:\s*$/m);
  const end = nextPathMatch?.index ?? tail.length;
  return tail.slice(0, end);
};

const extractSchemaSection = (source: string, schemaName: string): string =>
  extractSection(
    source,
    new RegExp(`^\\s{4}${schemaName}:\\s*$`, 'm'),
    /\n\s{4}[A-Za-z0-9_]+:\s*$/m,
  );

describe('openapi contract governance', () => {
  it('keeps transaction contract schemas synchronized with openapi.yaml', () => {
    const openapiYaml = readOpenApiSpec();

    assertOpenApiTransactionContractsSynced(openapiYaml);

    const createTransactionSection = extractPathMethodSection(
      openapiYaml,
      '/v1/transactions',
      'post',
    );
    expect(createTransactionSection).toContain("'201':");
    expect(createTransactionSection).toContain("'200':");
    expect(createTransactionSection).toContain(
      "$ref: '#/components/schemas/CreateTransactionResponse'",
    );

    for (const field of createTransactionRequestSchema.required) {
      expect(createTransactionSection).toContain(field);
    }
  });

  it('keeps transaction response components synchronized with runtime contracts', () => {
    const openapiYaml = readOpenApiSpec();

    const transactionSchemaSection = extractSchemaSection(openapiYaml, 'Transaction');
    for (const field of transactionResponseSchema.required) {
      expect(transactionSchemaSection).toContain(field);
    }

    const createTransactionResponseSection = extractSchemaSection(
      openapiYaml,
      'CreateTransactionResponse',
    );
    expect(createTransactionResponseSection).toContain('required: [transaction_id, created]');
    expect(createTransactionResponseSection).toContain('transaction_id:');
    expect(createTransactionResponseSection).toContain('created:');

    const listTransactionsSection = extractPathMethodSection(
      openapiYaml,
      '/v1/transactions',
      'get',
    );
    expect(listTransactionsSection).toContain("$ref: '#/components/schemas/TransactionsPage'");
  });

  it('keeps auth/admin contract schemas synchronized with openapi.yaml', () => {
    const openapiYaml = readOpenApiSpec();

    assertOpenApiAuthAdminContractsSynced(openapiYaml);
  });

  it('keeps account contract schemas synchronized with openapi.yaml', () => {
    const openapiYaml = readOpenApiSpec();

    assertOpenApiAccountsContractsSynced(openapiYaml);
  });

  it('keeps ledger contract schemas synchronized with openapi.yaml', () => {
    const openapiYaml = readOpenApiSpec();

    assertOpenApiLedgersContractsSynced(openapiYaml);
  });

  it('keeps entries contract schemas synchronized with openapi.yaml', () => {
    const openapiYaml = readOpenApiSpec();

    assertOpenApiEntriesContractsSynced(openapiYaml);
  });
});
