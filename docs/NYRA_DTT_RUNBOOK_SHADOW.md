# Nyra DTT shadow runbook

Use this runbook to validate the Dynamic Thought Tree locally without changing the live Nyra V2 rollout.

Prerequisites

- tenant context authenticated
- `CORE_DTT_ENABLED=true`
- `CORE_DTT_MODE=shadow`
- tenant allowlist contains the current tenant
- allowlist and policy versions are present

Expected runtime behavior

- DTT evaluates in parallel with the existing Core path.
- No live verdict is overwritten.
- No Render or external config is changed.
- Any tenant mismatch returns blocked/fail-closed.
- L6 is available only for the explicit allowlisted branches.

Validation checklist

- run unit and contract tests;
- run adversarial/fuzz checks;
- inspect redacted telemetry;
- verify tree depth, node count, pruning, and backtracking stay bounded;
- verify off-mode rollback does not affect Nyra V2.

Rollback

Set:

`CORE_DTT_MODE=off`

This disables DTT without changing the existing V2 mode.

