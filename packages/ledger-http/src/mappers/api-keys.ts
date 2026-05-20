import type {
  ApiKeyContract,
  CreateApiKeyResponse,
  ListApiKeysResponse,
} from '../contracts/auth-admin';
import type { ApiKeyEntity } from '@lux/ledger';
import type { CreateApiKeyResult } from '@lux/ledger/application';

export const toApiKeyContract = (key: ApiKeyEntity): ApiKeyContract => ({
  id: key.id,
  tenant_id: key.tenantId,
  name: key.name,
  role: key.role,
  created_at: key.createdAt.toISOString(),
  revoked_at: key.revokedAt ? key.revokedAt.toISOString() : null,
});

export const toListApiKeysResponse = (keys: ApiKeyEntity[]): ListApiKeysResponse => ({
  data: keys.map(toApiKeyContract),
});

export const toCreateApiKeyResponse = (result: CreateApiKeyResult): CreateApiKeyResponse => ({
  api_key: result.apiKey,
  key: toApiKeyContract(result.key),
});
