import type { ApiKeyRole } from '@lux/ledger-http/contracts';
import type { Request } from 'express';

export type RequestContext = {
  tenantId: string;
  apiKeyId: string;
  apiKeyRole: ApiKeyRole;
};

export type RequestWithContext = Request & Partial<RequestContext>;
