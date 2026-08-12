# ADR: authoritative causal identity and release resolution v1

Decision: reuse the existing causal Project aggregate and event ledger, and add
an append-only release resolution projection. Release facts are resolved by a
server-constructed observer from trusted GitHub, Project Scope, Render/Core and
receipt evidence. A client can provide a PR number as a lookup key but cannot
provide an authoritative tuple or fallback.

Alternatives rejected: trusting the closure caller tuple; treating Gallery as
the primary registry; reconstructing missing previous-live or rollback history;
or adding a second Project/Intent registry. Each loses authority, provenance or
legacy honesty.

Consequence: closure evaluation must wait for a fresh complete server-owned
resolution. Missing historic evidence is an explicit failure, never inferred.
