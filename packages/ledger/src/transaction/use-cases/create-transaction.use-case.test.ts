import { describe, expect, it } from 'bun:test';

import type { AccountId } from '../../base/id';
import { EntryDirection } from '../../entry/entity';
import { InvalidDirectionError } from '../errors';
import type { TransactionAccountSnapshot, TransactionRepository } from '../repository.interface';
import { CreateTransactionUseCase } from './create-transaction.use-case';

describe('CreateTransactionUseCase', () => {
  it('passes tenantId into repository account lookup', async () => {
    const calls: string[] = [];

    const repository: TransactionRepository = {
      findAccounts: async (
        tenantId: string,
        _accountIds: AccountId[],
      ): Promise<TransactionAccountSnapshot[]> => {
        calls.push(tenantId);
        return [];
      },
    };

    const useCase = new CreateTransactionUseCase(repository);

    await expect(
      useCase.execute({
        tenantId: 'tenant-1',
        id: 'tx-1',
        ledgerId: 'ledger-1',
        reference: 'ref-1',
        currency: 'USD',
        entries: [
          {
            accountId: 'account-1',
            direction: EntryDirection.DEBIT,
            amountMinor: 100n,
            currency: 'USD',
          },
          {
            accountId: 'account-2',
            direction: EntryDirection.CREDIT,
            amountMinor: 100n,
            currency: 'USD',
          },
        ],
      }),
    ).rejects.toThrow();

    expect(calls).toEqual(['tenant-1']);
  });

  it('fails fast for invalid direction instead of coercing to CREDIT', async () => {
    const repository: TransactionRepository = {
      findAccounts: async (): Promise<TransactionAccountSnapshot[]> => [],
    };

    const useCase = new CreateTransactionUseCase(repository);

    await expect(
      useCase.execute({
        tenantId: 'tenant-1',
        id: 'tx-1',
        ledgerId: 'ledger-1',
        reference: 'ref-1',
        currency: 'USD',
        entries: [
          {
            accountId: 'account-1',
            direction: 'INVALID' as unknown as EntryDirection,
            amountMinor: 100n,
            currency: 'USD',
          },
          {
            accountId: 'account-2',
            direction: EntryDirection.CREDIT,
            amountMinor: 100n,
            currency: 'USD',
          },
        ],
      }),
    ).rejects.toBeInstanceOf(InvalidDirectionError);
  });
});
