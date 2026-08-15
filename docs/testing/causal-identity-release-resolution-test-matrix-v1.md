# Test matrix: causal identity and release resolution v1

Phase A tests cover deterministic identity-spine reconstruction, immutable
Genesis behavior, purpose-change derived Project enforcement, lookup-only
observer input, caller-field non-authority, exact causal binding, stale Project
state before observation, cross-project evidence, stale/degraded/partial
evidence, rollback mismatch, deterministic tuple digest, idempotent persistence,
exact index definition, composite tenant foreign keys, append-only guard and
PostgreSQL apply/down/reapply.

Phase B must add MCP schema/route tests, common-context propagation, Gallery
projection orphan/cross-tenant/replay tests, Capsule resume reconstruction and a
negative test proving closure has no raw caller tuple fallback.
