import type { AccountId } from '../base/id';
import type { Money } from '../base/money';
import { validateSignedEntryAmount } from './validators';

export class EntryEntity {
  public readonly id: string | null;
  public readonly transactionId: string | null;
  public readonly accountId: AccountId;
  public readonly money: Money;
  public readonly assetId: string | null;
  public readonly createdAt: Date | null;

  public constructor(input: {
    id?: string | null;
    transactionId?: string | null;
    accountId: AccountId;
    money: Money;
    assetId?: string | null;
    createdAt?: Date | null;
  }) {
    validateSignedEntryAmount(input.money.amountMinor);

    this.id = input.id ?? null;
    this.transactionId = input.transactionId ?? null;
    this.accountId = input.accountId;
    this.money = input.money;
    this.assetId = input.assetId ?? null;
    this.createdAt = input.createdAt ?? null;
  }
}
