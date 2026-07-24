# Governed Dynamic Thought Tree

This repository now contains a local implementation of a governed Dynamic Thought Tree for Nyra and Universal Core.

The design keeps two layers separate:

- a fixed cognitive branch network, which is the stable Nyra catalog;
- a request-scoped Dynamic Thought Tree, which is created for one request, scored, pruned, possibly backtracked, and then discarded.

The implementation is intentionally fail-closed.

If tenant authorization, policy version, depth policy, provenance, or budget checks do not pass, the tree does not open. Universal Core remains the final authority and the DTT never authorizes side effects on its own.

Local runtime integration

- `services/universal-core-service/src/dtt/governedDynamicThoughtTree.js`
- `services/universal-core-service/src/coreOperationalRuntime.js`
- `services/universal-core-service/test/governed-dynamic-thought-tree.test.js`

Configuration

- `CORE_DTT_ENABLED`
- `CORE_DTT_MODE`
- `CORE_DTT_DEFAULT_DEPTH`
- `CORE_DTT_MAX_DEPTH_CAP`
- `CORE_DTT_L6_ALLOWLIST`
- `CORE_DTT_MAX_CHILDREN`
- `CORE_DTT_BEAM_WIDTH`
- `CORE_DTT_MAX_NODES`
- `CORE_DTT_TENANT_ALLOWLIST`

The local implementation supports `off`, `shadow`, `canary`, and `active` modes, but the requested rollout is kept independent from the existing Nyra V2 rollout. Shadow DTT is the safe default.

Guaranteed behavior in this implementation

- bounded tree growth;
- max 3 children per node;
- beam width capped at 3;
- max 64 evaluated nodes per tree;
- depth default 4 with cap 6;
- tenant isolation;
- redacted output only;
- no private reasoning persistence;
- no automatic promotion to permanent branches or policy;
- explicit rollback by disabling DTT mode.

