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
  amount_minor: grant.amountMinor.toString(),
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
    created_at: lot.createdAt.toISOString(),
    granted_minor: lot.grantedMinor.toString(),
    reversed_minor: lot.reversedMinor.toString(),
    remaining_minor: lot.remainingMinor.toString(),
  })),
});
