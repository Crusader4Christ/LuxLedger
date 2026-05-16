import { describe, expect, test } from 'bun:test';
import {
  createTransactionRequestSchema,
  listTransactionsQuerySchemaExtra,
  transactionByIdParamsSchema,
  transactionEntryRequestSchema,
  transactionResponseSchema,
} from './transactions';

describe('transaction contract migration parity', () => {
  test('keeps create transaction required and optional semantics', () => {
    expect([...createTransactionRequestSchema.required].sort()).toEqual([
      'currency',
      'entries',
      'ledger_id',
      'reference',
    ]);
    expect(Object.keys(createTransactionRequestSchema.properties).sort()).toEqual([
      'currency',
      'description',
      'entries',
      'ledger_id',
      'reference',
    ]);
    expect('description' in createTransactionRequestSchema.properties).toBeTrue();
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
      'id',
      'ledger_id',
      'reference',
      'tenant_id',
    ]);
  });

  test('keeps validation details for entry/request/query/params schemas', () => {
    expect(transactionEntryRequestSchema.required).toEqual([
      'account_id',
      'direction',
      'amount_minor',
      'currency',
    ]);
    expect(transactionEntryRequestSchema.properties.amount_minor).toEqual({
      type: 'string',
      pattern: '^[1-9][0-9]*$',
    });
    expect(transactionByIdParamsSchema.required).toEqual(['id']);
    expect(listTransactionsQuerySchemaExtra.properties.ledger_id).toEqual({
      type: 'string',
      format: 'uuid',
    });
  });

});
