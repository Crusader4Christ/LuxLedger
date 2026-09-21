import type { CreditBalance, CreditGrant } from '@luxledger/core/application';
import type { CreditBalanceResponse, CreditGrantResponse } from '../contracts/credit-grants';

export const toCreditGrantResponse = (grant: CreditGrant): CreditGrantResponse => ({
  id: grant.id,
  tenant_id: grant.tenantId,
  ledger_id: grant.ledgerId,
  account_id: grant.accountId,
  funding_account_id: grant.fundingAccountId,
  asset_id: grant.assetId,
  reference: grant.reference,
  external_reference: grant.externalReference,
  origin: grant.origin,
  amount_minor: grant.amountMinor.toString(),
  policy: {
    refundable: grant.policy.refundable,
    transferable: grant.policy.transferable,
    consumption_priority: grant.policy.consumptionPriority,
    eligibility: grant.policy.eligibility,
  },
  transaction_id: grant.transactionId,
  created_at: grant.createdAt.toISOString(),
  reversed_by_transaction_id: grant.reversedByTransactionId,
});

export const toCreditBalanceResponse = (balance: CreditBalance): CreditBalanceResponse => ({
  account_id: balance.accountId,
  asset_id: balance.assetId,
  ledger_balance_minor: balance.ledgerBalanceMinor.toString(),
  remaining_minor: balance.remainingMinor.toString(),
  buckets: balance.buckets.map((bucket) => ({
    origin: bucket.origin,
    granted_minor: bucket.grantedMinor.toString(),
    allocated_minor: bucket.allocatedMinor.toString(),
    consumed_minor: bucket.consumedMinor.toString(),
    expired_minor: bucket.expiredMinor.toString(),
    reversed_minor: bucket.reversedMinor.toString(),
    remaining_minor: bucket.remainingMinor.toString(),
  })),
});
