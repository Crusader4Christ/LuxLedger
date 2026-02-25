import { buildServer } from '@api/server';
import { createDbClient } from '@db/client';

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

const server = buildServer({ logger: true });
const dbClient = createDbClient();
const port = parsePort(process.env.PORT);

let isShuttingDown = false;

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  server.log.info({ signal }, 'Received shutdown signal');

  try {
    await server.close();

    await dbClient.sql.end({ timeout: 5 });

    process.exit(0);
  } catch (error) {
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
