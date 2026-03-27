import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

const parsed = new URL(databaseUrl);
const databaseName = parsed.pathname.replace(/^\/+/, '');
const normalizedDatabaseName = databaseName.toLowerCase();

if (databaseName.length === 0) {
  throw new Error('Unsafe DATABASE_URL: database name is missing');
}

if (normalizedDatabaseName === 'luxledger' || !normalizedDatabaseName.includes('test')) {
  throw new Error(
    `Unsafe DATABASE_URL: expected a test database name, got "${databaseName}"`,
  );
}

const sql = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 5,
  idle_timeout: 5,
});

try {
  await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
  await sql`DROP SCHEMA IF EXISTS public CASCADE`;
  await sql`CREATE SCHEMA public`;
  console.log(`Reset test database schema for ${databaseName}.`);
} finally {
  await sql.end({ timeout: 5 });
}
