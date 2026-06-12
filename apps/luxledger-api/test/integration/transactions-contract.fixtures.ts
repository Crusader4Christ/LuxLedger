import { expect } from 'bun:test';
import { EntryDirection } from '@lux/ledger/application';
import {
  type CreateTransactionRequest,
  type CreateTransactionResponse,
  createTransactionRequestSchema,
  createTransactionResponseSchema,
  type TransactionResponse,
  transactionResponseSchema,
  transactionsPageResponseSchema,
} from '@lux/ledger-http/contracts';
import {
  componentSchema,
  normalizeSchema,
  parseOpenApiDocument,
  requestBodySchema,
  responseSchema,
} from './openapi-contract-helpers';

export const createTransactionRequestFactory = (
  ledgerId: string,
  reference = 'txn-ref-1',
): CreateTransactionRequest => ({
  ledger_id: ledgerId,
  reference,
  currency: 'USD',
  entries: [
    {
      account_id: '00000000-0000-4000-8000-000000000101',
      direction: EntryDirection.DEBIT,
      amount_minor: '100',
      currency: 'USD',
    },
    {
      account_id: '00000000-0000-4000-8000-000000000102',
      direction: EntryDirection.CREDIT,
      amount_minor: '100',
      currency: 'USD',
    },
  ],
});

export const assertCreateTransactionResponseShape = (payload: CreateTransactionResponse): void => {
  expect(typeof payload.transaction_id).toBe('string');
  expect(typeof payload.created).toBe('boolean');
};

export const assertTransactionResponseShape = (payload: TransactionResponse): void => {
  const keys = Object.keys(payload).sort();
  expect(keys).toEqual(Object.keys(transactionResponseSchema.properties).sort());
};

export const assertTransactionsPageShape = (payload: {
  data: unknown[];
  next_cursor: string | null;
}): void => {
  expect(Array.isArray(payload.data)).toBeTrue();
  expect(payload.next_cursor === null || typeof payload.next_cursor === 'string').toBeTrue();
};

export const assertOpenApiTransactionContractsSynced = (openapiYaml: string): void => {
  const document = parseOpenApiDocument(openapiYaml);
  expect(
    normalizeSchema(document, requestBodySchema(document, '/v1/transactions', 'post')),
  ).toEqual(normalizeSchema(document, createTransactionRequestSchema));
  expect(normalizeSchema(document, componentSchema(document, 'Transaction'))).toEqual(
    normalizeSchema(document, transactionResponseSchema),
  );
  expect(
    normalizeSchema(document, responseSchema(document, '/v1/transactions', 'post', 201)),
  ).toEqual(normalizeSchema(document, createTransactionResponseSchema));
  expect(
    normalizeSchema(document, responseSchema(document, '/v1/transactions', 'get', 200)),
  ).toEqual(normalizeSchema(document, transactionsPageResponseSchema));
};
