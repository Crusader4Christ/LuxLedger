import type { JwtAuthConfig } from '@api/jwt-auth';
import type { ApiKeyService } from '@services/api-key-service';
import type { LedgerService } from '@services/ledger-service';
import type { FastifyBaseLogger } from 'fastify';

export interface ApplicationDependencies {
  apiKeyService: ApiKeyService;
  ledgerService: LedgerService;
  jwtAuth: JwtAuthConfig;
}

export interface CreateServerCoreOptions {
  readinessCheck: () => Promise<void>;
  logger: FastifyBaseLogger | boolean;
}
