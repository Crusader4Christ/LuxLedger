import type { ApiKeyEntity } from './entity';
import type { CreateApiKeyInput } from './input.interface';

export interface ApiKeyRepository {
  findActiveApiKeyByHash(keyHash: string): Promise<ApiKeyEntity | null>;
  findApiKeyById(apiKeyId: string): Promise<ApiKeyEntity | null>;
  createApiKey(input: CreateApiKeyInput): Promise<ApiKeyEntity>;
  listApiKeys(tenantId: string): Promise<ApiKeyEntity[]>;
  revokeApiKey(tenantId: string, apiKeyId: string): Promise<boolean>;
}
