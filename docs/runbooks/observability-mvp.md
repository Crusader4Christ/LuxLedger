# Observability MVP Runbook

## Scope

This runbook defines the minimum production observability baseline for `apps/luxledger-api`.

- Metrics endpoint: `GET /metrics` (Prometheus text format).
- Structured request logs with stable fields: `requestId`, `tenantId`, `apiKeyId`, `route`.
- Alert rules for API 5xx spikes and auth anomalies.
- On-call dashboard/query references.

## Exposed metrics

- `luxledger_http_requests_total{route,status}`
  - Counter of completed HTTP requests by normalized route template and status code.
- `luxledger_http_request_duration_seconds{route,status,*}`
  - Histogram of request latency in seconds by normalized route template and status code.
- `luxledger_auth_failures_total{route,status}`
  - Counter for auth failures (currently 401/403 on `/v1/*` routes).
- `luxledger_token_issuance_failures_total{status}`
  - Counter for failed `POST /v1/auth/token` attempts (4xx/5xx).

## Alert rules (initial thresholds)

Use these as MVP defaults, then tune with production traffic data.

### 1) API 5xx spike

Severity: `page`  
Condition: 5xx ratio over all requests exceeds `2%` for `10m`, with at least `100` requests in the window.

PromQL:

```promql
(
  sum(rate(luxledger_http_requests_total{status=~"5.."}[10m]))
  /
  sum(rate(luxledger_http_requests_total[10m]))
) > 0.02
and
sum(increase(luxledger_http_requests_total[10m])) >= 100
```

### 2) Auth anomaly rate

Severity: `page`  
Condition: auth failure ratio exceeds `20%` for `10m`, with at least `50` auth attempts.

PromQL:

```promql
(
  sum(rate(luxledger_auth_failures_total[10m]))
  /
  sum(rate(luxledger_http_requests_total{route=~"/v1/auth/token|/v1/.*"}[10m]))
) > 0.20
and
sum(increase(luxledger_http_requests_total{route=~"/v1/auth/token|/v1/.*"}[10m])) >= 50
```

### 3) Token issuance failures anomaly

Severity: `warn`  
Condition: failed token issuance ratio exceeds `10%` for `10m`, with at least `20` token attempts.

PromQL:

```promql
(
  sum(rate(luxledger_token_issuance_failures_total[10m]))
  /
  sum(rate(luxledger_http_requests_total{route="/v1/auth/token"}[10m]))
) > 0.10
and
sum(increase(luxledger_http_requests_total{route="/v1/auth/token"}[10m])) >= 20
```

## Dashboard/query references for on-call

### Request volume and errors by route

```promql
sum by (route, status) (rate(luxledger_http_requests_total[5m]))
```

### p95 latency by route

```promql
histogram_quantile(
  0.95,
  sum by (le, route) (rate(luxledger_http_request_duration_seconds_bucket[5m]))
)
```

### Auth failures by route

```promql
sum by (route, status) (rate(luxledger_auth_failures_total[5m]))
```

### Token issuance failures by status

```promql
sum by (status) (rate(luxledger_token_issuance_failures_total[5m]))
```

### Structured log query examples

Search failed requests with route + tenant context:

```text
msg="Request completed" AND statusCode>=400
```

Break down by mandatory fields:

```text
msg="Request completed" | fields requestId, tenantId, apiKeyId, route, statusCode, durationMs
```

## Log hygiene policy

- Do not log raw API keys, bearer tokens, or auth headers.
- Keep request completion logs limited to non-secret context fields.
- Keep Fastify request auto-logging disabled to avoid accidental header logging.
