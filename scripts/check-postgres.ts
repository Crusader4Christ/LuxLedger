import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const parsed = new URL(databaseUrl);
const databaseName = parsed.pathname.replace(/^\/+/, '') || '(missing database)';
const port = parsed.port || '5432';
const target = `${parsed.hostname}:${port}/${databaseName}`;

const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 5,
  idle_timeout: 5,
});

try {
  await sql`select 1`;
  console.log(`PostgreSQL is reachable at ${target}.`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(
    `Unable to connect to PostgreSQL at ${target}. Start the test database and verify DATABASE_URL / DATABASE_URL_TEST.`,
  );
  console.error(message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
