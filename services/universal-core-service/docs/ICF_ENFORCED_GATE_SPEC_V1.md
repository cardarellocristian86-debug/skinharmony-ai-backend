# ICF Enforced Gate Specification v1

## Scope

This specification defines the minimum deterministic gates required before Nyra ICF may run in `enforced` mode. Probabilistic confidence, LLM summaries, green tasks, timeouts, stale evidence, and `UNKNOWN` observations never authorize closure or execution.

## Obligation conservation

For every obligation `o` in plan revision `r`, exactly one accounting disposition MUST exist:

`SATISFIED | REFINED | TRANSFERRED | WAIVED_AUTHORIZED`

Refinement is valid only when the semantic predicate is preserved and every child scope is contained by the parent scope. Deletion is not a valid disposition.

## Evidence contract

Evidence MUST bind `work_id`, covenant version, obligation/cell, target, input digest, source, verifier, observation time, expiry and correlation. Positive evidence requires authoritative source, independent verification, fresh snapshot and `TRUE` reality state. `FALSE`, `UNKNOWN`, `STALE`, `CONFLICTING` and `UNOBSERVABLE` block the affected gate.

## Local and global joins

Local validity:

`L = dependencies ∧ preconditions ∧ valid_warrant ∧ scope_match ∧ evidence_contract ∧ reality_TRUE ∧ no_blocking_residual`

Global validity MUST recompute from the sealed Covenant, obligation root, evidence root, event-ledger head, anti-goals, invariants, residuals and fresh reality snapshot:

`G = outcomes_TRUE ∧ invariants_TRUE ∧ anti_goals_FALSE ∧ obligations_accounted ∧ no_blocking_residual ∧ snapshot_fresh ∧ policy_match`

Closure requires `L ∧ G ∧ no_open_obligation ∧ no_unobservable_claim`.

## Policy proof

Policy proofs MUST be signed, time-bounded, nonce-unique and bound to tenant, Work, Covenant, obligation, cell, verb, target and input digest. Missing, expired, conflicting or unverifiable proofs fail closed.

## CoreSeal

CoreSeal signs the canonical tuple of Work Identity, Covenant hash, obligation/evidence roots, ledger head, policy hash, snapshot hash, waivers and decision. It certifies protocol completion relative to the declared snapshot; it is not an assertion of absolute truth.

## Enforced readiness

`enforcement_allowed` MAY be true only when the mode is `enforced`, the authoritative store is PostgreSQL, restart durability and distributed consistency are verified, policy proof is ready, the end-to-end proof suite has passed, the independent global join is ready, and `ICF_CORESEAL_SECRET` is configured.

Recommended configuration names:

```text
ICF_POLICY_PROOF_MODE=required
ICF_POLICY_MAX_AGE_SECONDS=300
ICF_POLICY_CLOCK_SKEW_SECONDS=30
ICF_POLICY_FAIL_CLOSED=true
ICF_PROOF_E2E_REQUIRED=true
ICF_PROOF_E2E_POSTGRES_REQUIRED=true
ICF_GENERIC_WORK_CORE_JOIN=true
ICF_GLOBAL_JOIN_FAIL_CLOSED=true
ICF_GLOBAL_JOIN_REQUIRE_CORESEAL=true
ICF_GLOBAL_JOIN_REQUIRE_FRESH_SNAPSHOT=true
```

These variables are specifications only until the corresponding registry, verifier, coordinator and production keys exist. They MUST NOT be enabled as a substitute for those components.
