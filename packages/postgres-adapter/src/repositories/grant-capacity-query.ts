import { sql } from 'drizzle-orm';

// One bounded index lookup per grant, independent of historical version count.
// Keep this query shared with the EXPLAIN regression script.
export const grantCapacityQuery = (tenantId: string, grantIds: string[]) => sql`
  select latest.grant_id as "grantId", latest.remaining_minor::text as "remainingMinor",
    latest.reserved_minor::text as "reservedMinor"
  from unnest(array[${sql.join(
    grantIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]) requested(id)
  cross join lateral (
    select grant_id, remaining_minor, reserved_minor from credit_grant_capacity_versions
    where tenant_id = ${tenantId}::uuid and grant_id = requested.id
    order by version desc limit 1
  ) latest`;
