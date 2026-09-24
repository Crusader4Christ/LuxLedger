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
  provenance: grant.provenance,
  expires_at: grant.expiresAt?.toISOString() ?? null,
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
  lots: balance.lots.map((lot) => ({
    grant_id: lot.grantId,
    reference: lot.reference,
    external_reference: lot.externalReference,
    policy: {
      refundable: lot.policy.refundable,
      transferable: lot.policy.transferable,
      consumption_priority: lot.policy.consumptionPriority,
      eligibility: lot.policy.eligibility,
    },
    created_at: lot.createdAt.toISOString(),
    provenance: lot.provenance,
    expires_at: lot.expiresAt?.toISOString() ?? null,
    granted_minor: lot.grantedMinor.toString(),
    allocated_minor: lot.allocatedMinor.toString(),
    consumed_minor: lot.consumedMinor.toString(),
    expired_minor: lot.expiredMinor.toString(),
    reversed_minor: lot.reversedMinor.toString(),
    remaining_minor: lot.remainingMinor.toString(),
  })),
});
