import { describe, expect, it } from 'bun:test';

import { InvariantViolationError } from '@core/errors';
import {
  type Account,
  type CreateTransactionInput,
  createTransaction,
  DIRECTIONS,
} from '@core/postings';

const baseAccounts: Account[] = [
  {
    id: 'account-debit',
    ledgerId: 'ledger-1',
    currency: 'USD',
  },
  {
    id: 'account-credit',
    ledgerId: 'ledger-1',
    currency: 'USD',
  },
];

const baseInput: CreateTransactionInput = {
  id: 'tx-1',
  ledgerId: 'ledger-1',
  currency: 'USD',
  postings: [
    {
      accountId: 'account-debit',
      direction: DIRECTIONS.DEBIT,
      amount: 100,
      currency: 'USD',
    },
    {
      accountId: 'account-credit',
      direction: DIRECTIONS.CREDIT,
      amount: 100,
      currency: 'USD',
    },
  ],
};

describe('createTransaction invariants', () => {
  it('creates transaction for valid double-entry postings', () => {
    const transaction = createTransaction(baseInput, baseAccounts);

    expect(transaction.id).toBe('tx-1');
    expect(transaction.postings.length).toBe(2);
  });

  it('throws when transaction has less than two entries', () => {
    const invalidInput: CreateTransactionInput = {
      ...baseInput,
      postings: [baseInput.postings[0]],
    };

    expect(() => createTransaction(invalidInput, baseAccounts)).toThrowError(
      new InvariantViolationError('transaction must have at least 2 entries'),
    );
  });

  it('throws when debit and credit totals differ', () => {
    const invalidInput: CreateTransactionInput = {
      ...baseInput,
      postings: [
        baseInput.postings[0],
        {
          ...baseInput.postings[1],
          amount: 99,
        },
      ],
    };

    expect(() => createTransaction(invalidInput, baseAccounts)).toThrowError(
      new InvariantViolationError('total debits must equal total credits'),
    );
  });

  it('throws when posting currency differs from transaction currency', () => {
    const invalidInput: CreateTransactionInput = {
      ...baseInput,
      postings: [
        {
          ...baseInput.postings[0],
          currency: 'EUR',
        },
        baseInput.postings[1],
      ],
    };

    expect(() => createTransaction(invalidInput, baseAccounts)).toThrowError(
      new InvariantViolationError('currency must match'),
    );
  });

  it('throws when account currency differs from transaction currency', () => {
    const accounts: Account[] = [
      {
        ...baseAccounts[0],
        currency: 'EUR',
      },
      baseAccounts[1],
    ];

    expect(() => createTransaction(baseInput, accounts)).toThrowError(
      new InvariantViolationError('currency must match'),
    );
  });

  it('throws when account belongs to another ledger', () => {
    const accounts: Account[] = [
      {
        ...baseAccounts[0],
        ledgerId: 'ledger-2',
      },
      baseAccounts[1],
    ];

    expect(() => createTransaction(baseInput, accounts)).toThrowError(
      new InvariantViolationError('account must belong to same ledger'),
    );
  });

  it('throws when amount is negative', () => {
    const invalidInput: CreateTransactionInput = {
      ...baseInput,
      postings: [
        {
          ...baseInput.postings[0],
          amount: -1,
        },
        {
          ...baseInput.postings[1],
          amount: 1,
        },
      ],
    };

    expect(() => createTransaction(invalidInput, baseAccounts)).toThrowError(
      new InvariantViolationError('amount must be greater than 0'),
    );
  });

  it('throws when amount is zero', () => {
    const invalidInput: CreateTransactionInput = {
      ...baseInput,
      postings: [
        {
          ...baseInput.postings[0],
          amount: 0,
        },
        baseInput.postings[1],
      ],
    };

    expect(() => createTransaction(invalidInput, baseAccounts)).toThrowError(
      new InvariantViolationError('no zero entries'),
    );
  });
});
