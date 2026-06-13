import type { ApplicationServices } from '@lux/ledger/application';
import type { ApiKeyRole } from '@lux/ledger-http/contracts';
import type { Request } from 'express';

export type ExpressLedgerAdapterDependencies = {
  services: ApplicationServices;
};

export type RequestContext = {
  tenantId: string;
  apiKeyId: string;
  apiKeyRole: ApiKeyRole;
};

export type RequestWithContext = Request & Partial<RequestContext>;
