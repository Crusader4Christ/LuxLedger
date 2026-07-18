import type { ApplicationServices } from '@luxledger/core/application';
import type { EntriesPageResponse } from '@luxledger/http/contracts';
import { toEntryResponse } from '@luxledger/http/mappers';
import type { Application, Response } from 'express';
import { sendInvalidInput, withDomainErrorHandling } from '../errors/handlers';
import { parsePaginationQuery } from '../query/pagination';
import { requireContext } from '../request/context';
import type { RequestWithContext } from '../types';

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
