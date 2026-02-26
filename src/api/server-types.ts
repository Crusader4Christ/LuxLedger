import type { ApiKeyService } from '@core/api-key-service';
import type { LedgerService } from '@core/ledger-service';
import type { LedgerReadService } from '@core/read-service';
import type { FastifyServerOptions } from 'fastify';

export interface ApplicationDependencies {
  apiKeyService: ApiKeyService;
  ledgerService: LedgerService;
  readService: LedgerReadService;
}

export interface BuildServerOptions extends ApplicationDependencies {
  readinessCheck: () => Promise<void>;
  logger: FastifyServerOptions['logger'];
}

export interface CreateServerCoreOptions {
  readinessCheck: () => Promise<void>;
  logger: FastifyServerOptions['logger'];
}
