import { type ReconResultStatus, reconcileOneToOne } from '@luxledger/core';
import type {
  PaginatedResult,
  PaginationQuery,
  ReconResult,
  ReconResultPaginationQuery,
  ReconRule,
} from '@luxledger/core/application';
import {
  type CreateReconRuleInput,
  type IngestReconRecordsInput,
  InvariantViolationError,
  LedgerNotFoundError,
  type ReconciliationApplicationRepository,
  type ReconRun,
  type ReconUpload,
  type RunReconInput,
  reconResultListFilter,
  reconRuleListFilter,
} from '@luxledger/core/application';
import { and, asc, eq, getTableColumns, inArray } from 'drizzle-orm';
import type { DbClient } from '../client';
import { exactTimestamp } from '../exact-timestamp';
import { listWhereScope, listWhereSql } from '../list-where';
import {
  serializeMatchingCriteria,
  toReconRecord,
  toReconResult,
  toReconRule,
  toReconRun,
} from '../mappers/reconciliation-mapper';
import { toTransactionEntity } from '../mappers/transaction-mapper';
import { paginateByCursor } from '../paginate-by-cursor';
import * as schema from '../schema';
import { generateUuidV7 } from '../uuid-v7';
import { loadEntriesByTransactionIds } from './entry-loader';

export class DrizzleReconciliationRepository implements ReconciliationApplicationRepository {
  public constructor(private readonly client: DbClient) {}

  public async ingest(input: IngestReconRecordsInput): Promise<ReconUpload> {
    return this.client.runTenantTx(
      input.tenantId,
      'ingest reconciliation external records',
      async (tx) => {
        const [upload] = await tx
          .insert(schema.reconUploads)
          .values({
            tenantId: input.tenantId,
            source: input.source,
            recordCount: input.records.length,
          })
          .returning();

        await tx.insert(schema.reconRecords).values(
          input.records.map((record) => ({
            tenantId: input.tenantId,
            uploadId: upload.id,
            externalId: record.externalId,
            source: input.source,
            amountMinor: record.amountMinor,
            currency: record.currency,
            reference: record.reference,
            description: record.description ?? null,
            occurredAt: record.occurredAt,
            raw: record.raw ?? null,
          })),
        );
        return {
          id: upload.id,
          tenantId: upload.tenantId,
          source: upload.source,
          recordCount: upload.recordCount,
          createdAt: upload.createdAt,
        };
      },
    );
  }

  public async createRule(input: CreateReconRuleInput) {
    return this.client.runTenantTx(
      input.tenantId,
      'create reconciliation matching rule',
      async (tx) => {
        const [row] = await tx
          .insert(schema.reconRules)
          .values({
            tenantId: input.tenantId,
            name: input.name,
            description: input.description ?? null,
            criteria: serializeMatchingCriteria(input.criteria),
          })
          .returning();
        return toReconRule(row);
      },
    );
  }

  public async listRules(
    query: PaginationQuery<typeof reconRuleListFilter>,
  ): Promise<PaginatedResult<ReconRule>> {
    return this.client.runTenantTx(
      query.tenantId,
      'list reconciliation matching rules',
      async (tx) => {
        const predicates = [
          eq(schema.reconRules.tenantId, query.tenantId),
          listWhereSql(getTableColumns(schema.reconRules), reconRuleListFilter, query.where),
        ];
        const page = await paginateByCursor<
          typeof schema.reconRules.$inferSelect & { cursorCreatedAt: string }
        >({
          query,
          scope: {
            resource: 'reconciliation-rules',
            tenantId: query.tenantId,
            ...listWhereScope(query.where),
          },
          order: [
            {
              column: schema.reconRules.createdAt,
              key: 'created_at',
              type: 'timestamp',
              getValue: (row) => row.cursorCreatedAt,
            },
            { column: schema.reconRules.id, key: 'id', type: 'uuid', getValue: (row) => row.id },
          ],
          selectRows: async ({ cursorPredicate, limit, orderBy }) =>
            tx
              .select({
                ...getTableColumns(schema.reconRules),
                cursorCreatedAt: exactTimestamp(schema.reconRules.createdAt),
              })
              .from(schema.reconRules)
              .where(and(...predicates, cursorPredicate))
              .orderBy(...orderBy)
              .limit(limit),
        });
        return { data: page.rows.map(toReconRule), nextCursor: page.nextCursor };
      },
    );
  }

  public async listResults(
    query: ReconResultPaginationQuery,
  ): Promise<PaginatedResult<ReconResult> | null> {
    return this.client.runTenantTx(query.tenantId, 'list reconciliation results', async (tx) => {
      const [run] = await tx
        .select({ id: schema.reconRuns.id })
        .from(schema.reconRuns)
        .where(
          and(eq(schema.reconRuns.tenantId, query.tenantId), eq(schema.reconRuns.id, query.runId)),
        )
        .limit(1);
      if (!run) return null;
      const predicates = [
        eq(schema.reconResults.tenantId, query.tenantId),
        eq(schema.reconResults.runId, query.runId),
        listWhereSql(getTableColumns(schema.reconResults), reconResultListFilter, query.where),
      ];
      const page = await paginateByCursor<
        typeof schema.reconResults.$inferSelect & { cursorCreatedAt: string }
      >({
        query,
        scope: {
          resource: 'reconciliation-results',
          tenantId: query.tenantId,
          runId: query.runId,
          ...listWhereScope(query.where),
        },
        order: [
          {
            column: schema.reconResults.createdAt,
            key: 'created_at',
            type: 'timestamp',
            getValue: (row) => row.cursorCreatedAt,
          },
          { column: schema.reconResults.id, key: 'id', type: 'uuid', getValue: (row) => row.id },
        ],
        selectRows: async ({ cursorPredicate, limit, orderBy }) =>
          tx
            .select({
              ...getTableColumns(schema.reconResults),
              cursorCreatedAt: exactTimestamp(schema.reconResults.createdAt),
            })
            .from(schema.reconResults)
            .where(and(...predicates, cursorPredicate))
            .orderBy(...orderBy)
            .limit(limit),
      });
      return { data: page.rows.map(toReconResult), nextCursor: page.nextCursor };
    });
  }

  public async getRule(tenantId: string, ruleId: string) {
    return this.client.runTenantTx(tenantId, 'get reconciliation matching rule', async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.reconRules)
        .where(and(eq(schema.reconRules.tenantId, tenantId), eq(schema.reconRules.id, ruleId)))
        .limit(1);
      return row ? toReconRule(row) : null;
    });
  }

  public async run(input: RunReconInput): Promise<ReconRun> {
    return this.client.runTenantTx(input.tenantId, 'run reconciliation', async (tx) => {
      const [ledger] = await tx
        .select({ id: schema.ledgers.id })
        .from(schema.ledgers)
        .where(
          and(eq(schema.ledgers.tenantId, input.tenantId), eq(schema.ledgers.id, input.ledgerId)),
        )
        .limit(1);
      if (!ledger) {
        throw new LedgerNotFoundError(input.ledgerId);
      }

      const [upload] = await tx
        .select()
        .from(schema.reconUploads)
        .where(
          and(
            eq(schema.reconUploads.tenantId, input.tenantId),
            eq(schema.reconUploads.id, input.uploadId),
          ),
        )
        .limit(1);
      if (!upload) {
        throw new InvariantViolationError('reconciliation upload was not found');
      }

      const ruleRows = await tx
        .select()
        .from(schema.reconRules)
        .where(
          and(
            eq(schema.reconRules.tenantId, input.tenantId),
            inArray(schema.reconRules.id, input.matchingRuleIds),
          ),
        )
        .orderBy(asc(schema.reconRules.createdAt), asc(schema.reconRules.id));
      if (ruleRows.length !== input.matchingRuleIds.length) {
        throw new InvariantViolationError(
          'one or more reconciliation matching rules were not found',
        );
      }

      const externalRows = await tx
        .select()
        .from(schema.reconRecords)
        .where(
          and(
            eq(schema.reconRecords.tenantId, input.tenantId),
            eq(schema.reconRecords.uploadId, input.uploadId),
          ),
        )
        .orderBy(asc(schema.reconRecords.occurredAt), asc(schema.reconRecords.externalId));
      if (externalRows.length === 0) {
        throw new InvariantViolationError('reconciliation upload has no records');
      }

      const transactionRows = await tx
        .select()
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.tenantId, input.tenantId),
            eq(schema.transactions.ledgerId, input.ledgerId),
          ),
        )
        .orderBy(asc(schema.transactions.createdAt), asc(schema.transactions.id));
      const entries = await loadEntriesByTransactionIds(
        tx,
        input.tenantId,
        transactionRows.map((row) => row.id),
      );
      const decisions = reconcileOneToOne({
        externalRecords: externalRows.map(toReconRecord),
        transactions: transactionRows.map((row) =>
          toTransactionEntity(row, entries.get(row.id) ?? []),
        ),
        rules: ruleRows.map(toReconRule),
      });
      const now = new Date();
      const runId = generateUuidV7();
      const run: ReconRun = {
        id: runId,
        tenantId: input.tenantId,
        ledgerId: input.ledgerId,
        uploadId: input.uploadId,
        strategy: input.strategy,
        status: 'completed',
        dryRun: input.dryRun ?? false,
        ...this.countResults(decisions.map((decision) => decision.status)),
        startedAt: now,
        completedAt: now,
        results: decisions.map((decision) => ({
          id: generateUuidV7(),
          runId,
          externalRecordId: decision.externalRecordId ?? null,
          externalId: decision.externalId ?? null,
          transactionId: decision.transactionId ?? null,
          status: decision.status,
          reason: decision.reason,
          candidateTransactionIds: decision.candidateTransactionIds,
          createdAt: now,
        })),
      };
      if (run.dryRun) {
        return run;
      }

      await tx.insert(schema.reconRuns).values({
        id: run.id,
        tenantId: run.tenantId,
        ledgerId: run.ledgerId,
        uploadId: run.uploadId,
        strategy: run.strategy,
        status: run.status,
        dryRun: run.dryRun,
        matchedCount: run.matchedCount,
        unmatchedExternalCount: run.unmatchedExternalCount,
        unmatchedInternalCount: run.unmatchedInternalCount,
        mismatchedCount: run.mismatchedCount,
        conflictCount: run.conflictCount,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
      });
      if (run.results.length > 0) {
        await tx.insert(schema.reconResults).values(
          run.results.map((result) => ({
            id: result.id,
            tenantId: input.tenantId,
            runId: run.id,
            externalRecordId: result.externalRecordId,
            externalId: result.externalId,
            transactionId: result.transactionId,
            status: result.status,
            reason: result.reason,
            candidateTransactionIds: result.candidateTransactionIds,
            createdAt: result.createdAt,
          })),
        );
      }
      return run;
    });
  }

  public async getRun(tenantId: string, runId: string): Promise<ReconRun | null> {
    return this.client.runTenantTx(tenantId, 'get reconciliation run', async (tx) => {
      const [run] = await tx
        .select()
        .from(schema.reconRuns)
        .where(and(eq(schema.reconRuns.tenantId, tenantId), eq(schema.reconRuns.id, runId)))
        .limit(1);
      if (!run) {
        return null;
      }
      const results = await tx
        .select()
        .from(schema.reconResults)
        .where(eq(schema.reconResults.runId, runId))
        .orderBy(asc(schema.reconResults.createdAt), asc(schema.reconResults.id));
      return toReconRun(run, results);
    });
  }

  private countResults(statuses: ReconResultStatus[]) {
    return {
      matchedCount: statuses.filter((status) => status === 'matched').length,
      unmatchedExternalCount: statuses.filter((status) => status === 'unmatched_external').length,
      unmatchedInternalCount: statuses.filter((status) => status === 'unmatched_internal').length,
      mismatchedCount: statuses.filter((status) => status === 'mismatched').length,
      conflictCount: statuses.filter((status) => status === 'conflict').length,
    };
  }
}
