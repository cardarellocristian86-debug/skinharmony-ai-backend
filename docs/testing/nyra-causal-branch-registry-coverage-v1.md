# Nyra causal Branch Registry coverage v1

## Scope and method

Coverage is computed from the repository's authoritative `deterministicBranchRegistry()` and the common `extendCausalBranchRegistry()` wrapper. It does not enumerate or patch branches manually. The executable regression is `services/universal-core-service/test/causal-branch-registry-coverage.test.js`.

Baseline readback on the mission branch:

- registered logical branches: 72;
- branches wrapped by the causal contract: 72;
- branches missing `requires_causal_context`: 0;
- branches missing `context_schema_version`: 0;
- context schema: `causal_context_envelope_v1`;
- allowed environment union: `production`, `shadow`, `staging`;
- canonical registry digest: `c01a0f659a048d175758f9273123f7ba52b2835ec32aae6707f41d10a8632656`.

## Shared enforcement

Every registered branch receives the same immutable identity fields, Project State digest, Work/Change/Obligation binding, inherited constraints, authority scope and required observer contract through the common dispatcher. Governed outputs require both the static branch permission and the matching dynamic envelope scope. Independent observers require externally verified receipt, readback and identity binding; caller-provided independence flags do not authorize closure.

In `SHADOW`, missing or invalid causal context is measured but legacy work is not blocked. `ENFORCE_NEW_WORK` and `ENFORCE_ALL_COMPATIBLE` require both structural branch validation and Universal Core verification of the signed envelope plus DTT agent receipt. The feature flag is tenant/project scoped, versioned and reversible.

## Release readback

This document is pre-release evidence only. The final proof package must replace or supplement it with the production Branch Registry count/digest, rollout mode and a signed-envelope branch invocation readback from the exact deployed commit.
