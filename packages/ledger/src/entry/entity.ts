import type { AccountId } from '../base/id';
import type { Money } from '../base/money';
import { InvalidAmountError, InvalidDirectionError } from '../transaction/errors';

export const EntryDirection = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
} as const;

export type EntryDirection = (typeof EntryDirection)[keyof typeof EntryDirection];

export class EntryEntity {
  public readonly id: string | null;
  public readonly transactionId: string | null;
  public readonly accountId: AccountId;
  public readonly direction: EntryDirection;
  public readonly money: Money;
  public readonly createdAt: Date | null;

  public constructor(input: {
    id?: string | null;
    transactionId?: string | null;
    accountId: AccountId;
    direction: EntryDirection;
    money: Money;
    createdAt?: Date | null;
  }) {
    if (input.direction !== EntryDirection.DEBIT && input.direction !== EntryDirection.CREDIT) {
      throw new InvalidDirectionError();
    }

    if (input.money.amountMinor <= 0n) {
      throw new InvalidAmountError('amount must be positive');
    }

    this.id = input.id ?? null;
    this.transactionId = input.transactionId ?? null;
    this.accountId = input.accountId;
    this.direction = input.direction;
    this.money = input.money;
    this.createdAt = input.createdAt ?? null;
  }

  public signedAmountMinor(): bigint {
    return this.direction === EntryDirection.DEBIT
      ? -this.money.amountMinor
      : this.money.amountMinor;
  }
}
