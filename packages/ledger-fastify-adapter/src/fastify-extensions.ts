import type { ApiKeyRole } from '@lux/ledger/application';
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    apiKeyId?: string;
    apiKeyRole?: ApiKeyRole;
  }
}
