import type { LedgerService } from '@lux/ledger/application';
import {
  type CreateReconRuleRequest,
  createReconRuleRequestSchema,
  type IngestReconRecordsRequest,
  ingestReconRecordsRequestSchema,
  type ReconRunByIdParams,
  type RunReconRequest,
  reconciliationRunByIdParamsSchema,
  runReconRequestSchema,
} from '@lux/ledger-http/contracts';
import {
  toReconUploadResponse,
  toReconRuleResponse,
  toReconRunResponse,
} from '@lux/ledger-http/mappers';
import type { FastifyInstance } from 'fastify';
import { BaseRoute } from '../routes/base-route';

export class ReconRoutes extends BaseRoute {
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
    server.post<{ Body: CreateReconRuleRequest }>(
      '/v1/reconciliation/matching-rules',
      {
        schema: {
          body: createReconRuleRequestSchema,
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

          return reply.status(201).send(toReconRuleResponse(rule));
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
          data: rules.map(toReconRuleResponse),
        });
      }),
    );
  }

  private registerIngestExternalRecords(server: FastifyInstance): void {
    server.post<{ Body: IngestReconRecordsRequest }>(
      '/v1/reconciliation/external-records',
      {
        schema: {
          body: ingestReconRecordsRequestSchema,
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

          return reply.status(201).send(toReconUploadResponse(upload));
        }),
    );
  }

  private registerRunReconciliation(server: FastifyInstance): void {
    server.post<{ Body: RunReconRequest }>(
      '/v1/reconciliation/runs',
      {
        schema: {
          body: runReconRequestSchema,
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

          return reply.status(request.body.dry_run ? 200 : 201).send(toReconRunResponse(run));
        }),
    );
  }

  private registerGetReconciliationRun(server: FastifyInstance): void {
    server.get<{ Params: ReconRunByIdParams }>(
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

          return reply.status(200).send(toReconRunResponse(run));
        }),
    );
  }
}
