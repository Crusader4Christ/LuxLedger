import type { InferSchema } from '../schema-types';
import { NonEmptyTrimmedStringSchema } from './common';

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
    name: NonEmptyTrimmedStringSchema,
    description: NonEmptyTrimmedStringSchema,
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
    id: NonEmptyTrimmedStringSchema,
    amount_minor: {
      type: 'string',
      pattern: '^[1-9][0-9]*$',
    },
    currency: NonEmptyTrimmedStringSchema,
    reference: NonEmptyTrimmedStringSchema,
    description: {
      ...NonEmptyTrimmedStringSchema,
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
    source: NonEmptyTrimmedStringSchema,
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

export const reconRuleResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'tenant_id', 'name', 'description', 'criteria', 'created_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenant_id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    criteria: { type: 'array', items: reconCriterionRequestSchema },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const reconRulesListResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['data'],
  properties: {
    data: { type: 'array', items: reconRuleResponseSchema },
  },
} as const;

export const reconUploadResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['upload_id', 'tenant_id', 'source', 'record_count', 'created_at'],
  properties: {
    upload_id: { type: 'string', format: 'uuid' },
    tenant_id: { type: 'string', format: 'uuid' },
    source: { type: 'string' },
    record_count: { type: 'integer', minimum: 0 },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const reconResultResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'run_id',
    'external_record_id',
    'external_id',
    'transaction_id',
    'status',
    'reason',
    'candidate_transaction_ids',
    'created_at',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    run_id: { type: 'string', format: 'uuid' },
    external_record_id: { type: 'string', format: 'uuid', nullable: true },
    external_id: { type: 'string', nullable: true },
    transaction_id: { type: 'string', format: 'uuid', nullable: true },
    status: {
      type: 'string',
      enum: ['matched', 'unmatched_external', 'unmatched_internal', 'mismatched', 'conflict'],
    },
    reason: { type: 'string' },
    candidate_transaction_ids: {
      type: 'array',
      items: { type: 'string', format: 'uuid' },
    },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

export const reconRunResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'tenant_id',
    'ledger_id',
    'upload_id',
    'strategy',
    'status',
    'dry_run',
    'matched_count',
    'unmatched_external_count',
    'unmatched_internal_count',
    'mismatched_count',
    'conflict_count',
    'started_at',
    'completed_at',
    'results',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenant_id: { type: 'string', format: 'uuid' },
    ledger_id: { type: 'string', format: 'uuid' },
    upload_id: { type: 'string', format: 'uuid' },
    strategy: { type: 'string', enum: ['one_to_one'] },
    status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] },
    dry_run: { type: 'boolean' },
    matched_count: { type: 'integer', minimum: 0 },
    unmatched_external_count: { type: 'integer', minimum: 0 },
    unmatched_internal_count: { type: 'integer', minimum: 0 },
    mismatched_count: { type: 'integer', minimum: 0 },
    conflict_count: { type: 'integer', minimum: 0 },
    started_at: { type: 'string', format: 'date-time' },
    completed_at: { type: 'string', format: 'date-time', nullable: true },
    results: { type: 'array', items: reconResultResponseSchema },
  },
} as const;

export type ReconCriterionRequest = InferSchema<typeof reconCriterionRequestSchema>;
export type CreateReconRuleRequest = InferSchema<typeof createReconRuleRequestSchema>;
export type ReconRuleResponse = InferSchema<typeof reconRuleResponseSchema>;
export type ReconRulesListResponse = InferSchema<typeof reconRulesListResponseSchema>;
export type ReconRecordRequest = InferSchema<typeof reconRecordRequestSchema>;
export type IngestReconRecordsRequest = InferSchema<typeof ingestReconRecordsRequestSchema>;
export type ReconUploadResponse = InferSchema<typeof reconUploadResponseSchema>;
export type RunReconRequest = InferSchema<typeof runReconRequestSchema>;
export type ReconResultResponse = InferSchema<typeof reconResultResponseSchema>;
export type ReconRunResponse = InferSchema<typeof reconRunResponseSchema>;
export type ReconRunByIdParams = InferSchema<typeof reconciliationRunByIdParamsSchema>;
