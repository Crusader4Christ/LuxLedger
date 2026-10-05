import { EntryDirection } from '@luxledger/core';
import {
  AccountNotFoundError,
  type CreateCreditGrantInput,
  type CreditBalance,
  type CreditGrant,
  CreditGrantConflictError,
  type CreditGrantExpirationItem,
  type CreditGrantExpirationResult,
  type CreditGrantLineage,
  CreditGrantNotFoundError,
  type CreditGrantRepository,
  type CreditGrantResult,
  InvariantViolationError,
  type ProcessCreditGrantExpirationsInput,
  type ReverseCreditGrantInput,
} from '@luxledger/core/application';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DbClient, DrizzleDatabase } from '../client';
import * as schema from '../schema';
import { generateUuidV7 } from '../uuid-v7';
import { lockAccountsForMutation } from './account-mutation-lock';
import { DrizzleTransactionRepository } from './transaction-repository';

type GrantRow = typeof schema.creditGrants.$inferSelect;
type Tx = DrizzleDatabase;
type ExpirationCandidate = CreditGrantExpirationItem & {
  ledgerId: string;
  currency: string;
  createdAt: Date;
};

export class DrizzleCreditGrantRepository implements CreditGrantRepository {
  private readonly transactions: DrizzleTransactionRepository;

  public constructor(private readonly client: DbClient) {
    this.transactions = new DrizzleTransactionRepository(client);
  }

  public create(input: CreateCreditGrantInput): Promise<CreditGrantResult> {
    return this.client.runTenantTx(input.tenantId, 'create credit grant', async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:grant:${input.reference}`}, 0))`,
      );
      const [existing] = await tx
        .select()
        .from(schema.creditGrants)
        .where(
          and(
            eq(schema.creditGrants.tenantId, input.tenantId),
            eq(schema.creditGrants.reference, input.reference),
          ),
        )
        .limit(1);
      if (existing) {
        const grant = await this.toGrant(tx, existing);
        if (!this.sameScope(grant, input)) {
          throw new CreditGrantConflictError(
            'Grant reference already belongs to another ledger or account',
          );
        }
        if (!this.samePayload(grant, input)) {
          throw new CreditGrantConflictError('Grant reference payload mismatch');
        }
        return { grant, created: false };
      }

      if (input.expiresAt) {
        const [clock] = await tx.execute<{ databaseNow: Date }>(
          sql`select transaction_timestamp() as "databaseNow"`,
        );
        if (!clock || input.expiresAt.getTime() <= new Date(clock.databaseNow).getTime()) {
          throw new CreditGrantConflictError('Grant expiration must be strictly in the future');
        }
      }

      const lockedAccounts = await lockAccountsForMutation(tx, input.tenantId, [
        input.accountId,
        input.fundingAccountId,
      ]);
      const account = this.assertIssuanceAccount(
        input,
        lockedAccounts.find((candidate) => candidate.id === input.accountId),
      );
      await this.assertFundingAccountInTx(
        input,
        account,
        lockedAccounts.find((candidate) => candidate.id === input.fundingAccountId),
      );
      const id = generateUuidV7();
      const posted = await this.transactions.postCreditGrantInTx(tx, {
        tenantId: input.tenantId,
        ledgerId: input.ledgerId,
        reference: `credit-grant:${id}`,
        currency: account.currency,
        entries: [
          {
            accountId: input.fundingAccountId,
            direction: EntryDirection.DEBIT,
            amountMinor: input.amountMinor,
            currency: account.currency,
          },
          {
            accountId: input.accountId,
            direction: EntryDirection.CREDIT,
            amountMinor: input.amountMinor,
            currency: account.currency,
          },
        ],
      });
      const [row] = await tx
        .insert(schema.creditGrants)
        .values({
          id,
          tenantId: input.tenantId,
          ledgerId: input.ledgerId,
          accountId: input.accountId,
          fundingAccountId: input.fundingAccountId,
          reference: input.reference,
          externalReference: input.externalReference ?? null,
          transactionId: posted.transactionId,
          expiresAt: input.expiresAt ?? null,
        })
        .returning();
      if (!row) throw new CreditGrantConflictError('Grant insert failed');
      await this.linkWalletEntry(tx, row, posted.transactionId, 'ISSUANCE');
      return { grant: await this.toGrant(tx, row), created: true };
    });
  }

  public reverse(input: ReverseCreditGrantInput): Promise<CreditGrantResult> {
    return this.client.runTenantTx(input.tenantId, 'reverse credit grant', async (tx) => {
      const reference = `credit-grant-reversal:${input.reference}`;
      const [candidate] = await tx
        .select()
        .from(schema.creditGrants)
        .where(
          and(
            eq(schema.creditGrants.tenantId, input.tenantId),
            eq(schema.creditGrants.id, input.grantId),
          ),
        )
        .limit(1);
      if (!candidate) throw new CreditGrantNotFoundError(input.grantId);
      await lockAccountsForMutation(tx, input.tenantId, [
        candidate.accountId,
        candidate.fundingAccountId,
      ]);
      const [row] = await tx
        .select()
        .from(schema.creditGrants)
        .where(
          and(
            eq(schema.creditGrants.tenantId, input.tenantId),
            eq(schema.creditGrants.id, input.grantId),
          ),
        )
        .for('update')
        .limit(1);
      if (!row) throw new CreditGrantNotFoundError(input.grantId);
      const [referenceOwner] = await tx
        .select({
          relatedTransactionId: schema.transactions.relatedTransactionId,
        })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.tenantId, input.tenantId),
            eq(schema.transactions.reference, reference),
          ),
        )
        .limit(1);
      if (referenceOwner && referenceOwner.relatedTransactionId !== row.transactionId) {
        throw new CreditGrantConflictError('Reversal reference belongs to another grant');
      }
      const existing = await this.findReversal(tx, row);
      if (existing) {
        if (existing.reference !== reference) {
          throw new CreditGrantConflictError('Grant already reversed with another reference');
        }
        return { grant: await this.toGrant(tx, row), created: false };
      }
      const grant = await this.toGrant(tx, row);
      const [priorUse] = await tx
        .select({ entryId: schema.creditGrantEntries.entryId })
        .from(schema.creditGrantEntries)
        .where(
          and(
            eq(schema.creditGrantEntries.tenantId, input.tenantId),
            eq(schema.creditGrantEntries.grantId, row.id),
            sql`${schema.creditGrantEntries.kind} in ('CONSUMPTION', 'EXPIRATION')`,
          ),
        )
        .limit(1);
      if (priorUse) {
        throw new CreditGrantConflictError('Consumed or expired grant cannot be fully reversed');
      }
      const balance = await this.balanceInTx(tx, input.tenantId, row.accountId);
      const lot = balance.lots.find((candidate) => candidate.grantId === row.id);
      if (!lot || lot.remainingMinor !== grant.amountMinor) {
        throw new CreditGrantConflictError('Consumed grant cannot be fully reversed');
      }
      const [account] = await tx
        .select({ currency: schema.accounts.currency })
        .from(schema.accounts)
        .where(
          and(eq(schema.accounts.tenantId, input.tenantId), eq(schema.accounts.id, row.accountId)),
        )
        .limit(1);
      if (!account) throw new AccountNotFoundError(row.accountId);
      const posted = await this.transactions.postCreditGrantReversalInTx(tx, {
        tenantId: input.tenantId,
        ledgerId: row.ledgerId,
        reference,
        currency: account.currency,
        relatedTransactionId: row.transactionId,
        relationType: 'REVERSAL',
        entries: [
          {
            accountId: row.accountId,
            direction: EntryDirection.DEBIT,
            amountMinor: grant.amountMinor,
            currency: account.currency,
          },
          {
            accountId: row.fundingAccountId,
            direction: EntryDirection.CREDIT,
            amountMinor: grant.amountMinor,
            currency: account.currency,
          },
        ],
      });
      await this.linkWalletEntry(tx, row, posted.transactionId, 'REVERSAL');
      return { grant: await this.toGrant(tx, row), created: true };
    });
  }

  public findById(tenantId: string, grantId: string): Promise<CreditGrant | null> {
    return this.client.runTenantTx(tenantId, 'read credit grant', async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.creditGrants)
        .where(and(eq(schema.creditGrants.tenantId, tenantId), eq(schema.creditGrants.id, grantId)))
        .limit(1);
      return row ? this.toGrant(tx, row) : null;
    });
  }

  public getBalance(tenantId: string, accountId: string): Promise<CreditBalance> {
    return this.client.runTenantTx(tenantId, 'read credit balance', (tx) =>
      this.balanceInTx(tx, tenantId, accountId),
    );
  }

  public listLineageByGrant(tenantId: string, grantId: string): Promise<CreditGrantLineage[]> {
    return this.client.runTenantTx(tenantId, 'list credit grant lineage', (tx) =>
      this.listLineageInTx(tx, tenantId, { grantId }),
    );
  }

  public listLineageByTransaction(
    tenantId: string,
    transactionId: string,
  ): Promise<CreditGrantLineage[]> {
    return this.client.runTenantTx(tenantId, 'list transaction credit lineage', (tx) =>
      this.listLineageInTx(tx, tenantId, { transactionId }),
    );
  }

  public previewExpirations(
    input: ProcessCreditGrantExpirationsInput,
  ): Promise<CreditGrantExpirationResult> {
    return this.client.runTenantTx(
      input.tenantId,
      'preview credit grant expirations',
      async (tx) => ({
        asOf: input.asOf,
        items: await this.findExpirationCandidates(tx, input, false),
      }),
    );
  }

  public runExpirations(
    input: ProcessCreditGrantExpirationsInput,
  ): Promise<CreditGrantExpirationResult> {
    return this.client.runTenantTx(input.tenantId, 'run credit grant expirations', async (tx) => {
      const [clock] = await tx.execute<{ databaseNow: Date }>(
        sql`select transaction_timestamp() as "databaseNow"`,
      );
      if (!clock || input.asOf.getTime() > new Date(clock.databaseNow).getTime()) {
        throw new InvariantViolationError('Expiration asOf cannot be later than database time');
      }
      const candidates = await this.findExpirationCandidates(tx, input, true);
      const items: CreditGrantExpirationItem[] = [];
      for (const candidate of candidates) {
        const posted = await this.postExpirationInTx(tx, candidate);
        items.push({ ...candidate, transactionId: posted.transactionId });
      }
      return { asOf: input.asOf, items };
    });
  }

  private async findExpirationCandidates(
    tx: Tx,
    input: ProcessCreditGrantExpirationsInput,
    lock: boolean,
  ): Promise<ExpirationCandidate[]> {
    type GrantCandidateRow = {
      grantId: string;
      accountId: string;
      fundingAccountId: string;
      ledgerId: string;
      expiresAt: Date;
      currency: string;
      createdAt: Date;
    };
    type CandidateRow = GrantCandidateRow & {
      remainingMinor: string;
      expiredMinor: string;
    };
    const dueCte = sql`
      with due as materialized (
        select g.id as "grantId", g.account_id as "accountId",
          g.funding_account_id as "fundingAccountId", g.ledger_id as "ledgerId",
          g.expires_at as "expiresAt", g.created_at as "createdAt",
          capacity.remaining_minor::text as "remainingMinor",
          capacity.expired_minor::text as "expiredMinor", a.currency
        from credit_grants g
        join lateral (
          select v.remaining_minor, v.expired_minor
          from credit_grant_capacity_versions v
          where v.tenant_id = g.tenant_id and v.grant_id = g.id
          order by v.version desc
          limit 1
        ) capacity on true
        join accounts a on a.tenant_id = g.tenant_id and a.ledger_id = g.ledger_id
          and a.id = g.account_id
        where g.tenant_id = ${input.tenantId}
          and g.expires_at <= ${input.asOf.toISOString()}::timestamptz
          and capacity.remaining_minor > 0
        order by g.expires_at asc, g.created_at asc, g.id asc
        limit ${input.limit}
      )`;
    let rows: CandidateRow[];
    if (lock) {
      const dueAccounts = await tx.execute<GrantCandidateRow>(sql`${dueCte}
        select d."grantId", d."accountId", d."fundingAccountId", d."ledgerId",
          d."expiresAt", d."createdAt", d.currency
        from due d
      `);
      await lockAccountsForMutation(
        tx,
        input.tenantId,
        dueAccounts.flatMap((grant) => [grant.accountId, grant.fundingAccountId]),
      );
      // The bounded window is selected by business FEFO above. Acquire its grant locks by
      // account first to preserve the LL-91 multi-account lock hierarchy, then restore FEFO
      // before returning candidates. SKIP LOCKED may therefore produce a short page.
      const lockedGrants = await tx.execute<GrantCandidateRow>(sql`${dueCte}
        select d."grantId", d."accountId", d."fundingAccountId", d."ledgerId",
          d."expiresAt", d."createdAt", d.currency
        from due d
        join credit_grants g on g.tenant_id = ${input.tenantId} and g.id = d."grantId"
        order by g.account_id asc, g.expires_at asc, g.created_at asc, g.id asc
        for update of g skip locked
      `);
      if (lockedGrants.length === 0) return [];

      const currentCapacities = await tx
        .selectDistinctOn([schema.creditGrantCapacityVersions.grantId], {
          grantId: schema.creditGrantCapacityVersions.grantId,
          remainingMinor: schema.creditGrantCapacityVersions.remainingMinor,
          expiredMinor: schema.creditGrantCapacityVersions.expiredMinor,
        })
        .from(schema.creditGrantCapacityVersions)
        .where(
          and(
            eq(schema.creditGrantCapacityVersions.tenantId, input.tenantId),
            inArray(
              schema.creditGrantCapacityVersions.grantId,
              lockedGrants.map((grant) => grant.grantId),
            ),
          ),
        )
        .orderBy(
          schema.creditGrantCapacityVersions.grantId,
          desc(schema.creditGrantCapacityVersions.version),
        );
      const capacityByGrant = new Map(
        currentCapacities.map((capacity) => [capacity.grantId, capacity]),
      );
      rows = lockedGrants.flatMap((grant) => {
        const capacity = capacityByGrant.get(grant.grantId);
        if (!capacity || capacity.remainingMinor <= 0n) return [];
        return [
          {
            ...grant,
            remainingMinor: capacity.remainingMinor.toString(),
            expiredMinor: capacity.expiredMinor.toString(),
          },
        ];
      });
    } else {
      rows = await tx.execute<CandidateRow>(sql`${dueCte}
        select * from due
        order by "expiresAt" asc, "createdAt" asc, "grantId" asc
      `);
    }
    const candidates = rows.map((row) => ({
      grantId: row.grantId,
      accountId: row.accountId,
      fundingAccountId: row.fundingAccountId,
      ledgerId: row.ledgerId,
      expiresAt: new Date(row.expiresAt),
      amountMinor: BigInt(row.remainingMinor),
      cumulativeExpiredMinor: BigInt(row.expiredMinor) + BigInt(row.remainingMinor),
      currency: row.currency,
      createdAt: new Date(row.createdAt),
      transactionId: null,
    }));
    return candidates.sort(
      (left, right) =>
        left.expiresAt.getTime() - right.expiresAt.getTime() ||
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.grantId.localeCompare(right.grantId),
    );
  }

  private async postExpirationInTx(
    tx: Tx,
    candidate: ExpirationCandidate,
  ): Promise<{ transactionId: string }> {
    const reference = `credit-grant-expiration:${candidate.grantId}:${candidate.cumulativeExpiredMinor}`;
    const posted = await this.transactions.postCreditGrantExpirationInTx(tx, {
      tenantId: (await this.requireGrantRow(tx, candidate.grantId)).tenantId,
      ledgerId: candidate.ledgerId,
      reference,
      currency: candidate.currency,
      effectiveAt: candidate.expiresAt,
      entries: [
        {
          accountId: candidate.accountId,
          direction: EntryDirection.DEBIT,
          amountMinor: candidate.amountMinor,
          currency: candidate.currency,
        },
        {
          accountId: candidate.fundingAccountId,
          direction: EntryDirection.CREDIT,
          amountMinor: candidate.amountMinor,
          currency: candidate.currency,
        },
      ],
    });
    if (posted.created) {
      const row = await this.requireGrantRow(tx, candidate.grantId);
      await this.linkWalletEntry(tx, row, posted.transactionId, 'EXPIRATION');
    }
    return { transactionId: posted.transactionId };
  }

  private async requireGrantRow(tx: Tx, grantId: string): Promise<GrantRow> {
    const [row] = await tx
      .select()
      .from(schema.creditGrants)
      .where(eq(schema.creditGrants.id, grantId))
      .limit(1);
    if (!row) throw new CreditGrantNotFoundError(grantId);
    return row;
  }

  private async findCreditAccount(tx: Tx, tenantId: string, accountId: string) {
    const [account] = await tx
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.tenantId, tenantId), eq(schema.accounts.id, accountId)))
      .limit(1);
    return this.assertCreditAccount(account, accountId);
  }

  private async assertFundingAccountInTx(
    input: CreateCreditGrantInput,
    grantAccount: typeof schema.accounts.$inferSelect,
    fundingAccount: typeof schema.accounts.$inferSelect | undefined,
  ): Promise<void> {
    if (input.fundingAccountId === input.accountId) {
      throw new CreditGrantConflictError('Grant account and funding account must differ');
    }
    if (!fundingAccount) throw new AccountNotFoundError(input.fundingAccountId);
    if (fundingAccount.ledgerId !== input.ledgerId) {
      throw new CreditGrantConflictError('Funding account ledger mismatch');
    }
    if (fundingAccount.assetId !== grantAccount.assetId) {
      throw new CreditGrantConflictError('Funding account asset mismatch');
    }
    if (fundingAccount.currency !== grantAccount.currency) {
      throw new CreditGrantConflictError('Funding account currency mismatch');
    }
    if (input.expiresAt && fundingAccount.grantEnabled) {
      throw new CreditGrantConflictError(
        'Expiring credit grant funding account cannot be grant-enabled',
      );
    }
  }

  private assertCreditAccount(
    account: typeof schema.accounts.$inferSelect | undefined,
    accountId: string,
  ) {
    if (!account) throw new AccountNotFoundError(accountId);
    if (!account.assetId || account.side !== 'CREDIT' || account.overdraftPolicy !== 'DISALLOW') {
      throw new CreditGrantConflictError(
        'Credit account requires a registered asset, CREDIT side and DISALLOW overdraft',
      );
    }
    if (account.inflightDebitMinor !== 0n || account.inflightCreditMinor !== 0n) {
      throw new CreditGrantConflictError('Credit account cannot have unallocated holds');
    }
    return account;
  }

  private async ledgerTotalInTx(tx: Tx, tenantId: string, accountId: string): Promise<bigint> {
    const [result] = await tx
      .select({
        posted: sql<string>`coalesce(sum(case when ${schema.entries.direction} = 'CREDIT' then ${schema.entries.amountMinor} else -${schema.entries.amountMinor} end), 0)::text`,
      })
      .from(schema.entries)
      .where(and(eq(schema.entries.tenantId, tenantId), eq(schema.entries.accountId, accountId)));
    return BigInt(result?.posted ?? '0');
  }

  private assertIssuanceAccount(
    input: CreateCreditGrantInput,
    candidate: typeof schema.accounts.$inferSelect | undefined,
  ) {
    const account = this.assertCreditAccount(candidate, input.accountId);
    if (account.ledgerId !== input.ledgerId) {
      throw new CreditGrantConflictError('Grant account ledger mismatch');
    }
    if (!account.grantEnabled) {
      throw new CreditGrantConflictError('Credit grants require a grant-enabled account');
    }
    return account;
  }

  private async balanceInTx(tx: Tx, tenantId: string, accountId: string): Promise<CreditBalance> {
    const account = await this.findCreditAccount(tx, tenantId, accountId);
    const rows = await tx
      .select({
        id: schema.creditGrants.id,
        ledgerId: schema.creditGrants.ledgerId,
        reference: schema.creditGrants.reference,
        externalReference: schema.creditGrants.externalReference,
        transactionId: schema.creditGrants.transactionId,
        createdAt: schema.creditGrants.createdAt,
        expiresAt: schema.creditGrants.expiresAt,
      })
      .from(schema.creditGrants)
      .where(
        and(
          eq(schema.creditGrants.tenantId, tenantId),
          eq(schema.creditGrants.accountId, accountId),
        ),
      )
      .orderBy(schema.creditGrants.createdAt, schema.creditGrants.id);
    if (rows.length === 0) {
      return {
        accountId,
        assetId: account.assetId,
        ledgerBalanceMinor: await this.ledgerTotalInTx(tx, tenantId, accountId),
        remainingMinor: 0n,
        lots: [],
      };
    }
    const capacities = await tx
      .selectDistinctOn([schema.creditGrantCapacityVersions.grantId], {
        grantId: schema.creditGrantCapacityVersions.grantId,
        grantedMinor: schema.creditGrantCapacityVersions.grantedMinor,
        reversedMinor: schema.creditGrantCapacityVersions.reversedMinor,
        consumedMinor: schema.creditGrantCapacityVersions.consumedMinor,
        compensatedMinor: schema.creditGrantCapacityVersions.compensatedMinor,
        expiredMinor: schema.creditGrantCapacityVersions.expiredMinor,
        remainingMinor: schema.creditGrantCapacityVersions.remainingMinor,
      })
      .from(schema.creditGrantCapacityVersions)
      .where(
        and(
          eq(schema.creditGrantCapacityVersions.tenantId, tenantId),
          eq(schema.creditGrantCapacityVersions.ledgerId, account.ledgerId),
          eq(schema.creditGrantCapacityVersions.accountId, accountId),
          inArray(
            schema.creditGrantCapacityVersions.grantId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .orderBy(
        schema.creditGrantCapacityVersions.grantId,
        desc(schema.creditGrantCapacityVersions.version),
      );
    const capacityByGrant = new Map(capacities.map((capacity) => [capacity.grantId, capacity]));
    const lots: CreditBalance['lots'] = [];
    let total = 0n;
    for (const row of rows) {
      if (row.ledgerId !== account.ledgerId) {
        throw new CreditGrantConflictError('Grant account ledger mismatch');
      }
      const capacity = capacityByGrant.get(row.id);
      if (!capacity || capacity.grantedMinor <= 0n) {
        throw new CreditGrantConflictError('Grant issuance entry is missing');
      }
      const lot: CreditBalance['lots'][number] = {
        grantId: row.id,
        reference: row.reference,
        externalReference: row.externalReference,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        grantedMinor: capacity.grantedMinor,
        reversedMinor: capacity.reversedMinor,
        consumedMinor: capacity.consumedMinor,
        compensatedMinor: capacity.compensatedMinor,
        expiredMinor: capacity.expiredMinor,
        remainingMinor: capacity.remainingMinor,
      };
      lots.push(lot);
      total += lot.remainingMinor;
    }
    const ledgerBalanceMinor = await this.ledgerTotalInTx(tx, tenantId, accountId);
    if (total !== ledgerBalanceMinor) {
      throw new CreditGrantConflictError(
        'Credit grant lot totals do not reconcile with ledger balance',
      );
    }
    return {
      accountId,
      assetId: account.assetId,
      ledgerBalanceMinor,
      remainingMinor: total,
      lots,
    };
  }

  private async listLineageInTx(
    tx: Tx,
    tenantId: string,
    filter: { grantId?: string; transactionId?: string },
  ): Promise<CreditGrantLineage[]> {
    const predicates = [
      eq(schema.creditGrantEntries.tenantId, tenantId),
      sql`${schema.creditGrantEntries.kind} in ('CONSUMPTION', 'COMPENSATION', 'EXPIRATION')`,
    ];
    if (filter.grantId) predicates.push(eq(schema.creditGrantEntries.grantId, filter.grantId));
    if (filter.transactionId)
      predicates.push(eq(schema.entries.transactionId, filter.transactionId));
    const rows = await tx
      .select({
        grantId: schema.creditGrantEntries.grantId,
        entryId: schema.creditGrantEntries.entryId,
        transactionId: schema.entries.transactionId,
        kind: schema.creditGrantEntries.kind,
        amountMinor: schema.creditGrantEntries.amountMinor,
        createdAt: schema.entries.createdAt,
      })
      .from(schema.creditGrantEntries)
      .innerJoin(schema.entries, eq(schema.creditGrantEntries.entryId, schema.entries.id))
      .where(and(...predicates))
      .orderBy(schema.entries.createdAt, schema.entries.id, schema.creditGrantEntries.grantId);
    return rows.map((row) => ({
      ...row,
      kind: row.kind as CreditGrantLineage['kind'],
    }));
  }

  private async linkWalletEntry(
    tx: Tx,
    row: GrantRow,
    transactionId: string,
    kind: 'ISSUANCE' | 'REVERSAL' | 'EXPIRATION',
  ): Promise<void> {
    const walletEntries = await tx
      .select({ id: schema.entries.id, amountMinor: schema.entries.amountMinor })
      .from(schema.entries)
      .where(
        and(
          eq(schema.entries.tenantId, row.tenantId),
          eq(schema.entries.transactionId, transactionId),
          eq(schema.entries.accountId, row.accountId),
        ),
      );
    if (walletEntries.length !== 1) {
      throw new CreditGrantConflictError('Expected exactly one wallet entry');
    }
    await tx.insert(schema.creditGrantEntries).values({
      tenantId: row.tenantId,
      ledgerId: row.ledgerId,
      accountId: row.accountId,
      grantId: row.id,
      entryId: walletEntries[0].id,
      kind,
      amountMinor: walletEntries[0].amountMinor,
    });
  }

  private async findReversal(tx: Tx, row: GrantRow) {
    const [reversal] = await tx
      .select()
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.tenantId, row.tenantId),
          eq(schema.transactions.relatedTransactionId, row.transactionId),
          eq(schema.transactions.relationType, 'REVERSAL'),
        ),
      )
      .limit(1);
    return reversal;
  }

  private async toGrant(tx: Tx, row: GrantRow): Promise<CreditGrant> {
    const [issuance] = await tx
      .select({ amountMinor: schema.entries.amountMinor, assetId: schema.entries.assetId })
      .from(schema.creditGrantEntries)
      .innerJoin(schema.entries, eq(schema.creditGrantEntries.entryId, schema.entries.id))
      .where(
        and(
          eq(schema.creditGrantEntries.tenantId, row.tenantId),
          eq(schema.creditGrantEntries.grantId, row.id),
          eq(schema.entries.transactionId, row.transactionId),
          eq(schema.creditGrantEntries.kind, 'ISSUANCE'),
        ),
      )
      .limit(1);
    if (!issuance) throw new CreditGrantConflictError('Grant issuance entry is missing');
    const reversal = await this.findReversal(tx, row);
    return {
      id: row.id,
      tenantId: row.tenantId,
      ledgerId: row.ledgerId,
      accountId: row.accountId,
      fundingAccountId: row.fundingAccountId,
      assetId: issuance.assetId,
      reference: row.reference,
      externalReference: row.externalReference,
      amountMinor: issuance.amountMinor,
      transactionId: row.transactionId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      reversedByTransactionId: reversal?.id ?? null,
    };
  }

  private samePayload(grant: CreditGrant, input: CreateCreditGrantInput): boolean {
    return (
      grant.fundingAccountId === input.fundingAccountId &&
      grant.amountMinor === input.amountMinor &&
      grant.externalReference === (input.externalReference ?? null) &&
      (grant.expiresAt?.getTime() ?? null) === (input.expiresAt?.getTime() ?? null)
    );
  }

  private sameScope(grant: CreditGrant, input: CreateCreditGrantInput): boolean {
    return (
      grant.tenantId === input.tenantId &&
      grant.ledgerId === input.ledgerId &&
      grant.accountId === input.accountId
    );
  }
}
