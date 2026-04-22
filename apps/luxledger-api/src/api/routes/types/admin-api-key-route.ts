import type { ApiKeyRole } from '@lux/ledger';

export interface CreateApiKeyBody {
  name: string;
  role: ApiKeyRole;
}

export interface RevokeApiKeyParams {
  id: string;
}
