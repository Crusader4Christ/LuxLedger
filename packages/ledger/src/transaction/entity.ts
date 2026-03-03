import type { LedgerId, TransactionId } from '../base/id';
import type { EntryEntity } from '../entry/entity';
import {
  CurrencyMismatchError,
  MissingReferenceError,
  NotEnoughEntriesError,
  UnbalancedTransactionError,
} from './errors';

export class TransactionEntity {
  public readonly id: TransactionId;
  public readonly tenantId: string | null;
  public readonly ledgerId: LedgerId;
  public readonly reference: string;
  public readonly currency: string;
  public readonly createdAt: Date | null;
  public readonly entries: EntryEntity[];

  public constructor(input: {
    id: TransactionId;
    tenantId?: string | null;
    ledgerId: LedgerId;
    reference: string;
    currency: string;
    createdAt?: Date | null;
    entries: EntryEntity[];
  }) {
    this.id = input.id;
    this.tenantId = input.tenantId ?? null;
    this.ledgerId = input.ledgerId;
    this.reference = input.reference;
    this.currency = input.currency;
    this.createdAt = input.createdAt ?? null;
    this.entries = input.entries;

    this.assertInvariants();
  }

  private assertInvariants(): void {
    if (this.reference.trim().length === 0) {
      throw new MissingReferenceError();
    }

    if (this.entries.length < 2) {
      throw new NotEnoughEntriesError();
    }

    if (this.entries.some((entry) => entry.money.currency !== this.currency)) {
      throw new CurrencyMismatchError();
    }

    const total = this.entries.reduce((sum, entry) => sum + entry.signedAmountMinor(), 0n);

    if (total !== 0n) {
      throw new UnbalancedTransactionError();
    }
  }
}
