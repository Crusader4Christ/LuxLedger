import type { ApiKeyService, LedgerService } from '@lux/ledger/application';
import type { Application, Request, Response } from 'express';

export type ExpressLedgerAdapterDependencies = {
  ledgerService: LedgerService;
  apiKeyService: ApiKeyService;
};

const sendDomainError = (res: Response, error: unknown): Response => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'httpStatus' in error &&
    typeof (error as { httpStatus: unknown }).httpStatus === 'number' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  ) {
    const typed = error as { httpStatus: number; code: string; message: string };
    return res.status(typed.httpStatus).json({ error: typed.code, message: typed.message });
  }

  return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
};

export const registerLedgerExpressAdapter = (
  app: Application,
  dependencies: ExpressLedgerAdapterDependencies,
): void => {
  app.get('/v1/ledgers', async (req: Request, res: Response) => {
    try {
      const tenantId = (req as Request & { tenantId?: string }).tenantId;
      const ledgers = await dependencies.ledgerService.getLedgersByTenant(tenantId as string);
      res.status(200).json(ledgers);
    } catch (error) {
      sendDomainError(res, error);
    }
  });
};
