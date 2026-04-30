import type { LedgerId, TransactionId } from '../base/id';
import type { EntryEntity } from '../entry/entity';
import {
  validateDoubleEntry,
  validateEntryAmounts,
  validateEntryCurrencies,
  validateReference,
} from './validators';

export class TransactionEntity {
  public readonly id: TransactionId;
  public readonly tenantId: string | null;
  public readonly ledgerId: LedgerId;
  public readonly reference: string;
  public readonly currency: string;
  public readonly description: string | null;
  public readonly createdAt: Date | null;
  public readonly entries: EntryEntity[];

  public constructor(input: {
    id: TransactionId;
    tenantId?: string | null;
    ledgerId: LedgerId;
    reference: string;
    currency: string;
    description?: string | null;
    createdAt?: Date | null;
    entries: EntryEntity[];
  }) {
    this.id = input.id;
    this.tenantId = input.tenantId ?? null;
    this.ledgerId = input.ledgerId;
    this.reference = input.reference;
    this.currency = input.currency;
    this.description = input.description ?? null;
    this.createdAt = input.createdAt ?? null;
    this.entries = input.entries;

    this.assertInvariants();
  }

  private assertInvariants(): void {
    validateReference(this.reference);
    validateEntryCurrencies(this.entries, this.currency);
    validateEntryAmounts(this.entries);
    validateDoubleEntry(this.entries);
  }
}
