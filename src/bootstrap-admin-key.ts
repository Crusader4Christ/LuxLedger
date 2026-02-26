import { ApiKeyService } from '@core/api-key-service';
import { createDbClient } from '@db/client';
import { DrizzleLedgerRepository } from '@db/repository';

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
};

export const run = async (): Promise<void> => {
  const dbClient = createDbClient();
  const repository = new DrizzleLedgerRepository(dbClient.db, console);
  const apiKeyService = new ApiKeyService(repository);

  try {
    const result = await apiKeyService.bootstrapInitialAdmin({
      tenantName: requireEnv('BOOTSTRAP_TENANT_NAME'),
      keyName: process.env.BOOTSTRAP_ADMIN_KEY_NAME ?? 'Initial admin key',
      rawApiKey: requireEnv('BOOTSTRAP_ADMIN_API_KEY'),
    });

    if (!result.created) {
      console.log('Bootstrap skipped: api_keys already contains records');
      return;
    }

    console.log(
      JSON.stringify(
        {
          created: true,
          tenantId: result.tenantId,
          apiKeyId: result.apiKeyId,
        },
        null,
        2,
      ),
    );
  } finally {
    await dbClient.sql.end({ timeout: 5 });
  }
};

if (import.meta.main) {
  await run();
}
