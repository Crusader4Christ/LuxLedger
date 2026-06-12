import { ApiKeyEntity, ApiKeyRole } from '@lux/ledger';
import { RepositoryError } from '@lux/ledger/application';
import type * as schema from '../schema';

const parseApiKeyRole = (role: string): ApiKeyRole => {
  if ((Object.values(ApiKeyRole) as ApiKeyRole[]).includes(role as ApiKeyRole)) {
    return role as ApiKeyRole;
  }
  throw new RepositoryError('Unable to parse api key role');
};

export const toApiKeyEntity = (row: typeof schema.apiKeys.$inferSelect): ApiKeyEntity =>
  new ApiKeyEntity({
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    role: parseApiKeyRole(row.role),
    keyHash: row.keyHash,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  });
