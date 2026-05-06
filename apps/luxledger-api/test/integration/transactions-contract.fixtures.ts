import { expect } from 'bun:test';
import {
  type CreateTransactionRequestContract,
  type CreateTransactionResponseContract,
  createTransactionRequestSchema,
  type TransactionResponseContract,
  transactionResponseSchema,
} from '@api/contracts/transactions';
import { EntryDirection } from '@lux/ledger/application';

export const createTransactionRequestFactory = (
  ledgerId: string,
  reference = 'txn-ref-1',
): CreateTransactionRequestContract => ({
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

export const assertCreateTransactionResponseShape = (
  payload: CreateTransactionResponseContract,
): void => {
  expect(typeof payload.transaction_id).toBe('string');
  expect(typeof payload.created).toBe('boolean');
};

export const assertTransactionResponseShape = (payload: TransactionResponseContract): void => {
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
  expect(openapiYaml).toContain('required: [ledger_id, reference, currency, entries]');
  for (const field of createTransactionRequestSchema.required) {
    expect(openapiYaml).toContain(`${field}`);
  }

  expect(openapiYaml).toContain(
    'required: [id, tenant_id, ledger_id, reference, currency, description, created_at]',
  );
  for (const field of Object.keys(transactionResponseSchema.properties)) {
    expect(openapiYaml).toContain(`${field}:`);
  }

  expect(openapiYaml).toContain('description:\n          type: string\n          nullable: true');
};
