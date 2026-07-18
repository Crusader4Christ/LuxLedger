import type { LedgerId, TransactionId } from '../base/id';
import type { EntryEntity } from '../entry/entity';
import { InvalidTransactionRelationError } from './errors';
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
  public readonly relatedTransactionId: string | null;
  public readonly relationType: 'REVERSAL' | 'CORRECTION' | null;
  public readonly createdAt: Date | null;
  public readonly effectiveAt: Date | null;
  public readonly entries: EntryEntity[];

  public constructor(input: {
    id: TransactionId;
    tenantId?: string | null;
    ledgerId: LedgerId;
    reference: string;
    currency: string;
    description?: string | null;
    relatedTransactionId?: string | null;
    relationType?: 'REVERSAL' | 'CORRECTION' | null;
    createdAt?: Date | null;
    effectiveAt?: Date | null;
    entries: EntryEntity[];
  }) {
    this.id = input.id;
    this.tenantId = input.tenantId ?? null;
    this.ledgerId = input.ledgerId;
    this.reference = input.reference;
    this.currency = input.currency;
    this.description = input.description ?? null;
    this.relatedTransactionId = input.relatedTransactionId ?? null;
    this.relationType = input.relationType ?? null;
    this.createdAt = input.createdAt ?? null;
    this.effectiveAt = input.effectiveAt ?? null;
    this.entries = input.entries;

    this.assertInvariants();
  }

  private assertInvariants(): void {
    validateReference(this.reference);
    if (
      (this.relatedTransactionId === null && this.relationType !== null) ||
      (this.relatedTransactionId !== null && this.relationType === null)
    ) {
      throw new InvalidTransactionRelationError();
    }
    validateEntryCurrencies(this.entries, this.currency);
    validateEntryAmounts(this.entries);
    validateDoubleEntry(this.entries);
  }
}
