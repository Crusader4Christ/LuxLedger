import type { ApiKeyService } from '@core/api-key-service';
import type { LedgerService } from '@core/ledger-service';
import type { LedgerReadService } from '@core/read-service';
import type { Logger } from 'pino';

export interface ApplicationDependencies {
  apiKeyService: ApiKeyService;
  ledgerService: LedgerService;
  readService: LedgerReadService;
}

export interface CreateServerCoreOptions {
  readinessCheck: () => Promise<void>;
  logger: Logger | boolean;
}
