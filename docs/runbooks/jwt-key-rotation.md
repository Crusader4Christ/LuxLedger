# JWT Signing Key Rotation Runbook

## Scope

This runbook covers HS256 access-token signing keys used by `apps/luxledger-api`.

## Configuration contract

- `JWT_SIGNING_KEY` is the only key used for signing.
- `JWT_PREVIOUS_SIGNING_KEYS` is an optional comma-separated list of keys accepted for verification only.
- Every key must be an unpadded base64url string representing at least 32 random bytes.
- `JWT_ACCESS_TTL_SECONDS` defaults to `900` and must stay between `300` and `900`.
- `JWT_CLOCK_SKEW_SECONDS` defaults to `5` and must stay between `0` and `60`.
- Verification accepts a token only when `iat <= now + JWT_CLOCK_SKEW_SECONDS` and `exp > now - JWT_CLOCK_SKEW_SECONDS`.

## Operational assumptions

- Rotation grace is explicit. There is no automatic expiry for entries in `JWT_PREVIOUS_SIGNING_KEYS`.
- Keep an old key in `JWT_PREVIOUS_SIGNING_KEYS` for at least `JWT_ACCESS_TTL_SECONDS + JWT_CLOCK_SKEW_SECONDS` after the last instance that could sign with that old key has been drained.
- Removing a previous key immediately invalidates every token still signed by that key.

## Key generation

Generate a fresh key as unpadded base64url:

```sh
openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n'
```

Store generated keys in the team secret manager. Do not commit them to the repository.

## Planned rotation

1. Generate a new key and store it in the secret manager.
2. Record the current `JWT_SIGNING_KEY` as the first entry in `JWT_PREVIOUS_SIGNING_KEYS`.
3. Set `JWT_SIGNING_KEY` to the new key.
4. Deploy all API instances.
5. Verify:
   - New `POST /v1/auth/token` responses mint tokens that only validate with the new active key.
   - Existing bearer tokens minted before the deploy still work during the grace window.
6. Wait at least `JWT_ACCESS_TTL_SECONDS + JWT_CLOCK_SKEW_SECONDS` after the last old-key signer is drained.
7. Remove the old key from `JWT_PREVIOUS_SIGNING_KEYS`.
8. Deploy again and confirm tokens signed by the removed key are rejected.

## Emergency rotation

Use this when the current signing key may be compromised.

1. Generate a new key immediately.
2. Set `JWT_SIGNING_KEY` to the new key.
3. Remove the compromised key from `JWT_PREVIOUS_SIGNING_KEYS`. Do not grant it a grace window.
4. Deploy all API instances as fast as possible.
5. Expect every token signed by the compromised key to fail immediately after rollout.
6. If compromise scope is unclear, rotate or revoke affected API keys as well, because bearer requests still depend on live API-key validation.

## Rollback

Use this when the newly deployed signing key or secret distribution is broken, but the old key is still trusted.

1. Restore the last known-good key as `JWT_SIGNING_KEY`.
2. Add the failed new key to `JWT_PREVIOUS_SIGNING_KEYS` if any instances minted tokens with it before rollback.
3. Keep any still-trusted older grace keys in `JWT_PREVIOUS_SIGNING_KEYS` until their windows expire.
4. Deploy the rollback everywhere.
5. Confirm:
   - New tokens are signed with the restored active key.
   - Tokens minted during the failed rollout still verify if their key remains in `JWT_PREVIOUS_SIGNING_KEYS`.
6. After the failed-rollout tokens age out, remove that key from `JWT_PREVIOUS_SIGNING_KEYS` and deploy again.

## Validation checklist

- Server startup fails fast if `JWT_SIGNING_KEY` is missing, duplicated in the previous-key list, malformed, or shorter than 32 bytes after base64url decode.
- Planned rotation keeps old tokens valid only through the explicit grace configuration.
- Emergency rotation removes the compromised key without delay.
- Rollback restores signing deterministically and keeps only the minimum required verification keys configured.
