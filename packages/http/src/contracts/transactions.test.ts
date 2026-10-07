import { describe, expect, test } from 'bun:test';
import type { JsonObject } from '@luxledger/core/base';
import Ajv from 'ajv';
import {
  bulkCreateTransactionRequestSchema,
  bulkCreateTransactionResponseSchema,
  type CreateTransactionRequest,
  correctTransactionResponseSchema,
  createTransactionRequestSchema,
  createTransactionResponseSchema,
  listTransactionsQuerySchemaExtra,
  type TransactionResponse,
  transactionByIdParamsSchema,
  transactionEntryRequestSchema,
  transactionMetadataSchema,
  transactionResponseSchema,
  transactionsPageResponseSchema,
} from './transactions';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const inferredMetadataTypes: [
  Assert<Equal<CreateTransactionRequest['metadata'], JsonObject | undefined>>,
  Assert<Equal<TransactionResponse['metadata'], JsonObject | null>>,
] = [true, true];

describe('transaction contract migration parity', () => {
  const transaction = {
    ledger_id: '00000000-0000-4000-8000-000000000001',
    reference: 'tx-ref-1',
    currency: 'USD',
    entries: [
      {
        account_id: '00000000-0000-4000-8000-000000000101',
        signed_amount_minor: '100',
        currency: 'USD',
      },
      {
        account_id: '00000000-0000-4000-8000-000000000102',
        signed_amount_minor: '-100',
        currency: 'USD',
      },
    ],
  } as const;

  test('keeps create transaction required and optional semantics', () => {
    expect(inferredMetadataTypes).toEqual([true, true]);
    expect([...createTransactionRequestSchema.required].sort()).toEqual([
      'currency',
      'entries',
      'ledger_id',
      'reference',
    ]);
    expect(Object.keys(createTransactionRequestSchema.properties).sort()).toEqual([
      'currency',
      'description',
      'effective_at',
      'entries',
      'ledger_id',
      'metadata',
      'reference',
    ]);
    expect('description' in createTransactionRequestSchema.properties).toBeTrue();
    expect(createTransactionRequestSchema.required).not.toContain('metadata');
    expect(createTransactionRequestSchema.properties.metadata).toBe(transactionMetadataSchema);
    expect(transactionMetadataSchema).toEqual({
      type: 'object',
      additionalProperties: true,
    });
  });

  test('keeps transaction response nullability semantics', () => {
    expect(transactionResponseSchema.properties.description).toEqual({
      type: 'string',
      nullable: true,
    });
    expect([...transactionResponseSchema.required].sort()).toEqual([
      'created_at',
      'currency',
      'description',
      'effective_at',
      'id',
      'ledger_id',
      'metadata',
      'reference',
      'related_transaction_id',
      'relation_type',
      'tenant_id',
    ]);
    expect(transactionResponseSchema.properties.metadata).toEqual({
      type: 'object',
      additionalProperties: true,
      nullable: true,
    });
  });

  test('keeps validation details for entry/request/query/params schemas', () => {
    expect(transactionEntryRequestSchema.required).toEqual([
      'account_id',
      'signed_amount_minor',
      'currency',
    ]);
    expect(transactionEntryRequestSchema.properties.signed_amount_minor).toEqual({
      type: 'string',
      pattern: '^-?[1-9][0-9]*$',
    });
    expect(transactionByIdParamsSchema.required).toEqual(['id']);
    expect(listTransactionsQuerySchemaExtra.properties.ledger_id).toEqual({
      type: 'string',
      format: 'uuid',
    });
  });

  test('defines bulk transaction all-or-nothing request and response schemas', () => {
    expect(bulkCreateTransactionRequestSchema.required).toEqual(['transactions']);
    expect(bulkCreateTransactionRequestSchema.properties.transactions.minItems).toBe(1);
    expect(bulkCreateTransactionRequestSchema.properties.transactions.maxItems).toBe(100);
    expect(bulkCreateTransactionRequestSchema.properties.transactions.items).toBe(
      createTransactionRequestSchema,
    );
    expect(bulkCreateTransactionResponseSchema.required).toEqual([
      'created_count',
      'idempotent_count',
      'transactions',
    ]);
  });

  test('defines concrete response schemas for every transaction operation', () => {
    expect(createTransactionResponseSchema.required).toEqual(['transaction_id', 'created']);
    expect(correctTransactionResponseSchema.required).toEqual([
      'reversal_transaction_id',
      'corrected_transaction_id',
      'created',
    ]);
    expect(transactionsPageResponseSchema.properties.data.items).toBe(transactionResponseSchema);
  });

  test('accepts omitted, empty, and nested request metadata', () => {
    const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
      createTransactionRequestSchema,
    );

    expect(validate(transaction)).toBeTrue();
    expect(validate({ ...transaction, metadata: {} })).toBeTrue();
    expect(
      validate({
        ...transaction,
        metadata: {
          provider: { payment_id: 'pay_123' },
          attempts: [1, 2],
          settled: true,
          optional: null,
        },
      }),
    ).toBeTrue();
  });

  test('rejects null, arrays, and primitive metadata', () => {
    const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
      createTransactionRequestSchema,
    );

    for (const metadata of [null, [], 'metadata', 42, true]) {
      expect(validate({ ...transaction, metadata })).toBeFalse();
    }
  });

  test('validates metadata for every bulk item', () => {
    const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
      bulkCreateTransactionRequestSchema,
    );

    expect(
      validate({
        transactions: [transaction, { ...transaction, reference: 'tx-ref-2', metadata: {} }],
      }),
    ).toBeTrue();
    expect(validate({ transactions: [{ ...transaction, metadata: null }] })).toBeFalse();
  });

  test('requires nullable object metadata in transaction responses', () => {
    const validate = new Ajv({ allErrors: true, strict: false, validateFormats: false }).compile(
      transactionResponseSchema,
    );
    const response = {
      id: '00000000-0000-4000-8000-000000000201',
      tenant_id: '11111111-1111-4111-8111-111111111111',
      ledger_id: '00000000-0000-4000-8000-000000000001',
      reference: 'tx-ref-1',
      currency: 'USD',
      description: null,
      metadata: null,
      related_transaction_id: '00000000-0000-4000-8000-000000000200',
      relation_type: 'REVERSAL',
      effective_at: '2026-01-01T00:01:00.000Z',
      created_at: '2026-01-01T00:01:00.000Z',
    };

    expect(validate(response)).toBeTrue();
    expect(validate({ ...response, metadata: { provider: { payment_id: 'pay_123' } } })).toBeTrue();
    const { metadata: _, ...withoutMetadata } = response;
    expect(validate(withoutMetadata)).toBeFalse();
    expect(validate({ ...response, metadata: [] })).toBeFalse();
  });
});
