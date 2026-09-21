import { calculateAvailableMinor } from '../account/available-balance';
import type { OverdraftPolicy } from '../account/entity';
import { OverdraftPolicyViolationError } from './errors';

export const assertAvailableBalance = (account: {
  id: string;
  overdraftPolicy: OverdraftPolicy;
  balanceMinor: bigint;
  inflightDebitMinor: bigint;
  inflightCreditMinor: bigint;
}): void => {
  const availableMinor = calculateAvailableMinor(account);
  if (account.overdraftPolicy === 'DISALLOW' && availableMinor < 0n) {
    throw new OverdraftPolicyViolationError(account.id, availableMinor);
  }
};
