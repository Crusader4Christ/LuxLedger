# Operations Runbook (MVP): Bootstrap, API Keys, JWT, and Auth Incidents

## Scope

This runbook covers operator workflows for:

- First tenant/admin bootstrap.
- API key create/revoke/rotate lifecycle.
- JWT configuration validation and signing key rotation checks.
- Auth outage and token issuance incident triage.

For JWT key rotation details, use this runbook together with:

- [JWT Signing Key Rotation Runbook](./jwt-key-rotation.md)
- [Observability MVP Runbook](./observability-mvp.md)

## 1) Bootstrap: First Tenant + First Admin API Key

### Pre-check

1. Confirm the database is reachable and migrated:
   - `docker compose up -d`
   - `cp .env.example .env` (if not already present)
   - `bun install`
   - `bun run db:migrate`
2. Confirm required env vars are set:
   - `DATABASE_URL`
   - `JWT_SIGNING_KEY`
3. Choose bootstrap-only secret inputs (do not commit):
   - `BOOTSTRAP_TENANT_NAME` (example: `Acme`)
   - `BOOTSTRAP_ADMIN_KEY_NAME` (example: `Initial admin key`)
   - `BOOTSTRAP_ADMIN_API_KEY` (recommended `llk_` prefix, example: `llk_acme_admin_seed_2026_05_07`)
4. Ensure this is truly first bootstrap:
   - The script only creates records when `api_keys` is empty.

### Action

1. Run bootstrap:

```sh
BOOTSTRAP_TENANT_NAME="Acme" \
BOOTSTRAP_ADMIN_KEY_NAME="Initial admin key" \
BOOTSTRAP_ADMIN_API_KEY="llk_acme_admin_seed_2026_05_07" \
bun run bootstrap:admin-key
```

2. Start API:

```sh
bun run dev
```

3. Mint a JWT with the bootstrap admin key:

```sh
curl -sS -X POST http://127.0.0.1:3000/v1/auth/token \
  -H "x-api-key: llk_acme_admin_seed_2026_05_07"
```

### Post-check

1. Bootstrap output must be one of:
   - Created: JSON with `created: true`, `tenantId`, `apiKeyId`.
   - Idempotent skip: `Bootstrap skipped: api_keys already contains records`.
2. `POST /v1/auth/token` returns `200` with `access_token`, `token_type`, `expires_in`.
3. Use returned bearer token to list keys and confirm one ADMIN key exists:

```sh
TOKEN="<access_token>"
curl -sS http://127.0.0.1:3000/v1/admin/api-keys \
  -H "Authorization: Bearer $TOKEN"
```

### Rollback / Recovery

1. If bootstrap fails before any insert, fix env/config and rerun.
2. If bootstrap created tenant/key but process failed later, rerunning is safe and will skip.
3. If bootstrap key value is exposed, immediately perform API key rotation (section 2.4) and retire the exposed key.
4. If database is left in an unknown partially-initialized state, restore from backup or manually inspect `tenants` + `api_keys` before retrying.

## 2) API Key Lifecycle (Create / Revoke / Rotate)

### 2.1 Create API key

#### Pre-check

1. Operator has a valid ADMIN API key for the same tenant.
2. Operator can mint JWT using `POST /v1/auth/token`.
3. Key purpose and role are defined (`ADMIN` or `SERVICE`).

#### Action

1. Mint admin JWT:

```sh
ADMIN_KEY="<current_admin_key>"
ADMIN_TOKEN="$(curl -sS -X POST http://127.0.0.1:3000/v1/auth/token -H "x-api-key: $ADMIN_KEY" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')"
```

2. Create key:

```sh
curl -sS -X POST http://127.0.0.1:3000/v1/admin/api-keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"name":"Service key - billing worker","role":"SERVICE"}'
```

#### Post-check

1. Response is `201` and includes:
   - `api_key` (shown once; capture securely).
   - `key.id` and metadata.
2. New key can mint JWT:
   - `POST /v1/auth/token` with new `x-api-key` returns `200`.
3. `GET /v1/admin/api-keys` shows the key with `revoked_at: null`.

### 2.2 Revoke API key

#### Pre-check

1. Confirm target key ID and owner tenant.
2. Ensure at least one alternate working key exists to avoid admin lockout.

#### Action

```sh
KEY_ID_TO_REVOKE="<uuid>"
curl -i -sS -X POST "http://127.0.0.1:3000/v1/admin/api-keys/$KEY_ID_TO_REVOKE/revoke" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

#### Post-check

1. Revoke response is `204 No Content`.
2. Mint with revoked key now fails:
   - `POST /v1/auth/token` returns `401`.
3. Existing bearer tokens issued from revoked key fail on next authenticated request (`401`).

### 2.3 Rotate API key (safe sequence)

#### Pre-check

1. Rotation window is scheduled and consumers can reload secrets.
2. Existing key (`old`) is still active.
3. Monitoring/alerts are active for auth failures (see observability runbook).

#### Action

1. Create replacement key (`new`) with same role.
2. Distribute `new` key to consumers without revoking `old`.
3. Validate each consumer can mint and use tokens with `new`.
4. After all consumers are confirmed on `new`, revoke `old`.

#### Post-check

1. `new` key: token minting succeeds and protected endpoints work.
2. `old` key: token minting fails after revocation.
3. Auth failure metrics do not show sustained spike after rotation.

### 2.4 Emergency API key compromise response

#### Pre-check

1. Confirm compromise scope (single key vs multiple keys/tenant-wide leak).
2. Identify affected integrations and owners.

#### Action

1. Create replacement key(s) immediately.
2. Switch critical integrations first.
3. Revoke compromised key(s) as soon as replacements are live.
4. If blast radius is unclear, rotate all tenant keys.

#### Post-check

1. Compromised keys cannot mint tokens (`401`).
2. Production traffic continues using replacement keys.
3. Incident timeline captures exact revoke timestamps and impacted key IDs.

## 3) JWT Configuration and Rotation Checklist

### 3.1 Runtime config checklist

### Pre-check

1. Validate env values:
   - `JWT_SIGNING_KEY` required, unpadded base64url, >= 32 random bytes.
   - `JWT_PREVIOUS_SIGNING_KEYS` optional, comma-separated, no duplicates, must not include active signing key.
   - `JWT_ACCESS_TTL_SECONDS` in `[300, 900]`.
   - `JWT_CLOCK_SKEW_SECONDS` in `[0, 60]`.
2. Confirm time sync on API hosts (NTP) to reduce skew issues.

### Action

1. Restart or deploy API with intended env.
2. Check `/health` and `/ready` are healthy.
3. Mint and validate a token through normal auth flow.

### Post-check

1. Startup fails fast if key config is invalid (expected behavior).
2. `expires_in` in token response matches configured TTL.
3. No unexpected `401` surge after deploy.

### 3.2 JWT signing key rotation (planned/emergency/rollback)

Use [JWT Signing Key Rotation Runbook](./jwt-key-rotation.md) as the source of truth for:

1. Planned rotation sequence and grace window.
2. Emergency compromise rotation.
3. Rollback using last known-good key.

Operational add-on checks:

1. Watch for warning logs `JWT verified with previous signing key` during grace window.
2. Remove old keys from `JWT_PREVIOUS_SIGNING_KEYS` only after:
   - Wait time >= `JWT_ACCESS_TTL_SECONDS + JWT_CLOCK_SKEW_SECONDS`.
   - Expected old-token traffic has drained.

### 3.3 Clock skew and token TTL checks

### Pre-check

1. Confirm configured values are intentionally chosen for environment latency and clock drift.
2. Confirm clients refresh tokens before expiration.

### Action

1. Mint a token and record issue time.
2. Verify it is accepted immediately.
3. Verify rejection happens after `exp` plus allowed skew window.

### Post-check

1. Early-expiration or not-yet-valid token incidents are absent.
2. If auth failures align with host clock drift, treat as platform incident and escalate to infrastructure on-call.

## 4) Incident Handling Playbook: Auth Outages / Token Issuance Failures

### Severity triggers

1. `SEV-1`: auth/token issuance fully unavailable or widespread `401/403` across tenants.
2. `SEV-2`: partial outage affecting one tenant, one key cohort, or one deployment slice.
3. `SEV-3`: intermittent auth errors with no confirmed customer impact yet.

### Triage flow

### Pre-check

1. Confirm blast radius:
   - All tenants vs single tenant.
   - Token issuance only (`/v1/auth/token`) vs all bearer-auth endpoints.
2. Check recent changes:
   - JWT env/config changes.
   - API key revocations/rotations.
   - Deployment rollouts.

### Action

1. Validate service health:
   - `GET /health`, `GET /ready`, DB connectivity.
2. Reproduce quickly:
   - Known-good API key -> `POST /v1/auth/token`.
   - Known-good bearer token -> protected endpoint call.
3. Inspect metrics/logs:
   - `luxledger_auth_failures_total`
   - `luxledger_token_issuance_failures_total`
   - Request logs with `requestId`, `tenantId`, `apiKeyId`, `route`.
4. Decide mitigation:
   - Config regression: rollback to last known-good JWT config.
   - Key compromise or mistaken revoke: issue replacement keys, recover integrations.
   - Clock skew: restore time sync and temporarily increase scrutiny on token validity failures.

### Immediate mitigations

1. JWT mis-rotation: apply rollback procedure from JWT runbook.
2. Revoked critical key by mistake: create new key and redeploy client secret immediately.
3. Deployment slice issue: stop rollout and roll back bad slice.

### Escalation path

1. Primary on-call owns triage and mitigation.
2. Escalate to platform/infrastructure on-call for DB/network/time-sync failures.
3. Escalate to security on-call for key compromise indicators.
4. Communicate status every 15 minutes for `SEV-1`/`SEV-2` until stable.

### Post-incident verification checklist

### Post-check

1. `/v1/auth/token` success rate recovered to baseline.
2. Protected endpoint auth failures returned to baseline.
3. Replacement keys are active and old compromised keys are revoked.
4. JWT config matches intended state and stale previous keys removed when safe.
5. Incident record includes timeline, root cause, mitigations, and follow-up actions.

## 5) Maintainability Notes

1. Keep this runbook updated with every auth/bootstrap flow change.
2. Keep command snippets copy/paste ready and environment-agnostic (`127.0.0.1:3000` can be replaced with target host).
3. Keep all auth hardening docs in `docs/runbooks/` and linked from repository README/docs index.
