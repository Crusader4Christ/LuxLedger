import { assertNonEmpty } from '../utils/assert-non-empty';
import { validateAccountSide, validateOverdraftPolicy } from './validators';

export const AccountSide = {
  DEBIT: 'DEBIT',
  CREDIT: 'CREDIT',
} as const;

export type AccountSide = (typeof AccountSide)[keyof typeof AccountSide];

export const OverdraftPolicy = {
  ALLOW: 'ALLOW',
  DISALLOW: 'DISALLOW',
} as const;

export type OverdraftPolicy = (typeof OverdraftPolicy)[keyof typeof OverdraftPolicy];

export class AccountEntity {
  public readonly id: string;
  public readonly tenantId: string;
  public readonly ledgerId: string;
  public readonly code: string | null;
  public readonly name: string;
  public readonly side: AccountSide;
  public readonly overdraftPolicy: OverdraftPolicy;
  public readonly currency: string;
  public readonly balanceMinor: bigint;
  public readonly createdAt: Date;

  public constructor(input: {
    id: string;
    tenantId: string;
    ledgerId: string;
    code?: string | null;
    name: string;
    side: AccountSide;
    overdraftPolicy?: OverdraftPolicy;
    currency: string;
    balanceMinor: bigint;
    createdAt: Date;
  }) {
    validateAccountSide(input.side);
    validateOverdraftPolicy(input.overdraftPolicy ?? OverdraftPolicy.ALLOW);
    if (input.code != null) {
      assertNonEmpty(input.code, 'account code must not be empty');
    }

    this.id = input.id;
    this.tenantId = input.tenantId;
    this.ledgerId = input.ledgerId;
    this.code = input.code ?? null;
    this.name = input.name;
    this.side = input.side;
    this.overdraftPolicy = input.overdraftPolicy ?? OverdraftPolicy.ALLOW;
    this.currency = input.currency;
    this.balanceMinor = input.balanceMinor;
    this.createdAt = input.createdAt;
  }
}
