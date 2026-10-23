---
name: cto
description: Refine a LuxLedger issue or feature request into an implementation-ready plan grounded in the repository. Use for task refinement and technical planning.
---

# Refine an engineering issue

Turn the requested outcome into a plan that another developer can implement and verify. Preserve the user's scope and decisions; follow the applicable `AGENTS.md`. Repository paths below are relative to the repository root.

Optional [workflow helpers](../../references/workflow-helpers.md) collect Git context and run checks
with compact output. Read that reference only when using a helper; reuse established scope and gates.

## Gather the necessary evidence

- Use the supplied request or issue text. If an issue ID or URL is supplied, read its current description and relevant discussion through the available Linear tools. If unavailable, work from supplied facts and identify the missing context; never invent issue contents.
- Inspect affected implementation, callers, and existing tests. Cite concrete paths or symbols for implementation decisions; distinguish current behavior from proposed behavior.
- For ledger behavior, consult the relevant sections of `docs/product/invariants.md` and corresponding code/tests. For HTTP changes, inspect `packages/http/src/contracts`, `packages/http/openapi/openapi.yaml`, and `docs/governance/openapi-contract-governance.md`. Read only material needed for the task.

## Produce the plan

Include these elements, with detail proportional to the task:

- **Problem and scope:** desired behavior, current gap, and any material exclusions.
- **Approach:** affected packages and verified code locations, the smallest compatible change, and decisions that affect the public contract or stored data. Address migration or compatibility implications when relevant.
- **Acceptance criteria:** observable outcomes with stable labels such as AC1, AC2. Separate requirements from proposals and unresolved decisions.
- **Test matrix:** map criteria to success, rejection, and relevant boundary scenarios. For state changes, consider rollback, tenant isolation, identical retries versus conflicting payloads, and concurrency where it can affect correctness. Name existing test locations or the appropriate test layer.
- **Open questions:** ask only for choices that materially affect correctness or scope. State reversible assumptions and keep progressing on the settled parts. Do not call the plan implementation-ready while a blocking decision remains.

Respect existing package boundaries: core and HTTP are framework-agnostic; Fastify and Express have separate adapters; the reference host application lives in another repository. Only specify authentication decisions such as TTL when authentication is in scope and the existing contract has been checked.

## Deliver or publish

Return the plan in the response unless the user has authorized a Linear update or comment. Honor authorization already given in the conversation without asking again. Before an authorized update, reread the target issue, preserve unrelated requirements and context, and update only the intended content. Report the issue link and the actual result; never imply publication if the write failed. Refinement alone does not authorize changing code or issue status.
