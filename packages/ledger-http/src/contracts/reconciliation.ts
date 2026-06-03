const NON_EMPTY_TRIMMED_PATTERN = '^(?=.*\\S).+$';

const nonEmptyTrimmedStringSchema = {
  type: 'string',
  pattern: NON_EMPTY_TRIMMED_PATTERN,
} as const;

export type ReconciliationCriterionRequest = {
  field: 'amount' | 'currency' | 'date' | 'reference' | 'description';
  operator: 'equals' | 'contains';
  amount_tolerance_minor?: string;
  date_tolerance_seconds?: number;
};

export type CreateReconciliationMatchingRuleRequest = {
  name: string;
  description?: string;
  criteria: ReconciliationCriterionRequest[];
};

export type ReconciliationMatchingRuleResponse = {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  criteria: ReconciliationCriterionRequest[];
  created_at: string;
};

export type ExternalReconciliationRecordRequest = {
  id: string;
  amount_minor: string;
  currency: string;
  reference: string;
  description?: string | null;
  date: string;
  raw?: Record<string, unknown> | null;
};

export type IngestExternalRecordsRequest = {
  source: string;
  records: ExternalReconciliationRecordRequest[];
};

export type ExternalRecordsUploadResponse = {
  upload_id: string;
  tenant_id: string;
  source: string;
  record_count: number;
  created_at: string;
};

export type RunReconciliationRequest = {
  ledger_id: string;
  upload_id: string;
  strategy: 'one_to_one';
  matching_rule_ids: string[];
  dry_run?: boolean;
};

export type ReconciliationResultResponse = {
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

export type ReconciliationRunResponse = {
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
  results: ReconciliationResultResponse[];
};

export type ReconciliationRunByIdParams = {
  id: string;
};

export const reconciliationCriterionRequestSchema = {
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

export const createReconciliationMatchingRuleRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'criteria'],
  properties: {
    name: nonEmptyTrimmedStringSchema,
    description: nonEmptyTrimmedStringSchema,
    criteria: {
      type: 'array',
      minItems: 1,
      items: reconciliationCriterionRequestSchema,
    },
  },
} as const;

export const externalReconciliationRecordRequestSchema = {
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

export const ingestExternalRecordsRequestSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'records'],
  properties: {
    source: nonEmptyTrimmedStringSchema,
    records: {
      type: 'array',
      minItems: 1,
      items: externalReconciliationRecordRequestSchema,
    },
  },
} as const;

export const runReconciliationRequestSchema = {
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
