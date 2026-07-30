# Governed Continuity Fabric v1

## Purpose

The Governed Continuity Fabric lets Nyra and Universal Core continue a
tenant's bounded work across chats, deployments and recoveries without asking
the owner to restate the original request or making every specialist scan the
whole repository again. It is an operational memory and release-governance
contract, not a provider-agent runtime.

The fabric is used by SkinHarmony first and is intentionally tenant-scoped so
the same control plane can serve future tenants without mixing their work,
credentials, prompts or release evidence.

## Authority boundary

| Concern | Authority | What it may do | What it may not do |
| --- | --- | --- | --- |
| ChatGPT/Codex host | Native host policy | Materialize native child agents and enforce its own command approvals | Be bypassed by Nyra, Core, a ticket or God Mode |
| Nyra | Coordinator and supervisor | Interpret the anchored request, build a bounded plan, inspect evidence, request correction and maintain the Work Atlas | Mint delegations, approve itself or issue a release ticket |
| Universal Core | Final policy authority | Validate tenant scope, budgets, Core plans, delegated authority, tickets, readback and closure receipts | Spawn provider agents or execute a host action by itself |
| Native specialist | Builder, verifier, researcher or reviewer | Work only within the bound task and report evidence through its own host session | Expand scope, approve its own output, create a delegation or issue a ticket |
| GitHub/Render | External systems of record | Supply commit, check, deployment, health and rollback readback | Accept a caller-supplied claim as trusted evidence |

`host_native_only` means native ChatGPT/Codex work. The fabric does not create
agents through an OpenAI API key, Responses API, provider vault or hidden
provider fallback. Its plans declare `provider_execution: false`,
`provider_api_key_required: false`, and `server_model_calls: 0`.

## Durable work identity

The first host-supplied request for a session is normalized, redacted and
stored as an immutable **Intent Anchor**. Its digest is the identity of the
original request for later planning and release binding.

```
tenant + project + host session
        |
        v
immutable Intent Anchor --digest--> Work Identity
        |                              |
        |                              +--> append-only event chain
        |                              +--> architecture versions
        |                              +--> checkpoints / incidents
        |                              +--> Work Atlas index
        |                              +--> bounded native plans
        |                              +--> Core join and closure receipts
        v
redacted initial message, objective, criteria and constraints
```

The anchor is not silently replaced on resume. A same-session retry with the
same request is idempotent; a changed request is rejected unless an explicitly
trusted, short host follow-up is resuming the existing identity. The tenant
work catalog deliberately returns compact operational metadata, not raw
prompts, reports, credentials or customer content.

### Minimum identity fields

- Tenant ID, project ID and host session ID.
- Initial message, idea and objective after redaction.
- Acceptance criteria and constraints.
- Immutable `intent_digest` and deterministic create-request digest.
- Optional repository, policy and live-state hashes used for drift detection.

The database stores the anchor through an immutable PostgreSQL table and
trigger. Event rows are hash chained and append-only. This makes a restart or
chat change a resume operation, not a prompt reconstruction exercise.

## Horizontal work map

The Work Atlas is the shared index for a work and, where appropriate, for a
tenant project across works. It stores only bounded code topology and redacted
summaries:

- nodes: files, components, symbols or dependencies with a content digest;
- typed edges: dependency and impact relationships;
- revisions, source hash and context-byte count;
- source-work provenance for cross-work aggregate selections;
- seeds and bounded recursive change-cone depth.

Nyra uses an Atlas selection before delegating. A specialist receives the
smallest relevant change cone rather than a full repository dump. Atlas reads
are bounded by depth, node count and context bytes. If a project or seed is not
indexed, the result says `discovery_required`; it never invents coverage.

An operational checkpoint records the next action, safe evidence references,
tests, rollback preparation and state hashes. An incident record is keyed by a
deterministic fingerprint, is tenant/project/work scoped, redacts raw error
text, and points to the next bounded recovery action. This is the recovery
index to consult when a known failure reappears.

## Native multi-agent protocol

The coordinator first obtains a bounded Core work plan tied to the Intent
Anchor. It may contain at most three specialists and at most two concurrently
active specialists. A release-relevant plan must have exactly one builder and
an independent verifier.

```
Intent Anchor
  -> Core work-plan validation
  -> Nyra native plan (max 3 tasks / max 2 parallel)
  -> host materializes real ChatGPT/Codex children
  -> one-task signed assignment capability
  -> child evidence from its transport-bound session
  -> independent verifier verdict
  -> local closure evaluation
  -> Core join verdict and exact release ticket
```

Every task declares an ID, role, instruction, dependencies, task digest and
required flag. The host binds a real child to exactly one task, a host task
reference, a lease and an assignment capability. A coordinator cannot submit a
child report. A reused child session, expired lease, missing dependency,
self-approval, provider credential or scope mismatch fails closed and becomes
an indexed blocker with a fresh bounded next action.

Planning does not count as spawning: the host must actually materialize the
native child. The child does not receive delegation authority and cannot turn a
successful tool call into a release decision.

## Verification and closure

The verifier must be independent of the builder both by agent identity and
transport-bound session. It submits an explicit approved/rejected verdict,
test/evidence references and acceptance evidence whose criterion digests come
from the immutable Intent Anchor.

Local closure checks all required task bindings, reports, independent
verification, acceptance evidence, required checks and release intent. A
passing local evaluation is **not** an external release. It only produces
material for a Core join.

For a real external change, Universal Core issues a one-shot, tenant-bound
release verdict and an exact action ticket. The ticket binds at least:

- work ID and intent digest;
- repository, protected base branch and changed-file digest;
- expected commit/tree and required-checks policy digest;
- builder/verifier evidence and Core join verdict;
- Render services, health-contract digest and rollback target;
- host action, expiry, idempotency chain and host-policy requirement.

The ticket is reserved before the native host action, then completed or
reconciled only from connector-derived evidence. Its lifecycle is persisted so
an interruption cannot cause an ambiguous re-execution.

## Trusted external readback

GitHub and Render readback are independently fetched through server-owned,
tenant/repository exact resolvers. Tokens never enter work memory, receipts,
Atlas summaries or logs. Trusted closure requires the exact committed
readback, required checks, trusted workflow provenance, release/rollback
availability and live service health contract.

The release path is therefore:

1. Build and independently verify the bounded change.
2. Obtain a Core join verdict and action ticket.
3. Let the native host execute only the ticketed action, subject to its policy.
4. Read GitHub commit/check state and Render health from their sources.
5. Reconcile the ticket and finalize only if the exact evidence matches.
6. Persist a final closure receipt or an indexed blocker with one safe next
   action.

Neither a caller-provided `approved` boolean nor a successful HTTP command is
closure evidence. A failed or unavailable external action is checkpointed; the
system does not silently retry a deploy, merge or rollback beyond the ticketed
scope.

## State model and recovery

```
active -> verified -> release_ready -> completed
   |          |            |
   +--------> blocked <----+
                 |
                 +--> fresh bounded plan -> active
```

- `active`: work, Atlas and evidence are being collected.
- `verified`: independent local evidence is complete.
- `release_ready`: Core join is bound; an exact external ticket is required.
- `completed`: external result, health and rollback readback match the ticket.
- `blocked`: a durable incident describes the failed invariant and next safe
  action. It is never treated as completed merely because a worker stopped.

Recovery begins from the Work Catalog and incident/checkpoint indexes, then
selects an Atlas change cone. A new coordinator confirms the anchored intent,
current state hashes and the persisted ticket status. Reserved actions are
reconciled from external evidence before any retry. Expired agent leases block
the old plan and require a new plan; they cannot be revived by reusing a child
assignment.

## Storage and isolation

PostgreSQL 16 is the canonical continuity backend in production. It provides
transactions, advisory locks, immutable-anchor and append-only triggers,
idempotency keys, revision CAS and recursive Atlas queries. The service does
not use a deploy-filesystem continuity fallback: without a configured database
or explicitly supplied database pool, the continuity runtime is unavailable
and the caller must fail closed or expose `discovery_required` as appropriate.

Tenant ID is present in every durable key and query. Cross-tenant catalog,
Atlas, event, receipt, incident and release reads are prohibited. Stored prompt
shaped content is redacted and bounded; secrets, bearer tokens, provider keys
and raw customer content must never be written to the continuity fabric.

## Good Mode and God Mode

Good Mode / God Mode is a server-side owner profile for a configured tenant.
When enabled for a verified allowed identity, it may satisfy ordinary
owner-confirmation fields and allow Nyra/Core to prepare the bounded Core
authorizations described here. It does not turn an unbounded request into an
approval, does not create external credentials, and does not bypass ChatGPT or
Codex sandbox/approval policy.

An emergency stop removes the profile on the next request. Tenant isolation,
absolute-deny actions, redaction, ticket expiry, independent verification and
trusted external readback remain mandatory in every mode.

## Operational invariants

1. Preserve and interpret the initial request through the immutable anchor.
2. Use a small, indexed change cone before opening specialists.
3. Use native ChatGPT/Codex specialists only; no API-key provider agents.
4. Keep the builder, verifier and Core release authority distinct.
5. Never replace host approval policy; record a blocked checkpoint instead.
6. Reconcile interrupted external work from GitHub/Render evidence before retry.
7. Persist the exact recovery step and index it by tenant, work and incident.
8. Close only with independent evidence, Core receipt and, for release work,
   exact live commit, health and rollback readback.

## Verification matrix

| Contract | Evidence |
| --- | --- |
| Native-only planning | `work-continuity-fabric-v2.test.js` and zero-provider CI tripwire |
| PostgreSQL 16 durability | `work-continuity-postgres16.test.js` against the CI PostgreSQL 16 service |
| No filesystem continuity fallback | `work-continuity-file-runtime-retirement.test.js` |
| Core ticket and readback governance | Host-native governance and external-readback unit suites |
| Production readiness | Required CI checks plus exact GitHub/Render readback and closure receipt |
