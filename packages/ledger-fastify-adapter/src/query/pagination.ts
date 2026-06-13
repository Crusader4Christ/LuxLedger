import { mergePaginationQuerySchema } from '@lux/ledger-http/contracts';
import { resolveLimit } from '@lux/ledger-http/query/pagination';

export const createPaginationQuerySchema = mergePaginationQuerySchema;
export const resolvePaginationLimit = resolveLimit;
