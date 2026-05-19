import type { AccountResponse } from './accounts';
import type { ApiKeyContract } from './auth-admin';
import type { EntryResponse } from './entries';
import type { TransactionResponse } from './transactions';
import {
  InvariantViolationError,
  type AccountEntity,
  type ApiKeyEntity,
  type EntryEntity,
  type TransactionEntity,
} from '@lux/ledger';

export const resolveLimit = (value: number | undefined): number => value ?? 50;

export const parseLimitQuery = (value: unknown): number | null => {
  if (value === undefined) {
    return 50;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 200) {
    return null;
  }
  return numeric;
};

export const parseCursorQuery = (value: unknown): string | null => {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value;
};

export const parseUuidQuery = (value: unknown): string | null => {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(value) ? value : null;
};

export const toAccountResponse = (account: AccountEntity): AccountResponse => ({
  id: account.id,
  tenant_id: account.tenantId,
  ledger_id: account.ledgerId,
  name: account.name,
  side: account.side,
  currency: account.currency,
  balance_minor: account.balanceMinor.toString(),
  created_at: account.createdAt.toISOString(),
});

export const toTransactionResponse = (transaction: TransactionEntity): TransactionResponse => {
  if (!transaction.tenantId || !transaction.reference || !transaction.createdAt) {
    throw new InvariantViolationError('transaction must be persisted before listing');
  }
  return {
    id: transaction.id.value,
    tenant_id: transaction.tenantId,
    ledger_id: transaction.ledgerId.value,
    reference: transaction.reference,
    currency: transaction.currency,
    description: transaction.description,
    created_at: transaction.createdAt.toISOString(),
  };
};

export const toEntryResponse = (entry: EntryEntity): EntryResponse => {
  if (!entry.id || !entry.transactionId || !entry.createdAt) {
    throw new InvariantViolationError('entry must be persisted before listing');
  }
  return {
    id: entry.id,
    transaction_id: entry.transactionId,
    account_id: entry.accountId.value,
    direction: entry.direction,
    amount_minor: entry.money.amountMinor.toString(),
    currency: entry.money.currency,
    created_at: entry.createdAt.toISOString(),
  };
};

export const toApiKeyContract = (key: ApiKeyEntity): ApiKeyContract => ({
  id: key.id,
  tenant_id: key.tenantId,
  name: key.name,
  role: key.role,
  created_at: key.createdAt.toISOString(),
  revoked_at: key.revokedAt ? key.revokedAt.toISOString() : null,
});
