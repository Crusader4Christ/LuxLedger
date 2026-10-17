import { describe, expect, it } from 'bun:test';
import type { AdjustmentDirection, CreateAdjustmentInput } from '../types';
import { AdjustmentService } from './adjustment-service';

const input: CreateAdjustmentInput = {
  tenantId: 'tenant',
  ledgerId: 'ledger',
  accountId: 'account',
  offsetAccountId: 'offset',
  reference: 'adjustment-1',
  amountMinor: 100n,
  description: 'Support compensation',
  reasonCode: 'SUPPORT_COMPENSATION',
  actorId: 'operator-42',
  metadata: { ticket: 'SUP-42' },
};

describe('AdjustmentService', () => {
  it.each([
    ['credit', 'CREDIT'],
    ['debit', 'DEBIT'],
  ] as const)('validates and delegates a %s command', async (method, direction) => {
    let received: { direction: AdjustmentDirection; input: CreateAdjustmentInput } | undefined;
    const service = new AdjustmentService({
      create: async (actualDirection, actualInput) => {
        received = { direction: actualDirection, input: actualInput };
        return { transactionId: 'transaction', created: true };
      },
    });

    const result = await service[method](input);

    expect(received).toEqual({ direction, input });
    expect(result).toEqual({ transactionId: 'transaction', created: true });
  });

  it.each([
    ['tenantId', { tenantId: ' ' }],
    ['ledgerId', { ledgerId: '' }],
    ['accountId', { accountId: '' }],
    ['offsetAccountId', { offsetAccountId: '' }],
    ['reference', { reference: '' }],
    ['description', { description: '' }],
    ['reasonCode', { reasonCode: '' }],
    ['actorId', { actorId: '' }],
  ] as const)('rejects an empty %s', async (_name, change) => {
    const service = new AdjustmentService({
      create: async () => ({ transactionId: 'unused', created: true }),
    });

    expect(() => service.credit({ ...input, ...change })).toThrow();
  });

  it.each([
    0n,
    -1n,
    9_223_372_036_854_775_808n,
  ])('rejects invalid amount %s', async (amountMinor) => {
    const service = new AdjustmentService({
      create: async () => ({ transactionId: 'unused', created: true }),
    });

    expect(() => service.debit({ ...input, amountMinor })).toThrow(
      'positive int64 minor-unit value',
    );
  });

  it('rejects an adjustment whose account and offset are identical', async () => {
    const service = new AdjustmentService({
      create: async () => ({ transactionId: 'unused', created: true }),
    });

    expect(() => service.credit({ ...input, offsetAccountId: input.accountId })).toThrow(
      'must differ',
    );
  });
});
