# Nyra causal identity release integration — Phase B

Phase B consumes the frozen Phase A handoff digest
`ec112671db4b200b2c74f182e2ed75436a5112f9fe2f8204908bcd795e49afb9`.

Core MCP exposes `project_identity_spine_read`, `release_tuple_resolve` and
`release_tuple_read` through the existing causal dispatcher and verified DTT
agent-context receipt. It never mutates tenant, Project, Genesis, revision,
Work or Change identity.

`work_continuity_closure_evaluate` accepts `release_lookup` only. The MCP server
first asks Universal Core to resolve the exact tuple, verifies the returned
tuple digest and causal binding, translates it to the existing host-native
release-intent contract, then supplies it through a private runtime option.
`evaluateClosure` never reads `input.release`; therefore an MCP caller has no
raw-tuple authority or fallback.

Universal Core constructs its observer only from the production PostgreSQL
pool, server-owned GitHub credential resolver and platform fetch. The observer
uses a bounded tenant/project Project Scope query, independently bound reality
observations, strict GitHub PR/commit/file reads and strict Render `/healthz`
reads. Degraded, partial, stale, redirected, oversized, malformed, cross-tenant,
wrong-project, origin-substituted or rollback-incoherent evidence fails closed.

Gallery remains an outbox projection. `RELEASE_TUPLE_RESOLVED` is evidence and
cannot authorize without the existing Gallery binding verification. The causal
Continuity Capsule includes a bounded `release_tuple_resolutions` page so a new
session can resume the same release identity without chat memory.
