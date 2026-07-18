import type { ApiKeyRole } from '@luxledger/http/contracts';
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    tenantId?: string;
    apiKeyId?: string;
    apiKeyRole?: ApiKeyRole;
  }
}
