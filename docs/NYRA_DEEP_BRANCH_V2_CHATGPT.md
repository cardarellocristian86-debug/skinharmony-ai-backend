# Nyra Deep Branch V2 for ChatGPT

## Purpose and boundary

Nyra Deep Branch V2 adds a bounded, evidence-aware advisory evaluation to the
existing SkinHarmony ChatGPT connector. It does not replace V1 routing and it
does not grant execution authority. Universal Core remains the authority for
tenant identity, branch opening, policy, action authorization and the final
answer state.

This document describes the operational design and the release controls. It
does not state that a deployment, configuration activation, merge, or release
has occurred.

## Request path

```text
ChatGPT (OAuth identity)
  -> SkinHarmony Core MCP
       -> Universal Core V1 bridge and Deep V2 evidence/attestation services
            -> skinharmony-nyra-core Deep V2 federation runtime
       <- compact, redacted advisory result
  <- compact tool result
```

Nyra is never called directly by ChatGPT. The MCP server is the only ChatGPT
surface, and Universal Core is the only service that can open a branch or send
an evaluation attestation to Nyra.

## Catalog coverage and evaluation unit

The live V1 catalog remains the source of truth. The V2 catalog currently
contains 18 branches and 239 V1-compatible Level-1 subbranches. It provides a
distinct contract for each of the 1,434 Level-2 through Level-4 nodes:

- 239 specialized capabilities at L2;
- 239 micro-capabilities at L3;
- 956 L4 primitives: method, strategy, verifier, and metric.

All catalog branches and subbranches are supported through the same guarded
route. A single request does **not** run the complete catalog. After Core has
opened a requested branch, it resolves exactly one selected subbranch and its
six-node lineage:

```text
L2 specialized capability
  -> L3 micro-capability
       -> L4 method
       -> L4 strategy
       -> L4 verifier
       -> L4 metric
```

The lineage must match the immutable lazy shard, catalog fingerprint, root
binding, function-registry hash and shard package hash. A request cannot use a
synthetic, shortened, reordered, cross-branch, or duplicated lineage.

## ChatGPT workflow

`nyra_v2_preview` is an optional read-only topology preview. It can expose only
Core-opened and allowlisted V2 branches, and cannot claim that a node was
evaluated.

For a real V2 evaluation, ChatGPT uses this explicit three-call flow:

1. Call `nyra_v2_requirements` with one `branch_id` and one `subbranch_id`.
   Core resolves the exact shard and returns only the bounded requirement
   bindings needed for that lineage; it does not evaluate a node yet.
2. Call `nyra_v2_evidence_prepare` with the same branch/subbranch, reviewed
   sources and claims, and the requirement bindings returned in step 1. Each
   source includes a bounded reviewed excerpt. Core validates the MCP
   attestation, verifies the evidence and returns only opaque `evidence_refs`
   plus aggregate validation counts.
3. Call `nyra_v2_evaluate` with the same branch/subbranch and only the returned
   opaque references. It does not accept a raw node payload, message, memory,
   source document, URL, claim text, contract, or capability override.
4. On every call, Core performs its normal V1 bridge and memory-first
   preflight. Evaluation proceeds only if V1 has opened the selected branch,
   preflight is tenant-bound and `ready_read_only`, and the required memory
   recall succeeded. MCP passes recall context only to Core; it is never copied
   into the Nyra federation payload.
5. Core derives the exact six-node shard lineage, creates opaque per-node
   context envelopes, issues actual Core policy receipts for the required
   node/policy bindings, signs the full evaluation attestation with an Ed25519
   Core key, and sends it through the authenticated Core-to-Nyra federation.
6. Nyra verifies both the bounded transport envelope and the Core signature,
   validates each node’s independent contract and the exact policy receipt
   coverage, and returns compact `advisory_verified` or `advisory_fallback`
   node states. The MCP response exposes IDs, levels, states, confidence where
   available, and bounded reason codes only.

The MCP signs its request to Core with a short-lived, request-bound HMAC
attestation. It binds tenant, request ID, operation, branch/subbranch,
evidence references, nonce and issue time. Core rejects malformed, stale,
replayed, cross-tenant, or altered requests.

## Authority and evidence model

Universal Core owns the evidence intake and policy decisions. Raw source
details and claim text are used there to derive tenant-scoped, domain-separated
opaque references. Nyra receives only bounded opaque node contexts necessary to
run its existing contract engine.

Before Core accepts a source as V2 evidence, its source verifier performs a
bounded Core-owned retrieval. It accepts only a public HTTPS origin with no
credentials or redirect, a supported text/JSON/XML response, a bounded response
size and timeout, and an exact reviewed excerpt found in the retrieved bytes.
Core resolves every hostname before transport, rejects the whole answer set if
any address is non-public, and connects to a validated numeric address with
the original hostname retained for TLS verification; this prevents DNS rebinding
from reaching an internal service.
Core records a short-lived source receipt containing only source, URL, content
and excerpt digests with timestamps. The fetched body is neither returned nor
persisted in the V2 ledger. A failed retrieval, content-type check, excerpt
match or expired receipt is an evidence rejection and falls back to V1.

Core runs its policy engine for every required node/policy binding in the
selected lineage. It persists a tenant-, request-, branch-, subbranch-,
preflight- and expiry-bound `ALLOW` or `DENY` receipt, then provides the exact
receipt snapshot to the attester. Nyra does not accept a caller-provided policy
boolean or a copied contract as authorization: a missing, malformed, expired or
denied Core receipt fails closed for the affected node.

The Core attestation binds:

- tenant, request, domain pack and valid preflight;
- Core policy hash, exact per-node policy receipt coverage, and the
  authenticated Core-to-Nyra envelope;
- selected branch and subbranch, which must already be Core-opened;
- catalog, root binding, function registry and lazy-shard package hashes;
- the ordered L2 → L3 → four-L4 lineage;
- one opaque evidence/policy/capability context for every lineage node;
- issued/expiry times, nonce, key ID and Ed25519 signature.

Nyra validates the signature with an allowlisted public key, accepts only the
configured tenant/key pair, and rejects expired or replayed attestations. The
evaluated result is advisory only: `execution_authorized` is always `false`.
Only a separate Universal Core authorization can permit a real external action.

## Tenant isolation and redaction

- OAuth establishes the tenant at MCP ingress; clients cannot supply a tenant
  in a V2 tool argument.
- MCP, Core and Nyra each maintain independent explicit tenant allowlists.
- Evidence references are tenant/request/branch/subbranch scoped and are
  derived with a Core-only keyed function.
- Attestations bind the tenant, request, branch and preflight. A changed value
  invalidates the signature or envelope binding.
- Nyra rejects raw-message, prompt, source-text, URL, full-memory and similar
  fields in opaque node contexts.
- MCP returns bounded summaries rather than raw Core or Nyra responses. Cached
  V1 detail retrieval is not a V2 bypass.
- The evidence session is short-lived and scoped to one tenant, branch and
  subbranch. The current ledger is process-local, so preparation and evaluation
  must reach the same single Core instance until a tenant-safe durable ledger
  and affinity/lease design has passed review.

## Fail-closed behavior and V1 compatibility

V1 remains the authoritative answer whenever V2 is disabled, unavailable, or
cannot prove its required bindings. The following conditions produce a compact
V2 fallback and retain the V1 bridge result:

| Condition | Result |
|---|---|
| MCP/Core/Nyra gate disabled or tenant not allowlisted | `disabled_v1_authoritative` |
| Memory-first preflight missing or not `ready_read_only` | advisory fallback; V1 remains authoritative |
| Missing, insufficient, stale, contradictory, source-unverified or policy-denied evidence | advisory fallback; V1 remains authoritative |
| V1 did not open the requested branch | advisory fallback; no Nyra evaluation |
| Missing, malformed, expired or denied Core node-policy receipt | advisory fallback; no trusted node state |
| Bad, expired, replayed, cross-tenant or tampered attestation | advisory fallback; no trusted node state |
| Catalog/root/function/shard/lineage mismatch | advisory fallback; no trusted node state |
| Evidence session unavailable on the Core instance or expired | advisory fallback; V1 result is returned |
| Federation timeout, circuit-open response, or unavailable Nyra | advisory fallback; V1 result is returned |

No V2 path changes V1 branch IDs, V1 subbranch IDs, V1 routing semantics or
the existing execution prohibition.

## Feature-gated rollout

All gates are fail-closed. Secrets are supplied through the deployment secret
manager and never through ChatGPT, MCP tool arguments, source files, or
documentation.

| Stage | Effective behavior | Required gates |
|---|---|---|
| Disabled | V1 only; V2 tools return a bounded disabled state. | All V2 enable flags `false`. |
| Shadow | Read-only topology/attestation observations may be compared with V1; V1 is returned. | Core/Nyra federation enabled for a narrow allowlist; operational evaluation remains non-authoritative. |
| Advisory | A valid selected lineage may return compact advisory node states; execution remains false. | MCP evaluate gate, Core operational gate, Nyra operational gate, matching keys, source-verifier egress, single-instance ledger availability, and explicit tenant/branch allowlists. |

The main controls are:

- MCP: `MCP_NYRA_DEEP_BRANCH_V2_PREVIEW_ENABLED`,
  `MCP_NYRA_DEEP_BRANCH_V2_EVALUATE_ENABLED`, respective tenant/OAuth gates,
  and `MCP_NYRA_DEEP_BRANCH_V2_REQUEST_SIGNING_SECRET`.
- Core: `CORE_NYRA_DEEP_BRANCH_V2_ENABLED`,
  `CORE_NYRA_DEEP_BRANCH_V2_MODE`,
  `CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED`,
  `CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_MODE`, tenant/branch
  allowlists, expected catalog/root bindings, Core signing material, and the
  MCP request-verification secret. Source verification is bounded by
  `CORE_NYRA_DEEP_BRANCH_V2_SOURCE_FETCH_TIMEOUT_MS` and
  `CORE_NYRA_DEEP_BRANCH_V2_SOURCE_MAX_BYTES`.
- Nyra: `NYRA_DEEP_BRANCH_V2_FEDERATION_ENABLED`,
  `NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED`, federation and
  operational tenant allowlists, Core attestation key-ID allowlist, and Core
  public-key map.

The repository blueprints deliberately leave every V2 feature flag `false`.
No deployment or configuration transition is implied by this design. A release
may be proposed only after the exact deploy/configuration action has a Core
`ALLOW`, the owner explicitly confirms its scope, and the evidence below is
attached to the release gate. The future sequence is: deploy code with V2
disabled; validate signatures, source receipts, memory-first preflight and
tenant isolation in shadow mode; then enable advisory evaluation in Core and
Nyra before enabling the MCP entrypoint last. No stage grants execution.

## Verification and rollback

The release gate requires evidence for unit, integration, regression, tenant
isolation, fallback, adversarial, deep-routing, Core-policy, learning-safety,
and performance checks. The operational test set includes a verified six-node
lineage plus requirements-to-evidence-to-evaluate handoff, source-receipt
success/failure, memory-preflight failure, stale/replayed/tampered attestation,
cross-tenant, Core-policy-denied, parent-failure, raw-output-redaction and V1
regression cases.

Rollback is intentionally narrow and reversible:

1. Disable MCP evaluation first to stop new ChatGPT V2 requests.
2. Disable Core operational evaluation so the Core bridge returns V1 plus a
   bounded fallback.
3. Disable Nyra operational/federation flags if isolation is required.
4. Verify `execution_authorized=false`, tenant isolation, and the unchanged V1
   bridge response.
5. Retain only audit-safe hashes, counts and rollback evidence; do not copy raw
   evidence into Nyra or logs.

No deployment or configuration change is part of this document. Those actions
remain behind the Universal Core release gate and explicit owner confirmation.
