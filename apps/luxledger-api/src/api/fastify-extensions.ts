import 'fastify';
import type { ApiKeyRole } from '@lux/ledger/application';

declare module 'fastify' {
  interface FastifyRequest {
    apiPath?: string;
    requestStartedAt?: bigint;
    tenantId?: string;
    apiKeyId?: string;
    apiKeyRole?: ApiKeyRole;
  }
}
