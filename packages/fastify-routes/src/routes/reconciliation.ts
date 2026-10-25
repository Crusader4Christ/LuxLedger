import type {
  ReconciliationService,
  reconResultListFilter,
  reconRuleListFilter,
  WhereFor,
} from '@luxledger/core/application';
import {
  invalidWhereError,
  readWhereParameter,
  reconResultListFilterFields,
  reconRuleFilterFields,
} from '@luxledger/http';
import {
  type CreateReconRuleRequest,
  createReconRuleRequestSchema,
  type IngestReconRecordsRequest,
  ingestReconRecordsRequestSchema,
  listReconRulesQuerySchema,
  type ReconRunByIdParams,
  type RunReconRequest,
  reconciliationRunByIdParamsSchema,
  reconResultsListQuerySchema,
  reconResultsListResponseSchema,
  reconRuleResponseSchema,
  reconRulesListResponseSchema,
  reconRunResponseSchema,
  reconUploadResponseSchema,
  runReconRequestSchema,
} from '@luxledger/http/contracts';
import {
  toReconResultResponse,
  toReconRuleResponse,
  toReconRunResponse,
  toReconUploadResponse,
} from '@luxledger/http/mappers';
import type { FastifyInstance } from 'fastify';
import { handleValidationError } from '../errors/validation-error-handler';
import { resolvePaginationLimit } from '../query/pagination';
import { BaseRoute } from '../routing/base-route';

export class ReconRoutes extends BaseRoute {
  public constructor(private readonly reconciliation: ReconciliationService) {
    super();
  }

  public register(server: FastifyInstance): void {
    this.registerCreateMatchingRule(server);
    this.registerListMatchingRules(server);
    this.registerIngestExternalRecords(server);
    this.registerRunReconciliation(server);
    this.registerGetReconciliationRun(server);
    this.registerListReconciliationResults(server);
  }

  private registerCreateMatchingRule(server: FastifyInstance): void {
    server.post<{ Body: CreateReconRuleRequest }>(
      '/v1/reconciliation/matching-rules',
      {
        errorHandler: handleValidationError,
        schema: {
          body: createReconRuleRequestSchema,
          response: { 201: reconRuleResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const rule = await this.reconciliation.createRule({
            tenantId: request.tenantId as string,
            name: request.body.name,
            description: request.body.description,
            criteria: request.body.criteria.map((criterion) => ({
              field: criterion.field,
              operator: criterion.operator,
              amountToleranceMinor:
                criterion.amount_tolerance_minor === undefined
                  ? undefined
                  : BigInt(criterion.amount_tolerance_minor),
              dateToleranceSeconds: criterion.date_tolerance_seconds,
            })),
          });

          return reply.status(201).send(toReconRuleResponse(rule));
        }),
    );
  }

  private registerListMatchingRules(server: FastifyInstance): void {
    server.get<{ Querystring: { where?: string; limit?: number; cursor?: string } }>(
      '/v1/reconciliation/matching-rules',
      {
        errorHandler: handleValidationError,
        schema: {
          querystring: listReconRulesQuerySchema,
          response: { 200: reconRulesListResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const where = readWhereParameter<WhereFor<typeof reconRuleListFilter>>(
            request.raw.url ?? '',
            reconRuleFilterFields,
          );
          if (where === null) throw invalidWhereError();
          const rules = await this.reconciliation.listRules({
            tenantId: request.tenantId as string,
            limit: resolvePaginationLimit(request.query.limit),
            cursor: request.query.cursor,
            where,
          });
          return reply.status(200).send({
            data: rules.data.map(toReconRuleResponse),
            next_cursor: rules.nextCursor,
          });
        }),
    );
  }

  private registerListReconciliationResults(server: FastifyInstance): void {
    server.get<{
      Params: ReconRunByIdParams;
      Querystring: { where?: string; limit?: number; cursor?: string };
    }>(
      '/v1/reconciliation/runs/:id/results',
      {
        errorHandler: handleValidationError,
        schema: {
          params: reconciliationRunByIdParamsSchema,
          querystring: reconResultsListQuerySchema,
          response: { 200: reconResultsListResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const where = readWhereParameter<WhereFor<typeof reconResultListFilter>>(
            request.raw.url ?? '',
            reconResultListFilterFields,
          );
          if (where === null) throw invalidWhereError();
          const result = await this.reconciliation.listResults({
            tenantId: request.tenantId as string,
            runId: request.params.id,
            limit: resolvePaginationLimit(request.query.limit),
            cursor: request.query.cursor,
            where,
          });
          return reply
            .status(200)
            .send({ data: result.data.map(toReconResultResponse), next_cursor: result.nextCursor });
        }),
    );
  }

  private registerIngestExternalRecords(server: FastifyInstance): void {
    server.post<{ Body: IngestReconRecordsRequest }>(
      '/v1/reconciliation/external-records',
      {
        errorHandler: handleValidationError,
        schema: {
          body: ingestReconRecordsRequestSchema,
          response: { 201: reconUploadResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const upload = await this.reconciliation.ingest({
            tenantId: request.tenantId as string,
            source: request.body.source,
            records: request.body.records.map((record) => ({
              externalId: record.id,
              amountMinor: BigInt(record.amount_minor),
              currency: record.currency,
              reference: record.reference,
              description: record.description ?? null,
              occurredAt: new Date(record.date),
              raw: record.raw ?? null,
            })),
          });

          return reply.status(201).send(toReconUploadResponse(upload));
        }),
    );
  }

  private registerRunReconciliation(server: FastifyInstance): void {
    server.post<{ Body: RunReconRequest }>(
      '/v1/reconciliation/runs',
      {
        errorHandler: handleValidationError,
        schema: {
          body: runReconRequestSchema,
          response: {
            200: reconRunResponseSchema,
            201: reconRunResponseSchema,
          },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const run = await this.reconciliation.run({
            tenantId: request.tenantId as string,
            ledgerId: request.body.ledger_id,
            uploadId: request.body.upload_id,
            strategy: request.body.strategy,
            matchingRuleIds: request.body.matching_rule_ids,
            dryRun: request.body.dry_run,
          });

          return reply.status(request.body.dry_run ? 200 : 201).send(toReconRunResponse(run));
        }),
    );
  }

  private registerGetReconciliationRun(server: FastifyInstance): void {
    server.get<{ Params: ReconRunByIdParams }>(
      '/v1/reconciliation/runs/:id',
      {
        errorHandler: handleValidationError,
        schema: {
          params: reconciliationRunByIdParamsSchema,
          response: { 200: reconRunResponseSchema },
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const run = await this.reconciliation.getRun(
            request.tenantId as string,
            request.params.id,
          );

          return reply.status(200).send(toReconRunResponse(run));
        }),
    );
  }
}
