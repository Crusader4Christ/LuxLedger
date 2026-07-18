import { mergePaginationQuerySchema } from '@luxledger/http/contracts';
import { resolveLimit } from '@luxledger/http/query/pagination';

export const createPaginationQuerySchema = mergePaginationQuerySchema;
export const resolvePaginationLimit = resolveLimit;
