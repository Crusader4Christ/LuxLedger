import { buildServer } from '@api/server';
import { LedgerService } from '@core/ledger-service';
import { LedgerReadService } from '@core/read-service';
import { createDbClient } from '@db/client';
import { DrizzleLedgerRepository } from '@db/repository';

const parsePort = (value: string | undefined): number => {
  if (value === undefined) {
    return 3000;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  return port;
};

const parseShutdownTimeout = (value: string | undefined): number => {
  if (value === undefined) {
    return 10_000;
  }

  const timeout = Number(value);

  if (!Number.isInteger(timeout) || timeout <= 0) {
    throw new Error('SHUTDOWN_TIMEOUT_MS must be a positive integer');
  }

  return timeout;
};

export const run = async (): Promise<void> => {
  const dbClient = createDbClient();
  const ledgerRepository = new DrizzleLedgerRepository(dbClient.db);
  const ledgerService = new LedgerService(ledgerRepository);
  const readService = new LedgerReadService(ledgerRepository);
  const server = buildServer({
    ledgerService,
    readService,
    readinessCheck: async () => {
      await dbClient.sql`select 1`;
    },
    logger: true,
  });
  ledgerRepository.setLogger(server.log);
  const port = parsePort(process.env.PORT);
  const shutdownTimeoutMs = parseShutdownTimeout(process.env.SHUTDOWN_TIMEOUT_MS);

  let isShuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;
    server.log.info({ signal }, 'Received shutdown signal');

    const hardStopTimer = setTimeout(() => {
      server.log.error({ timeoutMs: shutdownTimeoutMs }, 'Graceful shutdown timed out');
      process.exit(1);
    }, shutdownTimeoutMs);
    hardStopTimer.unref();

    try {
      // Fastify close waits for in-flight requests to drain.
      await server.close();
      await dbClient.sql.end({ timeout: 5 });
      clearTimeout(hardStopTimer);
      process.exit(0);
    } catch (error) {
      clearTimeout(hardStopTimer);
      server.log.error(error);
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  try {
    await server.listen({
      host: '0.0.0.0',
      port,
    });
  } catch (error) {
    server.log.error(error);

    await dbClient.sql.end({ timeout: 5 });

    process.exit(1);
  }
};

if (import.meta.main) {
  await run();
}
