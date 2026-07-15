import type { ApiKeyRole } from '@lux/ledger-http/contracts';
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    apiKeyId?: string;
    apiKeyRole?: ApiKeyRole;
  }
}
