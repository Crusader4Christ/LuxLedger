import { AccountId, LedgerId, TransactionId } from '../../base/id';
import { Money } from '../../base/money';
import { EntryEntity } from '../../entry/entity';
import type { TransactionRepository } from '../';
import { TransactionEntity } from '../';
import { AccountNotFoundError, CrossLedgerAccountError, CurrencyMismatchError } from '../errors';
import type { CreateTransactionCommand } from './create-transaction.command';
import type { CreateTransactionResult } from './create-transaction.result';

export class CreateTransactionUseCase {
  private readonly repository: TransactionRepository;

  public constructor(repository: TransactionRepository) {
    this.repository = repository;
  }

  public async execute(command: CreateTransactionCommand): Promise<CreateTransactionResult> {
    const ledgerId = new LedgerId(command.ledgerId);
    const entries = command.entries.map(
      (entry) =>
        new EntryEntity({
          accountId: new AccountId(entry.accountId),
          direction: entry.direction,
          money: Money.of(entry.amountMinor, entry.currency),
        }),
    );

    const accountIds = entries.map((entry) => entry.accountId);
    const accounts = await this.repository.findAccounts(command.tenantId, accountIds);

    const accountById = new Map(accounts.map((account) => [account.id.value, account]));

    for (const entry of entries) {
      const account = accountById.get(entry.accountId.value);
      if (!account) {
        throw new AccountNotFoundError(entry.accountId.value);
      }

      if (account.ledgerId.value !== ledgerId.value) {
        throw new CrossLedgerAccountError();
      }

      if (account.currency !== command.currency) {
        throw new CurrencyMismatchError();
      }
    }

    const transaction = new TransactionEntity({
      id: new TransactionId(command.id),
      ledgerId,
      reference: command.reference,
      currency: command.currency,
      entries,
    });

    return {
      id: transaction.id.value,
      ledgerId: transaction.ledgerId.value,
      currency: transaction.currency,
      entryCount: transaction.entries.length,
    };
  }
}
