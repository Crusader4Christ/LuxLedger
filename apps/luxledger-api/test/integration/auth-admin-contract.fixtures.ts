import { expect } from 'bun:test';
import {
  type ApiKeyContract,
  type AuthTokenResponse,
  apiKeyContractSchema,
  authTokenResponseSchema,
  type CreateApiKeyRequest,
  type CreateApiKeyResponse,
  createApiKeyBodySchema,
} from '@lux/ledger-http/contracts';
import {
  extractPathMethodSection,
  extractPropertyNames,
  extractRequiredList,
  extractSchemaSection,
} from './openapi-contract-helpers';

export const createApiKeyRequestFactory = (
  name = 'Service key',
  role: CreateApiKeyRequest['role'] = 'SERVICE',
): CreateApiKeyRequest => ({
  name,
  role,
});

export const assertAuthTokenResponseShape = (payload: AuthTokenResponse): void => {
  expect(Object.keys(payload).sort()).toEqual(
    Object.keys(authTokenResponseSchema.properties).sort(),
  );
  expect(payload.token_type).toBe('Bearer');
};

export const assertApiKeyContractShape = (payload: ApiKeyContract): void => {
  expect(Object.keys(payload).sort()).toEqual(Object.keys(apiKeyContractSchema.properties).sort());
};

export const assertCreateApiKeyResponseShape = (payload: CreateApiKeyResponse): void => {
  expect(typeof payload.api_key).toBe('string');
  assertApiKeyContractShape(payload.key);
};

export const assertOpenApiAuthAdminContractsSynced = (openapiYaml: string): void => {
  const tokenSection = extractPathMethodSection(openapiYaml, '/v1/auth/token', 'post');
  expect(tokenSection).toContain('- ApiKeyAuth: []');
  expect(tokenSection).toContain("$ref: '#/components/schemas/AuthTokenResponse'");
  expect(tokenSection.includes('requestBody:')).toBeFalse();

  const authTokenSchemaSection = extractSchemaSection(openapiYaml, 'AuthTokenResponse');
  expect(extractRequiredList(authTokenSchemaSection)).toEqual(
    [...authTokenResponseSchema.required].sort(),
  );
  expect(extractPropertyNames(authTokenSchemaSection)).toEqual(
    Object.keys(authTokenResponseSchema.properties).sort(),
  );

  const listApiKeysSection = extractPathMethodSection(openapiYaml, '/v1/admin/api-keys', 'get');
  expect(listApiKeysSection).toContain("$ref: '#/components/schemas/ApiKeysListResponse'");

  const createApiKeysSection = extractPathMethodSection(openapiYaml, '/v1/admin/api-keys', 'post');
  expect(createApiKeysSection).toContain("$ref: '#/components/schemas/CreateApiKeyRequest'");
  expect(createApiKeysSection).toContain("$ref: '#/components/schemas/CreateApiKeyResponse'");

  const createApiKeyRequestSchemaSection = extractSchemaSection(openapiYaml, 'CreateApiKeyRequest');
  expect(extractRequiredList(createApiKeyRequestSchemaSection)).toEqual(
    [...createApiKeyBodySchema.required].sort(),
  );
  expect(extractPropertyNames(createApiKeyRequestSchemaSection)).toEqual(
    Object.keys(createApiKeyBodySchema.properties).sort(),
  );

  const apiKeySchemaSection = extractSchemaSection(openapiYaml, 'ApiKey');
  expect(extractRequiredList(apiKeySchemaSection)).toEqual(
    [...apiKeyContractSchema.required].sort(),
  );
  expect(extractPropertyNames(apiKeySchemaSection)).toEqual(
    Object.keys(apiKeyContractSchema.properties).sort(),
  );

  const revokeApiKeySection = extractPathMethodSection(
    openapiYaml,
    '/v1/admin/api-keys/{id}/revoke',
    'post',
  );
  expect(revokeApiKeySection).toContain("$ref: '#/components/parameters/ApiKeyIdPath'");
  expect(revokeApiKeySection).toContain("'204':");
};
