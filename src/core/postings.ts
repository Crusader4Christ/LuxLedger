import { InvariantViolationError } from '@core/errors';

export const DIRECTIONS = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
} as const;

export type Direction = (typeof DIRECTIONS)[keyof typeof DIRECTIONS];

export interface Account {
  id: string;
  ledgerId: string;
  currency: string;
}

export interface Posting {
  accountId: string;
  direction: Direction;
  amount: number;
  currency: string;
}

export interface Transaction {
  id: string;
  ledgerId: string;
  currency: string;
  postings: Posting[];
}

export interface CreateTransactionInput {
  id: string;
  ledgerId: string;
  currency: string;
  postings: Posting[];
}

const isValidDirection = (direction: string): direction is Direction =>
  direction === DIRECTIONS.DEBIT || direction === DIRECTIONS.CREDIT;

const assert = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new InvariantViolationError(message);
  }
};

export const createTransaction = (
  input: CreateTransactionInput,
  accounts: Account[],
): Transaction => {
  assert(input.postings.length >= 2, 'transaction must have at least 2 entries');

  const accountsById = new Map(accounts.map((account) => [account.id, account]));

  let debitTotal = 0;
  let creditTotal = 0;

  for (const posting of input.postings) {
    assert(isValidDirection(posting.direction), 'posting direction must be DEBIT or CREDIT');

    assert(posting.amount !== 0, 'no zero entries');
    assert(posting.amount > 0, 'amount must be greater than 0');

    assert(posting.currency === input.currency, 'currency must match');

    const account = accountsById.get(posting.accountId);

    assert(Boolean(account), `account not found: ${posting.accountId}`);
    assert(account?.currency === input.currency, 'currency must match');
    assert(account?.ledgerId === input.ledgerId, 'account must belong to same ledger');

    if (posting.direction === DIRECTIONS.DEBIT) {
      debitTotal += posting.amount;
    } else {
      creditTotal += posting.amount;
    }
  }

  assert(debitTotal === creditTotal, 'total debits must equal total credits');

  return {
    id: input.id,
    ledgerId: input.ledgerId,
    currency: input.currency,
    postings: input.postings,
  };
};
