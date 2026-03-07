import 'fastify';
import type { ApiKeyRole } from '@services/types';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    apiKeyId?: string;
    apiKeyRole?: ApiKeyRole;
  }
}
