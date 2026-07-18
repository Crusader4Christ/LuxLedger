import { fileURLToPath } from 'node:url';

export const luxLedgerDrizzleSchemaPath = fileURLToPath(new URL('./schema.js', import.meta.url));
