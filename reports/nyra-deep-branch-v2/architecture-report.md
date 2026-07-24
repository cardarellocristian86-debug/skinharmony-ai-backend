# Nyra Deep Branch V2 — Operational Architecture Report

## Record scope

This report records the architecture and acceptance boundaries for making the
Nyra Deep Branch V2 catalog usable from the ChatGPT connector. It describes an
additive operational path; it does not certify a deployment, a configuration
activation, a merge, or a release.

## Decision

The accepted architecture is a Core-governed federation, not a direct
ChatGPT-to-Nyra integration:

```text
OAuth-authenticated ChatGPT
  -> SkinHarmony Core MCP
  -> Universal Core (V1 route, evidence ledger, policy, attestation)
  -> skinharmony-nyra-core (V2 lazy-shard contract evaluator)
  -> Universal Core (bounded decision)
  -> MCP (redacted tool result)
```

Universal Core retains final authority. V2 cannot open branches, change tenant
scope, authorize execution, persist learning, or override a V1 denial.

## Catalog and routing coverage

The V2 implementation is generic over the live catalog rather than a
hard-coded list of demonstrations. The current catalog topology contains:

| Layer | Count | Operational role |
|---|---:|---|
| V1 branch | 18 | Core-governed routing domain |
| L1 subbranch | 239 | Request-selectable V1-compatible specialization |
| L2 specialized capability | 239 | Independently contracted capability |
| L3 micro-capability | 239 | Independently contracted micro decision |
| L4 method / strategy / verifier / metric | 956 | Independently contracted execution checks |
| L2–L4 contracts | 1,434 | Distinct signed/evaluated node contracts |

For every valid selected `branch_id` and `subbranch_id`, the runtime loads the
matching lazy shard and requires its exact six nodes: L2, L3, then the four L4
roles. It does not bulk-run all 1,434 nodes for an ordinary request. This makes
coverage catalog-wide while preserving a bounded request workload.

## Required operational invariants

| Invariant | Enforcement point |
|---|---|
| Live V1 catalog is authoritative | Core route and immutable V2 manifest binding |
| Branch is legitimately open | V1 Core result plus signed envelope allowlist intersection |
| Exact one six-node lineage | Lazy-shard descriptor, parent IDs, role ordering, package hash |
| Per-node independent contract | Existing V2 engine evaluates each L2–L4 node with its own input, evidence, policy, verifier, metric, fallback and tests |
| Evidence is not fabricated | Core source verifier proves each reviewed excerpt against a bounded Core-owned fetch, then the ledger returns opaque records only; missing evidence becomes fallback |
| Core policies remain authoritative | Core policy engine creates an exact `ALLOW`/`DENY` receipt for every required node/policy binding; missing, malformed, expired or denied receipts fail closed |
| Tenant isolation | OAuth ingress, MCP/Core/Nyra allowlists, tenant-bound HMAC references and signed tenant/request bindings |
| Attestation integrity | Short-lived MCP HMAC request attestation plus Core Ed25519 evaluation attestation |
| Memory-first preflight | Core requires tenant-bound recall and `ready_read_only` before operational preparation or evaluation |
| No raw-data transfer to Nyra | Opaque contexts reject raw messages, prompts, source text, URLs and full memory fields |
| Evidence-session availability | Process-local ledger requires preparation and evaluation on the same single Core instance until durable tenant-safe state is introduced |
| No V2 execution authority | Every response retains `execution_authorized=false`; V1/Core remains final authority |
| V1 compatibility | V1 routing and responses remain available on every disabled, rejected or failed V2 path |

## Evidence and attestation sequence

1. The MCP accepts `nyra_v2_requirements` only from an authenticated,
   allowlisted OAuth tenant. Core runs V1 routing and memory-first preflight,
   then returns the exact opaque requirement bindings for one selected shard.
2. The MCP accepts `nyra_v2_evidence_prepare` with those bindings, bounded
   reviewed sources and claims. Each source includes a reviewed excerpt; no
   raw evidence is permitted in the later evaluation call.
3. MCP assigns a request ID and creates a 60-second signed request
   attestation. The binding includes tenant, operation, branch, subbranch,
   evidence-pack hash, nonce and issue time.
4. Core verifies the MCP attestation before accepting the V2 operation. Its
   source verifier retrieves each public HTTPS source under bounded timeout,
   size, type and redirect rules. It rejects any DNS answer set containing a
   non-public address and pins the connection to a validated address while
   retaining hostname TLS verification, proves the reviewed excerpt occurs in
   the fetched bytes, and stores only short-lived digest source receipts. Core then
   turns qualified evidence into tenant/request-scoped opaque references and
   returns validation counts rather than raw material.
5. `nyra_v2_evaluate` sends only those opaque references back through MCP.
   Core requires a recalled, tenant-bound `ready_read_only` preflight and a
   V1-opened selected branch.
6. Core loads the selected V2 shard and constructs six opaque node contexts.
   For each required node/policy binding, the actual Core policy engine writes
   a scope- and expiry-bound `ALLOW` or `DENY` receipt. Core binds the receipt
   snapshot, policy hash, catalog/root/function registry/package hashes,
   branch/subbranch, preflight, ordered lineage and context digests in a
   short-lived Ed25519 attestation.
7. Nyra verifies the transport envelope, Core key ID and public signature,
   attestation time, tenant, Core-opened branch, shard and all lineage/context
   bindings, including exact Core policy-receipt coverage. It then runs its
   existing per-node contract evaluation.
8. The response is projected to a compact advisory lineage. MCP does not
   expose raw evidence, static contracts, opaque payloads or remote response
   extras.

## Failure decision table

| Failure or non-activation | V2 state | Authoritative result |
|---|---|---|
| V2 feature flag disabled | `disabled_v1_authoritative` | V1 bridge |
| Tenant/branch/key not allowlisted | bounded disabled or fallback state | V1 bridge |
| MCP request signature invalid, expired or replayed | rejected before V2 work | V1 bridge |
| Memory recall or read-only preflight unavailable | advisory fallback | V1 bridge |
| Evidence absent, invalid, stale, source-unverified or insufficient | advisory fallback | V1 bridge |
| Core policy receipt missing, malformed, expired, denied or review-required | advisory fallback | Core policy / V1 bridge |
| Requested branch not V1-opened | advisory fallback | V1 bridge |
| Attestation/shard/catalog/root/function mismatch | advisory fallback | V1 bridge |
| Evidence session lost, expired or routed to a different Core process | advisory fallback | V1 bridge |
| Nyra timeout or circuit open | advisory fallback | V1 bridge |
| Any proposed execution | not permitted by V2 | Universal Core action authorization only |

## Redaction boundary

The requirements endpoint returns bindings only; the evidence preparation
endpoint is deliberately the only flow that handles reviewed source URLs,
excerpts and claim text. Core derives opaque references with a Core-only keyed
function and stores no such raw fields in the V2 routing envelope. The source
verifier never returns or stores a fetched response body: it retains only
digest receipts and expiry metadata. The evaluation endpoint accepts only
branch/subbranch identifiers and references returned by preparation.

The Nyra federation checks canonical byte encoding, payload hashes, field
allowlists, maximum context sizes and forbidden raw-data keys. It returns only
bounded state, ID, lineage role, confidence, fallback and reason-code fields.
Audit events use IDs, hashes, counts and states rather than raw source or user
content.

## Acceptance evidence required before release

The following checks are release evidence, not a substitute for the Core
release gate:

- full catalog and contract validation for all 1,434 L2–L4 nodes;
- lazy-shard integrity and exact six-node lineage tests across the supported
  catalog;
- positive evaluated lineage with Core-signed evidence/policy contexts;
- requirements → prepare-evidence → evaluate handoff, including memory-first
  preflight and source-receipt success/failure tests;
- missing-evidence, parent-failure, lost-session and policy-receipt-denial
  fallback tests;
- altered signature, nonce replay, TTL expiry, key mismatch and catalog/root/
  function/shard mismatch tests;
- cross-tenant, cross-branch and cross-subbranch isolation tests;
- MCP raw-cache bypass and response-redaction tests;
- V1 regression test with V2 disabled and with federation failure;
- Core-policy and action-authorization checks proving no V2 execution path;
- performance benchmark for bounded lazy-shard routing and evaluation;
- rollback rehearsal that restores the normal V1 Core bridge.

## Controlled rollout and rollback

The safe release sequence is disabled → shadow → advisory. The repository
blueprints keep all V2 gates disabled; this report does not authorize a deploy
or configuration change. Before any release action, Universal Core must return
`ALLOW` for that exact deploy/configuration action and the owner must explicitly
confirm the scoped rollout. Only then may code be released with all V2 gates
still disabled. Shadow validation is tenant-scoped and read-only; V1 stays
authoritative. Advisory activation requires matching MCP, Core and Nyra gates,
signed-key material, expected immutable bindings, source-verifier egress,
single-instance ledger availability, and explicit tenant/branch allowlists.
MCP activation is last.

The rollback sequence is the inverse and does not require a code rollback:

1. Disable MCP V2 evaluation to close the ChatGPT entrypoint.
2. Disable Core operational evaluation to return V1 with a bounded V2 fallback.
3. Disable Nyra operational and federation gates if needed.
4. Confirm V1 response continuity, `execution_authorized=false`, and tenant
   isolation.
5. Preserve audit-safe release and rollback evidence for Core review.

Deploy, service configuration, and any transition to advisory mode remain
separate reversible actions. They require a Core `ALLOW` for the exact action
and explicit owner confirmation.
