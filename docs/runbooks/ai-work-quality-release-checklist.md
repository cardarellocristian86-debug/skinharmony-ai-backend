# AI Work Quality release checklist

This checklist is the fixed release ticket architecture. A failed item stops the
release; it is not waived by changing route, tenant, branch or tool.

## Work ticket

- [x] Existing Gallery work searched and joined.
- [x] Architecture/intent digest anchored.
- [x] Branch and protected surfaces recorded.
- [x] Builder, security reviewer and independent verifier assigned.
- [ ] All reviewer blockers resolved.
- [ ] Gallery checkpoint and continuity capsule written.

## Code and security

- [x] Exact-code taxonomy and deterministic classifier.
- [x] Core remains sole `ALLOW` authority.
- [x] Nyra review cannot authorize execution.
- [x] Legacy shadow and quality rollout are isolated.
- [x] Terminal states and state transitions enforced.
- [x] Attempt, proposal digest and Nyra review are bound.
- [x] Recursive secret/raw-chat redaction.
- [x] Tenant/work/presence/lease checks.
- [x] PostgreSQL tenant isolation, CAS and immutable versions.
- [ ] Concurrent idempotency test is green.
- [ ] Real PostgreSQL restart and two-tenant test is green.

## Verification and release

- [ ] Shared, Core MCP, Universal Core and Gallery tests green.
- [ ] Independent verifier verdict `ALLOW`.
- [ ] `git diff --check` green; no secrets/PII in diff.
- [ ] Core one-shot ticket authorizes commit and push.
- [ ] PR required checks: `core-mcp`, `deployment-parity`, `universal-core`.
- [ ] Staging manifest includes rollback target and health probes.
- [ ] Staging observe/write-read/restart tests green.
- [ ] Core release gate authorizes production.
- [ ] Production deploy healthy; live commit matches; rollback race-safe.
- [ ] Gallery work closed with evidence and residual limits.

