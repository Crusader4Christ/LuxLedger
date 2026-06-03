const NON_EMPTY_TRIMMED_PATTERN = '^(?=.*\\S).+$';

const nonEmptyTrimmedStringSchema = {
  type: 'string',
  pattern: NON_EMPTY_TRIMMED_PATTERN,
} as const;

export type ReconCriterionRequest = {
  field: 'amount' | 'currency' | 'date' | 'reference' | 'description';
  operator: 'equals' | 'contains';
  amount_tolerance_minor?: string;
  date_tolerance_seconds?: number;
};

export type CreateReconRuleRequest = {
  name: string;
  description?: string;
  criteria: ReconCriterionRequest[];
};

export type ReconRuleResponse = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  criteria: ReconCriterionRequest[];
  created_at: string;
};

export type ReconRecordRequest = {
  id: string;
  amount_minor: string;
  currency: string;
  reference: string;
  description?: string | null;
  date: string;
  raw?: Record<string, unknown> | null;
};

export type IngestReconRecordsRequest = {
  source: string;
  records: ReconRecordRequest[];
};

export type ReconUploadResponse = {
  upload_id: string;
  tenant_id: string;
  source: string;
  record_count: number;
  created_at: string;
};

export type RunReconRequest = {
  ledger_id: string;
  upload_id: string;
  strategy: 'one_to_one';
  matching_rule_ids: string[];
  dry_run?: boolean;
};

export type ReconResultResponse = {
  id: string;
  run_id: string;
  external_record_id: string | null;
  external_id: string | null;
  transaction_id: string | null;
  status: 'matched' | 'unmatched_external' | 'unmatched_internal' | 'mismatched' | 'conflict';
  reason: string;
  candidate_transaction_ids: string[];
  created_at: string;
};

export type ReconRunResponse = {
  id: string;
  tenant_id: string;
  ledger_id: string;
  upload_id: string;
  strategy: 'one_to_one';
  status: 'pending' | 'running' | 'completed' | 'failed';
  dry_run: boolean;
  matched_count: number;
  unmatched_external_count: number;
  unmatched_internal_count: number;
  mismatched_count: number;
  conflict_count: number;
  started_at: string;
  completed_at: string | null;
  results: ReconResultResponse[];
};

export type ReconRunByIdParams = {
  id: string;
};

export const reconCriterionRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['field', 'operator'],
  properties: {
    field: {
      type: 'string',
      enum: ['amount', 'currency', 'date', 'reference', 'description'],
    },
    operator: {
      type: 'string',
      enum: ['equals', 'contains'],
    },
    amount_tolerance_minor: {
      type: 'string',
      pattern: '^[0-9]+$',
    },
    date_tolerance_seconds: {
      type: 'integer',
      minimum: 0,
    },
  },
} as const;

export const createReconRuleRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'criteria'],
  properties: {
    name: nonEmptyTrimmedStringSchema,
    description: nonEmptyTrimmedStringSchema,
    criteria: {
      type: 'array',
      minItems: 1,
      items: reconCriterionRequestSchema,
    },
  },
} as const;

export const reconRecordRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'amount_minor', 'currency', 'reference', 'date'],
  properties: {
    id: nonEmptyTrimmedStringSchema,
    amount_minor: {
      type: 'string',
      pattern: '^[1-9][0-9]*$',
    },
    currency: nonEmptyTrimmedStringSchema,
    reference: nonEmptyTrimmedStringSchema,
    description: {
      ...nonEmptyTrimmedStringSchema,
      nullable: true,
    },
    date: {
      type: 'string',
      format: 'date-time',
    },
    raw: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
    },
  },
} as const;

export const ingestReconRecordsRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'records'],
  properties: {
    source: nonEmptyTrimmedStringSchema,
    records: {
      type: 'array',
      minItems: 1,
      items: reconRecordRequestSchema,
    },
  },
} as const;

export const runReconRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['ledger_id', 'upload_id', 'strategy', 'matching_rule_ids'],
  properties: {
    ledger_id: {
      type: 'string',
      format: 'uuid',
    },
    upload_id: {
      type: 'string',
      format: 'uuid',
    },
    strategy: {
      type: 'string',
      enum: ['one_to_one'],
    },
    matching_rule_ids: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'string',
        format: 'uuid',
      },
    },
    dry_run: {
      type: 'boolean',
    },
  },
} as const;

export const reconciliationRunByIdParamsSchema = {
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
