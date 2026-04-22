import 'fastify';
import type { ApiKeyRole } from '@lux/ledger/application';

declare module 'fastify' {
  interface FastifyRequest {
    apiPath?: string;
    tenantId?: string;
    apiKeyId?: string;
    apiKeyRole?: ApiKeyRole;
  }
}
