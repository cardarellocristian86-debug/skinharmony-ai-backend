# Nyra Conversational Work Recovery Architecture V1

## Purpose

This architecture keeps a connected conversational AI able to resume one
canonical Work across sessions without granting ambient execution authority.
It fixes three independent failure classes:

1. transport schema drift between `tools/list` and `tools/call`;
2. unreachable Autopilot recovery and assignment discovery;
3. stale read-only Work projections that omit persisted assignments.

The architecture does not let a model merge, deploy or execute an external
effect by itself. Universal Core remains the decision and authorization
boundary for every consequential action.

## System boundaries

| Boundary | Responsibility | Must not do |
| --- | --- | --- |
| Connected AI | Interpret the owner request, call a bounded tool, return evidence | Invent Work identity, authority or assignment IDs |
| MCP gateway | Authenticate host/tenant, expose allowed tools, validate canonical arguments | Validate calls against a lossy publication-only schema |
| Nyra dialogue | Resume the exact Work, surface checkpoint/next action/assignment | Recreate an existing Work or silently authorize effects |
| Autopilot runtime | Materialize the zero-privilege plan and assignment ledger | Perform the assigned task or issue external-action authority |
| Universal Core | Decide bounded coordination and consequential actions | Infer approval from model output or tool visibility |
| Work Continuity V2 | Own canonical Work, task, verification and closure state | Treat an assignment submission as verified closure by itself |

## Canonical schema invariant

There is one authoritative input schema for every tool call.

1. `tool-definitions.js` and the specialized tool modules define the canonical
   schema.
2. `compactMcpTools()` selects which tools exist on the compact surface. It may
   make large nested payload schemas opaque, but it may not delete valid
   canonical top-level input fields used at call time.
3. `compactPublishedToolDescriptor()` is applied only while serializing
   `tools/list`. It may make nested payload descriptions opaque for connector
   size/compatibility, while preserving every top-level wire field.
4. `tools/call` validates the compact top-level contract. Nested operation
   payloads are deliberately opaque at this layer.
5. The operation-specific handler performs the exact fail-closed nested and
   semantic validation against the canonical contract, durable continuation
   and Work state.

For `nyra_continue`, the common wire fields include `work_id`, logical
presence, owner confirmation and all operation payload objects. A compact
descriptor must never remove them while retaining `additionalProperties:false`.

## End-to-end resume flow

1. The host authenticates through OAuth or its registered bearer principal.
2. The gateway derives tenant, host capability and transport presence.
3. `nyra_converse` resolves one exact canonical Work; it does not create a
   substitute Work when an existing Work ID was requested.
4. The read-only resume path reads:
   - canonical Work V2 state;
   - operational checkpoint state;
   - persisted Autopilot runs and assignments;
   - tenant-visible Gallery count.
5. `buildNyraControlContext()` projects the first dependency-ready offered
   assignment, if one exists.
6. The host receives a bounded dialogue containing the Work binding, current
   next action and assignment availability. No read lease or participant row
   is created by this projection.

If the Autopilot projection is temporarily unavailable, dialogue readback
remains state-pure and fail-closed. The explicit inbox/reconcile route then
returns the actionable runtime error instead of corrupting continuity.

## Autopilot recovery flow

1. The connected AI calls `nyra_autopilot_reconcile` with the exact `work_id`
   and an idempotency key.
2. Host App authorization admits only a registered, tenant-bound Work
   coordinator on the conversational front door.
3. The server rechecks canonical Work ACL.
4. `requireBoundedTenantCoordination()` obtains the dedicated Universal Core
   decision for `work.autopilot.reconcile`.
5. Autopilot deterministically creates or replays the Work plan and
   assignments. It cannot enable Autopilot globally or execute an effect.
6. Nyra refreshes the control context from the materialized assignment state.

Reconciliation is therefore reachable recovery, but never ambient
`work.operate` authority.

## Assignment discovery and execution flow

1. `nyra_work_assignment_inbox` is visible on the conversational surface.
2. With no `work_id`, the server first derives all canonically readable Work
   IDs through Work Continuity V2 ACL and lists only eligible offers inside
   that set. With a `work_id`, it applies the same ACL to that exact Work.
3. The host claims one server-issued assignment using its exact assignment ID.
4. The runtime binds the claim to transport presence, lease, eligible client
   type, Work and idempotency key.
5. The worker performs only the task contract and submits bounded evidence.
6. A producer submission does not complete the Work task.
7. An independent-verifier assignment validates the evidence and projects
   `completed` plus `acceptance_verified` into Work Continuity V2.
8. Nyra reevaluates closure only after all required verifications exist.

## Precommit and external-effect flow

1. A current native plan and verified task state produce a closure evaluation.
2. If closure is not yet complete but precommit requirements are satisfied,
   Nyra calls `nyra_continue` with
   `operation=reconcile_persisted_precommit` and the exact `work_id`.
3. The canonical continuation schema admits the Work and presence fields.
4. The continuation handler binds the request to the durable continuation,
   tenant, Work, owner confirmation and idempotency record.
5. Universal Core may issue an exact, short-lived `git.commit` ticket.
6. Commit, push, PR, merge and Render deploy remain separate effects, each
   requiring its own applicable authorization and host approval.
7. Closure requires live commit, health evidence and effect reconciliation;
   a successful worker call is insufficient.

## Failure and recovery matrix

| Failure | Detection | Recovery | Safety invariant |
| --- | --- | --- | --- |
| Publication descriptor too large | connector/import test | make nested objects opaque at publication only | canonical call schema unchanged |
| Valid continuation fields rejected | compact `tools/call` regression test | preserve canonical top-level fields | handler still validates operation semantics |
| No Autopilot run | inbox empty plus Work pending | bounded reconcile | no external action authority |
| Persisted offer hidden on fresh chat | read-only resume test | read persisted Autopilot projection | SELECT-only, no lease/heartbeat |
| Assignment quarantined | assignment state | exact reissue | same Work/run; immutable source assignment |
| Producer evidence incomplete | verifier contract | independent verification | producer cannot approve itself |
| Precommit not ready | closure projection | continue verified tasks | no retroactive ticket |
| Render/application failure | deploy status, health and logs | rollback or safe successor | Work closes only from verified live evidence |

## Required regression coverage

- Compact catalog contains the recovery and inbox tools expected by the
  conversational host capability.
- Published `nyra_continue` contains all canonical top-level wire fields.
- A compact-mode `tools/call` carrying `work_id` and logical presence reaches
  the handler instead of returning `-32602`.
- Inbox accepts tenant discovery without requiring a pre-known Work ID.
- A read-only resume projects a persisted dependency-ready assignment.
- Reconcile requires exact Work ACL, an idempotency key and the dedicated Core
  coordination decision.
- Producer submission alone cannot mark a task verified.
- Finalization remains impossible without verified closure and live-effect
  evidence.

## Rollout order

1. Merge code and regression tests.
2. Deploy Core MCP only.
3. Verify health and the deployed commit.
4. Reload the ChatGPT connector descriptor.
5. Run `tools/list`, compact continuation call, inbox and reconcile smoke tests.
6. Resume the blocked Work and complete producer/verifier assignments.
7. Reconcile precommit, then execute separately authorized Git and Render
   effects.
8. Record live evidence and close the canonical Work.
