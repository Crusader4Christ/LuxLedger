import { expect } from 'bun:test';
import {
  type CreateTransactionRequest,
  type CreateTransactionResponse,
  createTransactionRequestSchema,
  type TransactionResponse,
  transactionResponseSchema,
} from '@lux/ledger-http/contracts/transactions';
import { EntryDirection } from '@lux/ledger/application';
import {
  extractPathMethodSection,
  extractPropertyNames,
  extractRequiredList,
  extractSchemaSection,
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
  const createTransactionSection = extractPathMethodSection(
    openapiYaml,
    '/v1/transactions',
    'post',
  );
  expect(extractRequiredList(createTransactionSection)).toEqual(
    [...createTransactionRequestSchema.required].sort(),
  );
  for (const field of Object.keys(createTransactionRequestSchema.properties)) {
    expect(createTransactionSection).toContain(`${field}:`);
  }

  const transactionSchemaSection = extractSchemaSection(openapiYaml, 'Transaction');
  expect(extractRequiredList(transactionSchemaSection)).toEqual(
    [...transactionResponseSchema.required].sort(),
  );
  expect(extractPropertyNames(transactionSchemaSection)).toEqual(
    Object.keys(transactionResponseSchema.properties).sort(),
  );

  expect(transactionSchemaSection).toMatch(/description:\n(?:\s{10}.+\n)*\s{10}nullable:\s*true/);
};
