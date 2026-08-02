# Local Codex Gallery continuity

This contract closes the local-action gap in Tenant Work Gallery.

## Scope

It applies to local Codex sessions that use the filesystem, Git, GitHub,
Render, shell or other host tools while working on a tenant repository.

## Required lifecycle

A local session must:

- run tenant-scoped work preflight;
- resolve or resume one existing work identity;
- register signed agent presence with agent_id and session_id;
- load the current checkpoint, handoff, branch and overlap state;
- acquire a bounded lease before writes, Git, PR, merge, Render or deployment;
- obtain the exact Core verdict and host approval required for the operation;
- append redacted start, decision, command, result and failure events;
- release the lease and create a resumable checkpoint.

Read-only inspection may omit the write lease, but the session remains visible
to the tenant work context.

## Failure behavior

If the Gallery or Core is unavailable, the local client may persist only a signed,
redacted outbox event. It must not perform a mutating or release action that can
conflict with another tenant session. Reconciliation is required before the
next mutating action.

## Identity and isolation

The client derives tenant identity from its authenticated SkinHarmony identity.
It must never accept a tenant override from a command argument, environment
shortcut or handoff text. Work state is scoped by tenant_id, project_id,
work_id, branch_id and session_id. Cross-tenant requests fail closed.

## Explicit prohibition

No handoff or local runbook may declare that Gallery registration is unnecessary
because an action uses local filesystem or Render.