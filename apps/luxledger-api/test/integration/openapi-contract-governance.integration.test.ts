import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  accountByIdParamsSchema,
  balanceAsOfQuerySchema,
  balanceAsOfResponseSchema,
  balanceHistoryQuerySchema,
  balanceHistoryResponseSchema,
  bulkCreateTransactionRequestSchema,
  bulkCreateTransactionResponseSchema,
  commitHoldRequestSchema,
  commitHoldResponseSchema,
  correctTransactionRequestSchema,
  correctTransactionResponseSchema,
  createHoldRequestSchema,
  createHoldResponseSchema,
  createReconRuleRequestSchema,
  createTransactionRequestSchema,
  createTransactionResponseSchema,
  ingestReconRecordsRequestSchema,
  listTransactionsQuerySchema,
  reconciliationRunByIdParamsSchema,
  reconRuleResponseSchema,
  reconRulesListResponseSchema,
  reconRunResponseSchema,
  reconUploadResponseSchema,
  reverseTransactionRequestSchema,
  reverseTransactionResponseSchema,
  runReconRequestSchema,
  transactionByIdParamsSchema,
  transactionResponseSchema,
  transactionsPageResponseSchema,
  voidHoldResponseSchema,
} from '@lux/ledger-http/contracts';
import { assertOpenApiAccountsContractsSynced } from './accounts-contract.fixtures';
import { assertOpenApiAuthAdminContractsSynced } from './auth-admin-contract.fixtures';
import { assertOpenApiEntriesContractsSynced } from './entries-contract.fixtures';
import { assertOpenApiLedgersContractsSynced } from './ledgers-contract.fixtures';
import {
  componentSchema,
  normalizeSchema,
  type OpenApiDocument,
  parametersSchema,
  parseOpenApiDocument,
  requestBodySchema,
  responseSchema,
  successStatuses,
} from './openapi-contract-helpers';

const OPENAPI_SPEC_PATH = resolve(import.meta.dir, '../../openapi/openapi.yaml');

const readOpenApiSpec = (): string => readFileSync(OPENAPI_SPEC_PATH, 'utf8');

const expectSchema = (
  document: OpenApiDocument,
  openApiSchema: unknown,
  runtimeSchema: unknown,
): void => {
  expect(normalizeSchema(document, openApiSchema)).toEqual(
    normalizeSchema(document, runtimeSchema),
  );
};

describe('openapi contract governance', () => {
  it('keeps all transaction request, response, pagination, and status contracts synchronized', () => {
    const document = parseOpenApiDocument(readOpenApiSpec());

    expectSchema(
      document,
      requestBodySchema(document, '/v1/transactions', 'post'),
      createTransactionRequestSchema,
    );
    expectSchema(
      document,
      requestBodySchema(document, '/v1/transactions/bulk', 'post'),
      bulkCreateTransactionRequestSchema,
    );
    expectSchema(
      document,
      requestBodySchema(document, '/v1/transactions/{id}/reverse', 'post'),
      reverseTransactionRequestSchema,
    );
    expectSchema(
      document,
      requestBodySchema(document, '/v1/transactions/{id}/correct', 'post'),
      correctTransactionRequestSchema,
    );
    expectSchema(
      document,
      parametersSchema(document, '/v1/transactions', 'get', 'query'),
      listTransactionsQuerySchema,
    );
    expectSchema(
      document,
      parametersSchema(document, '/v1/transactions/{id}', 'get', 'path'),
      transactionByIdParamsSchema,
    );

    expectSchema(document, componentSchema(document, 'Transaction'), transactionResponseSchema);
    expectSchema(
      document,
      responseSchema(document, '/v1/transactions', 'post', 200),
      createTransactionResponseSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/transactions', 'get', 200),
      transactionsPageResponseSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/transactions/bulk', 'post', 201),
      bulkCreateTransactionResponseSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/transactions/{id}/reverse', 'post', 200),
      reverseTransactionResponseSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/transactions/{id}/correct', 'post', 201),
      correctTransactionResponseSchema,
    );

    expect(successStatuses(document, '/v1/transactions', 'post')).toEqual([200, 201]);
    expect(successStatuses(document, '/v1/transactions', 'get')).toEqual([200]);
    expect(successStatuses(document, '/v1/transactions/bulk', 'post')).toEqual([200, 201]);
    expect(successStatuses(document, '/v1/transactions/{id}', 'get')).toEqual([200]);
    expect(successStatuses(document, '/v1/transactions/{id}/reverse', 'post')).toEqual([200, 201]);
    expect(successStatuses(document, '/v1/transactions/{id}/correct', 'post')).toEqual([200, 201]);
  });

  it('governs account balance-as-of and balance-history contracts', () => {
    const document = parseOpenApiDocument(readOpenApiSpec());

    expectSchema(
      document,
      parametersSchema(document, '/v1/accounts/{id}/balance-as-of', 'get', 'path'),
      accountByIdParamsSchema,
    );
    expectSchema(
      document,
      parametersSchema(document, '/v1/accounts/{id}/balance-as-of', 'get', 'query'),
      balanceAsOfQuerySchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/accounts/{id}/balance-as-of', 'get', 200),
      balanceAsOfResponseSchema,
    );
    expectSchema(
      document,
      parametersSchema(document, '/v1/accounts/{id}/balance-history', 'get', 'query'),
      balanceHistoryQuerySchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/accounts/{id}/balance-history', 'get', 200),
      balanceHistoryResponseSchema,
    );
    expect(successStatuses(document, '/v1/accounts/{id}/balance-as-of', 'get')).toEqual([200]);
    expect(successStatuses(document, '/v1/accounts/{id}/balance-history', 'get')).toEqual([200]);
  });

  it('governs hold contracts and success status mappings', () => {
    const document = parseOpenApiDocument(readOpenApiSpec());

    expectSchema(
      document,
      requestBodySchema(document, '/v1/holds', 'post'),
      createHoldRequestSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/holds', 'post', 201),
      createHoldResponseSchema,
    );
    expectSchema(
      document,
      requestBodySchema(document, '/v1/holds/{id}/commit', 'post'),
      commitHoldRequestSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/holds/{id}/commit', 'post', 200),
      commitHoldResponseSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/holds/{id}/void', 'post', 200),
      voidHoldResponseSchema,
    );
    expect(successStatuses(document, '/v1/holds', 'post')).toEqual([200, 201]);
    expect(successStatuses(document, '/v1/holds/{id}/commit', 'post')).toEqual([200, 201]);
    expect(successStatuses(document, '/v1/holds/{id}/void', 'post')).toEqual([200]);
  });

  it('governs reconciliation requests, responses, params, and status mappings', () => {
    const document = parseOpenApiDocument(readOpenApiSpec());

    expectSchema(
      document,
      requestBodySchema(document, '/v1/reconciliation/matching-rules', 'post'),
      createReconRuleRequestSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/reconciliation/matching-rules', 'post', 201),
      reconRuleResponseSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/reconciliation/matching-rules', 'get', 200),
      reconRulesListResponseSchema,
    );
    expectSchema(
      document,
      requestBodySchema(document, '/v1/reconciliation/external-records', 'post'),
      ingestReconRecordsRequestSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/reconciliation/external-records', 'post', 201),
      reconUploadResponseSchema,
    );
    expectSchema(
      document,
      requestBodySchema(document, '/v1/reconciliation/runs', 'post'),
      runReconRequestSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/reconciliation/runs', 'post', 200),
      reconRunResponseSchema,
    );
    expectSchema(
      document,
      parametersSchema(document, '/v1/reconciliation/runs/{id}', 'get', 'path'),
      reconciliationRunByIdParamsSchema,
    );
    expectSchema(
      document,
      responseSchema(document, '/v1/reconciliation/runs/{id}', 'get', 200),
      reconRunResponseSchema,
    );
    expect(successStatuses(document, '/v1/reconciliation/matching-rules', 'post')).toEqual([201]);
    expect(successStatuses(document, '/v1/reconciliation/matching-rules', 'get')).toEqual([200]);
    expect(successStatuses(document, '/v1/reconciliation/external-records', 'post')).toEqual([201]);
    expect(successStatuses(document, '/v1/reconciliation/runs', 'post')).toEqual([200, 201]);
    expect(successStatuses(document, '/v1/reconciliation/runs/{id}', 'get')).toEqual([200]);
  });

  it('keeps previously migrated auth, account, ledger, and entry contracts synchronized', () => {
    const openapiYaml = readOpenApiSpec();
    assertOpenApiAuthAdminContractsSynced(openapiYaml);
    assertOpenApiAccountsContractsSynced(openapiYaml);
    assertOpenApiLedgersContractsSynced(openapiYaml);
    assertOpenApiEntriesContractsSynced(openapiYaml);
  });
});
