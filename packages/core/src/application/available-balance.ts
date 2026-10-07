import { calculateAvailableMinor } from '../account/available-balance';
import type { AccountSide, OverdraftPolicy } from '../account/entity';
import { OverdraftPolicyViolationError } from './errors';

export const assertAvailableBalance = (account: {
  id: string;
  side: AccountSide;
  overdraftPolicy: OverdraftPolicy;
  balanceMinor: bigint;
  reservedDeltaMinor: bigint;
}): void => {
  const availableMinor = calculateAvailableMinor(account);
  if (account.overdraftPolicy === 'DISALLOW' && availableMinor < 0n) {
    throw new OverdraftPolicyViolationError(account.id, availableMinor);
  }
};
