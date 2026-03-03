import type { ApiKeyService } from '@services/api-key-service';
import type { LedgerService } from '@services/ledger-service';
import type { Logger } from 'pino';

export interface ApplicationDependencies {
  apiKeyService: ApiKeyService;
  ledgerService: LedgerService;
}

export interface CreateServerCoreOptions {
  readinessCheck: () => Promise<void>;
  logger: Logger | boolean;
}
