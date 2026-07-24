# Nyra DTT rollback runbook

Rollback objective

Disable only the Dynamic Thought Tree while leaving the current Nyra V2 rollout untouched.

Primary rollback

- set `CORE_DTT_MODE=off`
- keep `CORE_DTT_ENABLED` false or true according to your current local policy, but do not rely on it alone

Verification after rollback

- DTT returns off-state results
- the core runtime still computes its normal hierarchy result
- no new tree is opened
- no tenant data is modified
- no external deployment or Render change occurs

Escalation criteria

Stop and ask the owner for a new approval if rollback would require:

- changing live Render variables;
- changing the existing Nyra V2 rollout;
- changing tenant allowlists outside the local repo;
- any destructive operation outside the local workspace.

