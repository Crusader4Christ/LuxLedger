import type { ApplicationServices } from '@lux/ledger/application';
import type { EntriesPageResponse } from '@lux/ledger-http/contracts';
import { toEntryResponse } from '@lux/ledger-http/mappers';
import type { Application, Response } from 'express';
import { parsePaginationQuery } from '../query/pagination';
import {
  type RequestWithContext,
  requireContext,
  sendInvalidInput,
  withDomainErrorHandling,
} from './route-support';

type EntryRouteServices = Pick<ApplicationServices, 'transactions'>;

export const registerEntryRoutes = (app: Application, services: EntryRouteServices): void => {
  app.get('/v1/entries', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const pagination = parsePaginationQuery(req.query);
      if (pagination === null) {
        sendInvalidInput(res, 'Invalid querystring');
        return;
      }
      const context = requireContext(req);
      const page = await services.transactions.listEntries({
        tenantId: context.tenantId,
        limit: pagination.limit,
        cursor: pagination.cursor,
      });
      const response: EntriesPageResponse = {
        data: page.data.map(toEntryResponse),
        next_cursor: page.nextCursor,
      };
      res.status(200).json(response);
    }),
  );
};
