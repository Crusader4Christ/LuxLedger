import type { TrialBalance } from '@luxledger/core/application';
import type { TrialBalanceResponse } from '../contracts/ledgers';

export const toTrialBalanceResponse = (trialBalance: TrialBalance): TrialBalanceResponse => ({
  ledger_id: trialBalance.ledgerId,
  accounts: trialBalance.accounts.map((account) => ({
    account_id: account.accountId,
    code: account.code,
    name: account.name,
    normal_balance: account.normalBalance,
    balance: account.balanceMinor.toString(),
    balance_side: account.balanceSide,
  })),
  total_debits: trialBalance.totalDebitsMinor.toString(),
  total_credits: trialBalance.totalCreditsMinor.toString(),
});
