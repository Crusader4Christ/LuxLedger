## Summary

- What changed:
- Why:

## How To Test

1. 

## Risks

- 

## Contract Governance Checklist (Author)

- [ ] I evaluated whether this PR impacts external API contract behavior.
- [ ] If API contract behavior changed, I updated `apps/luxledger-api/openapi/openapi.yaml` in this PR.
- [ ] I ran `bun run contract:verify` locally; it must pass before push.
- [ ] I understand merge is blocked until `OpenAPI Contract Governance` is green.

## Reviewer Checklist (For API Contract-Impacting Changes)

- [ ] Runtime API behavior in changed code is consistent with `apps/luxledger-api/openapi/openapi.yaml`.
- [ ] Request/response/status/error definitions exposed to clients match the OpenAPI contract.
- [ ] CI is green, and `OpenAPI Contract Governance` passed (required, no exceptions).
