import {
  AccountId,
  CreateTransactionUseCase,
  DomainError,
  EntryDirection,
  LedgerId,
} from '@lux/ledger';
import { type CreateTransactionInput, InvariantViolationError } from '@lux/ledger/application';
import { and, eq, inArray } from 'drizzle-orm';
import type { DrizzleDatabase } from '../client';
import * as schema from '../schema';
import { generateUuidV7 } from '../uuid-v7';

export const validatePosting = async (
  tx: DrizzleDatabase,
  input: CreateTransactionInput,
): Promise<void> => {
  const useCase = new CreateTransactionUseCase({
    findAccounts: async (tenantId, accountIds) => {
      const uniqueIds = [...new Set(accountIds.map((accountId) => accountId.value))];
      if (uniqueIds.length === 0) {
        return [];
      }
      const rows = await tx
        .select({
          id: schema.accounts.id,
          ledgerId: schema.accounts.ledgerId,
          currency: schema.accounts.currency,
        })
        .from(schema.accounts)
        .where(and(eq(schema.accounts.tenantId, tenantId), inArray(schema.accounts.id, uniqueIds)));
      return rows.map((row) => ({
        id: new AccountId(row.id),
        ledgerId: new LedgerId(row.ledgerId),
        currency: row.currency,
      }));
    },
  });

  try {
    await useCase.execute({
      tenantId: input.tenantId,
      id: generateUuidV7(),
      ledgerId: input.ledgerId,
      reference: input.reference,
      currency: input.currency,
      description: input.description ?? null,
      entries: input.entries,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      throw new InvariantViolationError(error.message, { cause: error });
    }
    throw error;
  }
};

export const validatePostingEntries = (
  entries: Array<{
    direction: EntryDirection;
    amountMinor: bigint;
    currency: string;
  }>,
  currency: string,
): void => {
  if (entries.length < 2) {
    throw new InvariantViolationError('At least two entries are required');
  }
  const hasDebit = entries.some((entry) => entry.direction === EntryDirection.DEBIT);
  const hasCredit = entries.some((entry) => entry.direction === EntryDirection.CREDIT);
  if (!hasDebit || !hasCredit) {
    throw new InvariantViolationError('Entries must include at least one DEBIT and one CREDIT');
  }
  for (const entry of entries) {
    if (entry.currency !== currency) {
      throw new InvariantViolationError('Entry currency must match transaction currency');
    }
  }
};

export const totalDebit = (
  entries: Array<{ direction: EntryDirection; amountMinor: bigint }>,
): bigint =>
  entries.reduce(
    (sum, entry) => (entry.direction === EntryDirection.DEBIT ? sum + entry.amountMinor : sum),
    0n,
  );
