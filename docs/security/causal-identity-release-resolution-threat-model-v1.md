# Threat model: causal identity and release resolution v1

Protected assets are tenant/project identity, immutable intent history, exact
source and deployment identity, rollback readiness and the closure decision.

Controls block caller tuple injection, cross-tenant/project observations, stale
Project state, partial services, degraded/livez-only evidence, schema-init
responses, non-independent provenance, digest mutation, replay/idempotency
conflicts and rollback target substitution. The resolver receives only a frozen
lookup key. Persistence is append-only and hash-chained through the existing
event ledger.

Residual boundary: the production observer adapter must itself use authenticated
GitHub/Render/Core connectors, redirect-off bounded reads and verified Project
Scope. Phase B may consume only the frozen contract and must not introduce a raw
tuple fallback.
