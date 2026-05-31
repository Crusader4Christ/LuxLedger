import { AccountSide, OverdraftPolicy } from './entity';
import { InvalidAccountSideError, InvalidOverdraftPolicyError } from './errors';

export function validateAccountSide(side: string): void {
  if (!(Object.values(AccountSide) as string[]).includes(side)) {
    throw new InvalidAccountSideError();
  }
}

export function parseAccountSide(side: string): AccountSide {
  validateAccountSide(side);
  return side as AccountSide;
}

export function validateOverdraftPolicy(policy: string): void {
  if (!(Object.values(OverdraftPolicy) as string[]).includes(policy)) {
    throw new InvalidOverdraftPolicyError();
  }
}

export function parseOverdraftPolicy(policy: string): OverdraftPolicy {
  validateOverdraftPolicy(policy);
  return policy as OverdraftPolicy;
}
