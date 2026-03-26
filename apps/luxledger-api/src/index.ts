import { parseJwtAccessTtlSeconds } from '@api/auth-policy';
import { createServerCore, registerApplication } from '@api/server';
import { createDbClient, DrizzleLedgerRepository } from '@lux/ledger-drizzle-adapter';
import { ApiKeyService } from '@services/api-key-service';
import { LedgerService } from '@services/ledger-service';
import type { Logger } from 'pino';

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

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }

  return value;
};

export const run = async (): Promise<void> => {
  const dbClient = createDbClient();
  const server = createServerCore({
    readinessCheck: async () => {
      await dbClient.sql`select 1`;
    },
    logger: true,
  });
  const ledgerRepository = new DrizzleLedgerRepository(
    dbClient.db,
    server.log as unknown as Logger,
  );
  const apiKeyService = new ApiKeyService(ledgerRepository);
  const ledgerService = new LedgerService(ledgerRepository);
  registerApplication(server, {
    apiKeyService,
    ledgerService,
    jwtAuth: {
      signingKey: requireEnv('JWT_SIGNING_KEY'),
      issuer: process.env.JWT_ISSUER ?? 'luxledger-api',
      accessTokenTtlSeconds: parseJwtAccessTtlSeconds(process.env.JWT_ACCESS_TTL_SECONDS),
    },
  });
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
