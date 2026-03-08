# LuxLedger
financial core infrastructure

## API auth flow

- Exchange long-lived API key for JWT: `POST /v1/auth/token` with `x-api-key`.
- Use access token for API calls: `Authorization: Bearer <jwt>`.
- See API contract: `apps/luxledger-api/openapi/openapi.yaml`.
