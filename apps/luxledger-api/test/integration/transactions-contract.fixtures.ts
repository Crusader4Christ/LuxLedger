import { expect } from 'bun:test';
import {
  type CreateTransactionRequest,
  type CreateTransactionResponse,
  createTransactionRequestSchema,
  type TransactionResponse,
  transactionResponseSchema,
} from '@api/contracts/transactions';
import { EntryDirection } from '@lux/ledger/application';

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
  const normalizeList = (value: string) =>
    value
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .sort();

  const extractSection = (startMarker: string): string => {
    const start = openapiYaml.indexOf(startMarker);
    if (start === -1) {
      throw new Error(`OpenAPI marker not found: ${startMarker}`);
    }

    const tail = openapiYaml.slice(start + startMarker.length);
    const endMatch = tail.match(/\n {2}\/v1\/|\n {4}[A-Za-z0-9_]+:/);
    const end = endMatch?.index ?? tail.length;
    return tail.slice(0, end);
  };

  const extractRequiredList = (section: string): string[] => {
    const match = section.match(/required:\s*\[([^\]]+)\]/);
    if (!match) {
      throw new Error('required list not found in OpenAPI section');
    }
    return normalizeList(match[1]);
  };

  const extractPropertyNames = (section: string): string[] => {
    const propertiesIndex = section.indexOf('properties:');
    if (propertiesIndex === -1) {
      throw new Error('properties block not found in OpenAPI section');
    }

    const afterProperties = section.slice(propertiesIndex);
    const names = [...afterProperties.matchAll(/^\s{8}([a-z_]+):\s*$/gm)].map(
      (match) => match[1] ?? '',
    );

    return names.filter((name) => name.length > 0).sort();
  };

  const createTransactionSection = extractSection('\n  /v1/transactions:\n    post:');
  expect(extractRequiredList(createTransactionSection)).toEqual(
    [...createTransactionRequestSchema.required].sort(),
  );
  for (const field of Object.keys(createTransactionRequestSchema.properties)) {
    expect(createTransactionSection).toContain(`${field}:`);
  }

  const transactionSchemaSection = extractSection('\n    Transaction:');
  expect(extractRequiredList(transactionSchemaSection)).toEqual(
    [...transactionResponseSchema.required].sort(),
  );
  expect(extractPropertyNames(transactionSchemaSection)).toEqual(
    Object.keys(transactionResponseSchema.properties).sort(),
  );

  expect(transactionSchemaSection).toMatch(/description:\n(?:\s{10}.+\n)*\s{10}nullable:\s*true/);
};
