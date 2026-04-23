import type { JwtAuthConfig } from '@api/auth/jwt';
import type { RateLimitConfig } from '@api/rate-limit/policy';
import type { ApiKeyService, LedgerService } from '@lux/ledger/application';
import type { FastifyBaseLogger } from 'fastify';

export interface ApplicationDependencies {
  apiKeyService: ApiKeyService;
  ledgerService: LedgerService;
  jwtAuth: JwtAuthConfig;
  rateLimit: RateLimitConfig;
}

export interface CreateServerCoreOptions {
  readinessCheck: () => Promise<void>;
  logger: FastifyBaseLogger | boolean;
}
