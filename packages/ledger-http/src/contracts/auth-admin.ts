import { ApiKeyRole } from '@lux/ledger/application';
import type { InferSchema } from '../schema-types';
import { NonEmptyTrimmedStringSchema } from './common';
export { ApiKeyRole };

export const MIN_JWT_ACCESS_TTL_SECONDS = 300;
export const MAX_JWT_ACCESS_TTL_SECONDS = 900;
export const DEFAULT_JWT_ACCESS_TTL_SECONDS = MAX_JWT_ACCESS_TTL_SECONDS;

export type AuthTokenRequestHeaders = {
  'x-api-key': string;
};

export const authTokenResponseSchema = {
  type: 'object',
  required: ['access_token', 'token_type', 'expires_in'],
  properties: {
    access_token: { type: 'string' },
    token_type: { type: 'string', const: 'Bearer' },
    expires_in: {
      type: 'integer',
      minimum: MIN_JWT_ACCESS_TTL_SECONDS,
      maximum: MAX_JWT_ACCESS_TTL_SECONDS,
      default: DEFAULT_JWT_ACCESS_TTL_SECONDS,
    },
  },
} as const;

export const apiKeyContractSchema = {
  type: 'object',
  required: ['id', 'tenant_id', 'name', 'role', 'created_at', 'revoked_at'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    tenant_id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    role: { type: 'string', enum: [...Object.values(ApiKeyRole)] },
    created_at: { type: 'string', format: 'date-time' },
    revoked_at: { type: 'string', format: 'date-time', nullable: true },
  },
} as const;

export const listApiKeysResponseSchema = {
  type: 'object',
  required: ['data'],
  properties: { data: { type: 'array', items: apiKeyContractSchema } },
} as const;

export const createApiKeyBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'role'],
  properties: {
    name: NonEmptyTrimmedStringSchema,
    role: { type: 'string', enum: [...Object.values(ApiKeyRole)] },
  },
} as const;

export const createApiKeyResponseSchema = {
  type: 'object',
  required: ['api_key', 'key'],
  properties: {
    api_key: { type: 'string' },
    key: apiKeyContractSchema,
  },
} as const;

export const revokeApiKeyParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', format: 'uuid' } },
} as const;

export type AuthTokenResponse = InferSchema<typeof authTokenResponseSchema>;
export type ApiKeyContract = InferSchema<typeof apiKeyContractSchema>;
export type ListApiKeysResponse = InferSchema<typeof listApiKeysResponseSchema>;
export type CreateApiKeyRequest = InferSchema<typeof createApiKeyBodySchema>;
export type CreateApiKeyResponse = InferSchema<typeof createApiKeyResponseSchema>;
export type RevokeApiKeyParams = InferSchema<typeof revokeApiKeyParamsSchema>;
