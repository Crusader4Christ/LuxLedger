import type { LedgerService } from '@lux/ledger/application';
import {
  type CreateReconciliationMatchingRuleRequest,
  createReconciliationMatchingRuleRequestSchema,
  type IngestExternalRecordsRequest,
  ingestExternalRecordsRequestSchema,
  type ReconciliationRunByIdParams,
  type RunReconciliationRequest,
  reconciliationRunByIdParamsSchema,
  runReconciliationRequestSchema,
} from '@lux/ledger-http/contracts';
import {
  toExternalRecordsUploadResponse,
  toReconciliationMatchingRuleResponse,
  toReconciliationRunResponse,
} from '@lux/ledger-http/mappers';
import type { FastifyInstance } from 'fastify';
import { BaseRoute } from '../routes/base-route';

export class ReconciliationRoutes extends BaseRoute {
  public constructor(private readonly ledgerService: LedgerService) {
    super();
  }

  public register(server: FastifyInstance): void {
    this.registerCreateMatchingRule(server);
    this.registerListMatchingRules(server);
    this.registerIngestExternalRecords(server);
    this.registerRunReconciliation(server);
    this.registerGetReconciliationRun(server);
  }

  private registerCreateMatchingRule(server: FastifyInstance): void {
    server.post<{ Body: CreateReconciliationMatchingRuleRequest }>(
      '/v1/reconciliation/matching-rules',
      {
        schema: {
          body: createReconciliationMatchingRuleRequestSchema,
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const rule = await this.ledgerService.createReconciliationMatchingRule({
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

          return reply.status(201).send(toReconciliationMatchingRuleResponse(rule));
        }),
    );
  }

  private registerListMatchingRules(server: FastifyInstance): void {
    server.get('/v1/reconciliation/matching-rules', async (request, reply) =>
      this.handle(reply, async () => {
        const rules = await this.ledgerService.listReconciliationMatchingRules(
          request.tenantId as string,
        );
        return reply.status(200).send({
          data: rules.map(toReconciliationMatchingRuleResponse),
        });
      }),
    );
  }

  private registerIngestExternalRecords(server: FastifyInstance): void {
    server.post<{ Body: IngestExternalRecordsRequest }>(
      '/v1/reconciliation/external-records',
      {
        schema: {
          body: ingestExternalRecordsRequestSchema,
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const upload = await this.ledgerService.ingestExternalRecords({
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

          return reply.status(201).send(toExternalRecordsUploadResponse(upload));
        }),
    );
  }

  private registerRunReconciliation(server: FastifyInstance): void {
    server.post<{ Body: RunReconciliationRequest }>(
      '/v1/reconciliation/runs',
      {
        schema: {
          body: runReconciliationRequestSchema,
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const run = await this.ledgerService.runReconciliation({
            tenantId: request.tenantId as string,
            ledgerId: request.body.ledger_id,
            uploadId: request.body.upload_id,
            strategy: request.body.strategy,
            matchingRuleIds: request.body.matching_rule_ids,
            dryRun: request.body.dry_run,
          });

          return reply
            .status(request.body.dry_run ? 200 : 201)
            .send(toReconciliationRunResponse(run));
        }),
    );
  }

  private registerGetReconciliationRun(server: FastifyInstance): void {
    server.get<{ Params: ReconciliationRunByIdParams }>(
      '/v1/reconciliation/runs/:id',
      {
        schema: {
          params: reconciliationRunByIdParamsSchema,
        },
      },
      async (request, reply) =>
        this.handle(reply, async () => {
          const run = await this.ledgerService.getReconciliationRun(
            request.tenantId as string,
            request.params.id,
          );

          return reply.status(200).send(toReconciliationRunResponse(run));
        }),
    );
  }
}
