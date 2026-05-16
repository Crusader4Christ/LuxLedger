export type ListEntriesQuery = {
  limit?: number;
  cursor?: string;
};

export type EntryResponse = {
  id: string;
  transaction_id: string;
  account_id: string;
  direction: string;
  amount_minor: string;
  currency: string;
  created_at: string;
};

export type EntriesPageResponse = {
  data: EntryResponse[];
  next_cursor: string | null;
};

export const entryResponseSchema = {
  type: 'object',
  required: [
    'id',
    'transaction_id',
    'account_id',
    'direction',
    'amount_minor',
    'currency',
    'created_at',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    transaction_id: { type: 'string', format: 'uuid' },
    account_id: { type: 'string', format: 'uuid' },
    direction: { type: 'string', enum: ['DEBIT', 'CREDIT'] },
    amount_minor: { type: 'string' },
    currency: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const entriesPageResponseSchema = {
  type: 'object',
  required: ['data', 'next_cursor'],
  properties: {
    data: { type: 'array', items: entryResponseSchema },
    next_cursor: { type: 'string', nullable: true },
  },
} as const;
