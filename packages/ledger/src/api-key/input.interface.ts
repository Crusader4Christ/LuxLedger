import type { ApiKeyRole } from './entity';

export interface CreateApiKeyInput {
  tenantId: string;
  name: string;
  role: ApiKeyRole;
  keyHash: string;
}
