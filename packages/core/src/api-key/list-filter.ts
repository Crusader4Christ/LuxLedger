import { defineListFilter } from '../application/list-filters';
import type { ApiKeyEntity } from './entity';

export const apiKeyListFilter = defineListFilter<ApiKeyEntity>()({
  exclude: ['tenantId', 'keyHash'],
});
