# Nyra Core — Terminal Reconciliation and Dialogue Recovery

Date: 2026-09-08

## Outcome

Nyra Core now keeps read-only dialogue separate from effects, accepts connected-AI intent proposals only after deterministic server validation, and exposes a callable typed `nyra_continue` contract to ChatGPT Apps.

The Work lifecycle repair adds three bounded mechanisms:

- append-only supersession of a stale native precommit gate, restricted to plan, evaluation, supersession, or V2-scope drift and denied when any active claim or ticket exists;
- server-derived revalidation of an already accepted V2 task when a legacy pre-snapshot gate would otherwise deadlock the Work. Revalidation is limited to the same `software_git` Work, exact task digest, current planned descendant, and stale-gate lineage; its immutable material is persisted and digest-bound so report replay remains valid after gate supersession;
- server-owned terminal reconciliation of legacy generic evidence after immutable live finalization, including a verified append-only predecessor chain;
- reviewed `parent_work_id` support so an additional implementation can become a linked child Work instead of being rejected as a duplicate.

No runtime storage artifact is part of the release.

## Verification

- Core MCP full suite: 1,135 tests; 1,124 passed, zero failures; 11 PostgreSQL integration cases are environment-gated locally.
- Universal Core full suite: passed.
- Targeted reconciliation, gate, transaction, Apps schema, and governance suites: passed; the completed-task revalidation path is covered through binding, reports, gate supersession, and exact replay.
- Independent security review: no remaining High or Medium finding.
- GitHub pull request 502: all required checks passed.
- Merge commit: `25f56f1470be72f8ebea9140aeee258f9c32ff63`.
- Render Core deployment: `dep-dag4t6942hec7395d5j0`, live.
- Render Universal Core deployment: `dep-dag4t6f40ujc73ean4s0`, live.
- Render Nyra reconciliation deployment: `dep-dag4ukohchos73ft3rng`, live.
- Core, Universal Core, and Nyra health endpoints: HTTP 200 after signer reconciliation.

## Closure rule

The remaining operational Work must be completed only after a fresh native plan, distinct builder and verifier reports, a Core-issued action ticket for this exact report commit, successful pull-request checks, deployment readback, native final receipt, Generic Core Join, and generic closure receipt. Archival alone is not accepted as completion.

The revalidation bootstrap itself does not waive that rule: it only restores the governed path from the frozen legacy gate. The final report change and Work closure still require a new exact Core ticket and live verification.
