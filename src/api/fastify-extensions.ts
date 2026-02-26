import 'fastify';
import type { ApiKeyRole } from '@core/types';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    apiKeyId?: string;
    apiKeyRole?: ApiKeyRole;
  }
}
