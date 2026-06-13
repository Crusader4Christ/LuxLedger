import type { ApplicationServices } from '@lux/ledger/application';
import {
  type CreateReconRuleRequest,
  createReconRuleRequestSchema,
  type IngestReconRecordsRequest,
  ingestReconRecordsRequestSchema,
  type ReconRuleResponse,
  type ReconRulesListResponse,
  type ReconRunByIdParams,
  type ReconRunResponse,
  type ReconUploadResponse,
  type RunReconRequest,
  runReconRequestSchema,
} from '@lux/ledger-http/contracts';
import {
  toReconRuleResponse,
  toReconRunResponse,
  toReconUploadResponse,
} from '@lux/ledger-http/mappers';
import { parseUuidParam } from '@lux/ledger-http/validation-utils';
import type { Application, Response } from 'express';
import {
  type RequestWithContext,
  requireContext,
  sendInvalidInput,
  validate,
  withDomainErrorHandling,
} from '../route-support';

type ReconciliationRouteServices = Pick<ApplicationServices, 'reconciliation'>;

export const registerReconciliationRoutes = (
  app: Application,
  services: ReconciliationRouteServices,
): void => {
  app.post('/v1/reconciliation/matching-rules', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<CreateReconRuleRequest>(createReconRuleRequestSchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const rule = await services.reconciliation.createRule({
        tenantId: context.tenantId,
        name: body.name,
        description: body.description,
        criteria: body.criteria.map((criterion) => ({
          field: criterion.field,
          operator: criterion.operator,
          amountToleranceMinor:
            criterion.amount_tolerance_minor === undefined
              ? undefined
              : BigInt(criterion.amount_tolerance_minor),
          dateToleranceSeconds: criterion.date_tolerance_seconds,
        })),
      });
      const response: ReconRuleResponse = toReconRuleResponse(rule);
      res.status(201).json(response);
    }),
  );

  app.get('/v1/reconciliation/matching-rules', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const context = requireContext(req);
      const rules = await services.reconciliation.listRules(context.tenantId);
      const response: ReconRulesListResponse = {
        data: rules.map(toReconRuleResponse),
      };
      res.status(200).json(response);
    }),
  );

  app.post('/v1/reconciliation/external-records', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<IngestReconRecordsRequest>(ingestReconRecordsRequestSchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const upload = await services.reconciliation.ingest({
        tenantId: context.tenantId,
        source: body.source,
        records: body.records.map((record) => ({
          externalId: record.id,
          amountMinor: BigInt(record.amount_minor),
          currency: record.currency,
          reference: record.reference,
          description: record.description ?? null,
          occurredAt: new Date(record.date),
          raw: record.raw ?? null,
        })),
      });
      const response: ReconUploadResponse = toReconUploadResponse(upload);
      res.status(201).json(response);
    }),
  );

  app.post('/v1/reconciliation/runs', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const body = validate<RunReconRequest>(runReconRequestSchema, req.body);
      if (body === null) {
        sendInvalidInput(res, 'Invalid request body');
        return;
      }
      const context = requireContext(req);
      const run = await services.reconciliation.run({
        tenantId: context.tenantId,
        ledgerId: body.ledger_id,
        uploadId: body.upload_id,
        strategy: body.strategy,
        matchingRuleIds: body.matching_rule_ids,
        dryRun: body.dry_run,
      });
      const response: ReconRunResponse = toReconRunResponse(run);
      res.status(body.dry_run ? 200 : 201).json(response);
    }),
  );

  app.get('/v1/reconciliation/runs/:id', async (req: RequestWithContext, res: Response) =>
    withDomainErrorHandling(res, async () => {
      const params = parseUuidParam<keyof ReconRunByIdParams>(req.params.id, 'id');
      if (params === null) {
        sendInvalidInput(res, 'Invalid path parameter');
        return;
      }
      const context = requireContext(req);
      const run = await services.reconciliation.getRun(context.tenantId, params.id);
      const response: ReconRunResponse = toReconRunResponse(run);
      res.status(200).json(response);
    }),
  );
};
