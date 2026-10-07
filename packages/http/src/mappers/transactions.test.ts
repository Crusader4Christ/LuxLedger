import { describe, expect, it } from 'bun:test';
import {
  AccountId,
  EntryEntity,
  LedgerId,
  Money,
  TransactionEntity,
  TransactionId,
} from '@luxledger/core';
import type { TransactionMetadata } from '@luxledger/core/transaction';
import { toTransactionResponse } from './transactions';

const createTransaction = (metadata?: TransactionMetadata): TransactionEntity =>
  new TransactionEntity({
    id: new TransactionId('00000000-0000-4000-8000-000000000201'),
    tenantId: '11111111-1111-4111-8111-111111111111',
    ledgerId: new LedgerId('00000000-0000-4000-8000-000000000001'),
    reference: 'tx-ref-1',
    currency: 'USD',
    description: 'Payment settlement',
    createdAt: new Date('2026-01-01T00:01:00.000Z'),
    metadata,
    entries: [
      new EntryEntity({
        accountId: new AccountId('00000000-0000-4000-8000-000000000101'),
        money: Money.of(100n, 'USD'),
      }),
      new EntryEntity({
        accountId: new AccountId('00000000-0000-4000-8000-000000000102'),
        money: Money.of(-100n, 'USD'),
      }),
    ],
  });

describe('transaction response mapper', () => {
  it('maps nested transaction metadata without changing it', () => {
    const metadata = {
      provider: { payment_id: 'pay_123' },
      attempts: [1, 2],
      settled: true,
      optional: null,
    };

    expect(toTransactionResponse(createTransaction(metadata)).metadata).toEqual(metadata);
  });

  it('maps omitted metadata to the required nullable response field', () => {
    expect(toTransactionResponse(createTransaction()).metadata).toBeNull();
  });

  it('preserves an empty metadata object', () => {
    expect(toTransactionResponse(createTransaction({})).metadata).toEqual({});
  });
});
