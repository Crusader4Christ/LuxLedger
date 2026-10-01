import type {
  CreditBalance,
  CreditGrant,
  CreditGrantExpirationResult,
  CreditGrantLineage,
} from '@luxledger/core/application';
import type {
  CreditBalanceResponse,
  CreditGrantExpirationResponse,
  CreditGrantLineageResponse,
  CreditGrantResponse,
} from '../contracts/credit-grants';

export const toCreditGrantResponse = (grant: CreditGrant): CreditGrantResponse => ({
  id: grant.id,
  tenant_id: grant.tenantId,
  ledger_id: grant.ledgerId,
  account_id: grant.accountId,
  funding_account_id: grant.fundingAccountId,
  asset_id: grant.assetId,
  reference: grant.reference,
  external_reference: grant.externalReference,
  amount_minor: grant.amountMinor.toString(),
  transaction_id: grant.transactionId,
  created_at: grant.createdAt.toISOString(),
  expires_at: grant.expiresAt?.toISOString() ?? null,
  reversed_by_transaction_id: grant.reversedByTransactionId,
});

export const toCreditBalanceResponse = (balance: CreditBalance): CreditBalanceResponse => ({
  account_id: balance.accountId,
  asset_id: balance.assetId,
  ledger_balance_minor: balance.ledgerBalanceMinor.toString(),
  remaining_minor: balance.remainingMinor.toString(),
  lots: balance.lots.map((lot) => ({
    grant_id: lot.grantId,
    reference: lot.reference,
    external_reference: lot.externalReference,
    created_at: lot.createdAt.toISOString(),
    expires_at: lot.expiresAt?.toISOString() ?? null,
    granted_minor: lot.grantedMinor.toString(),
    reversed_minor: lot.reversedMinor.toString(),
    consumed_minor: lot.consumedMinor.toString(),
    compensated_minor: lot.compensatedMinor.toString(),
    expired_minor: lot.expiredMinor.toString(),
    remaining_minor: lot.remainingMinor.toString(),
  })),
});

export const toCreditGrantExpirationResponse = (
  result: CreditGrantExpirationResult,
): CreditGrantExpirationResponse => ({
  as_of: result.asOf.toISOString(),
  items: result.items.map((item) => ({
    grant_id: item.grantId,
    account_id: item.accountId,
    funding_account_id: item.fundingAccountId,
    expires_at: item.expiresAt.toISOString(),
    amount_minor: item.amountMinor.toString(),
    cumulative_expired_minor: item.cumulativeExpiredMinor.toString(),
    transaction_id: item.transactionId,
  })),
});

export const toCreditGrantLineageResponse = (
  allocations: CreditGrantLineage[],
): CreditGrantLineageResponse => ({
  allocations: allocations.map((allocation) => ({
    grant_id: allocation.grantId,
    entry_id: allocation.entryId,
    transaction_id: allocation.transactionId,
    kind: allocation.kind,
    amount_minor: allocation.amountMinor.toString(),
    created_at: allocation.createdAt.toISOString(),
  })),
});
