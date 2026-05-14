import { expect } from 'bun:test';
import {
  type ApiKeyContract,
  type AuthTokenResponse,
  apiKeyContractSchema,
  authTokenResponseSchema,
  type CreateApiKeyRequest,
  type CreateApiKeyResponse,
  createApiKeyBodySchema,
} from '@api/contracts/auth-admin';

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
  const normalizeList = (value: string) =>
    value
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .sort();

  const extractPathMethodSection = (path: string, method: string): string => {
    const pathMatch = openapiYaml.match(new RegExp(`^\\s*${path}:\\s*$`, 'm'));
    if (!pathMatch || pathMatch.index === undefined) {
      throw new Error(`OpenAPI path not found: ${path}`);
    }

    const fromPath = openapiYaml.slice(pathMatch.index);
    const pathHeaderMatch = fromPath.match(/^\s*\/v1\/[^\n]+:\s*$/m);
    const pathHeaderLength = pathHeaderMatch?.[0].length ?? 0;
    const pathBody = fromPath.slice(pathHeaderLength);

    const methodMatch = pathBody.match(new RegExp(`^\\s*${method}:\\s*$`, 'm'));
    if (!methodMatch || methodMatch.index === undefined) {
      throw new Error(`OpenAPI method not found: ${method} under ${path}`);
    }

    const sectionStart =
      pathMatch.index + pathHeaderLength + methodMatch.index + methodMatch[0].length;
    const tail = openapiYaml.slice(sectionStart);
    const endMatch = tail.match(/\n\s*\/v1\/[^\n]+:\s*$/m);
    const end = endMatch?.index ?? tail.length;
    return tail.slice(0, end);
  };

  const extractSchemaSection = (schemaName: string): string => {
    const startMatch = openapiYaml.match(new RegExp(`^\\s{4}${schemaName}:\\s*$`, 'm'));
    if (!startMatch || startMatch.index === undefined) {
      throw new Error(`OpenAPI schema not found: ${schemaName}`);
    }

    const tail = openapiYaml.slice(startMatch.index + startMatch[0].length);
    const endMatch = tail.match(/\n\s{4}[A-Za-z0-9_]+:\s*$/m);
    const end = endMatch?.index ?? tail.length;
    return tail.slice(0, end);
  };

  const extractRequiredList = (section: string): string[] => {
    const match = section.match(/required:\s*\[([^\]]+)\]/);
    if (!match) {
      throw new Error('required list not found in OpenAPI section');
    }
    return normalizeList(match[1]);
  };

  const extractPropertyNames = (section: string): string[] => {
    const propertiesIndex = section.indexOf('properties:');
    if (propertiesIndex === -1) {
      throw new Error('properties block not found in OpenAPI section');
    }

    const afterProperties = section.slice(propertiesIndex);
    const names = [...afterProperties.matchAll(/^\s{8}([a-z_]+):\s*$/gm)].map(
      (match) => match[1] ?? '',
    );

    return names.filter((name) => name.length > 0).sort();
  };

  const tokenSection = extractPathMethodSection('/v1/auth/token', 'post');
  expect(tokenSection).toContain('- ApiKeyAuth: []');
  expect(tokenSection).toContain("$ref: '#/components/schemas/AuthTokenResponse'");
  expect(tokenSection.includes('requestBody:')).toBeFalse();

  const authTokenSchemaSection = extractSchemaSection('AuthTokenResponse');
  expect(extractRequiredList(authTokenSchemaSection)).toEqual(
    [...authTokenResponseSchema.required].sort(),
  );
  expect(extractPropertyNames(authTokenSchemaSection)).toEqual(
    Object.keys(authTokenResponseSchema.properties).sort(),
  );

  const listApiKeysSection = extractPathMethodSection('/v1/admin/api-keys', 'get');
  expect(listApiKeysSection).toContain("$ref: '#/components/schemas/ApiKeysListResponse'");

  const createApiKeysSection = extractPathMethodSection('/v1/admin/api-keys', 'post');
  expect(createApiKeysSection).toContain("$ref: '#/components/schemas/CreateApiKeyRequest'");
  expect(createApiKeysSection).toContain("$ref: '#/components/schemas/CreateApiKeyResponse'");

  const createApiKeyRequestSchemaSection = extractSchemaSection('CreateApiKeyRequest');
  expect(extractRequiredList(createApiKeyRequestSchemaSection)).toEqual(
    [...createApiKeyBodySchema.required].sort(),
  );
  expect(extractPropertyNames(createApiKeyRequestSchemaSection)).toEqual(
    Object.keys(createApiKeyBodySchema.properties).sort(),
  );

  const apiKeySchemaSection = extractSchemaSection('ApiKey');
  expect(extractRequiredList(apiKeySchemaSection)).toEqual(
    [...apiKeyContractSchema.required].sort(),
  );
  expect(extractPropertyNames(apiKeySchemaSection)).toEqual(
    Object.keys(apiKeyContractSchema.properties).sort(),
  );

  const revokeApiKeySection = extractPathMethodSection('/v1/admin/api-keys/{id}/revoke', 'post');
  expect(revokeApiKeySection).toContain("$ref: '#/components/parameters/ApiKeyIdPath'");
  expect(revokeApiKeySection).toContain("'204':");
};
