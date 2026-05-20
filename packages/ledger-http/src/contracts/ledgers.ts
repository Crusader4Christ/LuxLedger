import { NonEmptyTrimmedStringSchema } from './common';

export type CreateLedgerRequest = {
  name: string;
};

export type LedgerResponse = {
  id: string;
  tenantId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export type LedgerByIdParams = {
  id: string;
};

export type TrialBalanceParams = {
  ledger_id: string;
};

export type TrialBalanceAccountResponse = {
  account_id: string;
  code: string;
  name: string;
  normal_balance: 'DEBIT' | 'CREDIT';
  balance: string;
  is_contra: boolean;
};

export type TrialBalanceResponse = {
  ledger_id: string;
  accounts: TrialBalanceAccountResponse[];
  total_debits: string;
  total_credits: string;
};

export type LedgersListResponse = LedgerResponse[];

export const createLedgerBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: NonEmptyTrimmedStringSchema,
  },
} as const;

export const ledgerByIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
    },
  },
} as const;

export const trialBalanceParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ledger_id'],
  properties: {
    ledger_id: {
      type: 'string',
      format: 'uuid',
    },
  },
} as const;

export const ledgerResponseSchema = {
  type: 'object',
  required: ['id', 'tenantId', 'name', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenantId: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
} as const;

export const ledgersListResponseSchema = {
  type: 'array',
  items: ledgerResponseSchema,
} as const;

export const trialBalanceAccountResponseSchema = {
  type: 'object',
  required: ['account_id', 'code', 'name', 'normal_balance', 'balance', 'is_contra'],
  properties: {
    account_id: { type: 'string', format: 'uuid' },
    code: { type: 'string' },
    name: { type: 'string' },
    normal_balance: { type: 'string', enum: ['DEBIT', 'CREDIT'] },
    balance: { type: 'string' },
    is_contra: { type: 'boolean' },
  },
} as const;

export const trialBalanceResponseSchema = {
  type: 'object',
  required: ['ledger_id', 'accounts', 'total_debits', 'total_credits'],
  properties: {
    ledger_id: { type: 'string', format: 'uuid' },
    accounts: { type: 'array', items: trialBalanceAccountResponseSchema },
    total_debits: { type: 'string' },
    total_credits: { type: 'string' },
  },
} as const;
