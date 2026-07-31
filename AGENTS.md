# Governed native-agent workflow

This repository uses ChatGPT/Codex native subagents. Do not create specialists
through an OpenAI API key, provider vault, Responses API call or hidden provider
fallback.

- The root thread is the coordinator. Preserve the complete initial request,
  constraints and acceptance criteria under one tenant-scoped Work Continuity
  identity when the Nyra/Core connector is available.
- For multi-agent or broad repository work, obtain a bounded Nyra/Core plan and
  create only the native specialists required by that plan. Use at most three
  specialists and at most two active specialists in parallel.
- Give each specialist an exact scope, dependencies, acceptance criteria,
  evidence requirements and stop conditions. Prefer the Work Atlas change cone
  and indexed incident history over a full-repository rescan.
- A child may implement, research or verify. It may not expand its scope,
  approve its own work, mint a delegation or issue an action ticket.
- Material changes require a distinct verifier. The coordinator must inspect
  specialist reports, request corrections when evidence is incomplete and keep
  dissent visible.
- Commit, push, draft PR, ready-for-review, merge, deploy and rollback actions
  require the exact bounded Universal Core delegation/ticket appropriate to the
  action plus every approval imposed by the ChatGPT/Codex host. Reserve before
  the connector action; complete or reconcile from connector-derived evidence.
- Nyra and Core do not click approval prompts, weaken the sandbox or replace
  host policy. A denied or unavailable host action becomes a checkpointed
  blocker with one bounded next action.
- Do not declare closure from a worker status, a caller-provided approval
  boolean or a successful tool call. Require acceptance evidence, independent
  verification and the applicable Core closure receipt; externally released
  work also requires exact live commit, health and rollback readback.
- Keep tenant data, credentials and raw customer content out of prompts,
  receipts, Atlas summaries and incident runbooks. Store only redacted,
  tenant-bound evidence and deterministic indexes.

## Operational Gallery and efficiency protocol

Use the authenticated Tenant Work Gallery as the operational surface for work
identity, task/branch state, leases, checkpoints, heartbeats, messages and
closure evidence. Gallery mutations are limited to their exact server-bound
capability and tenant; an unavailable or stale connector is recorded as a
blocker and must not be replaced by caller-supplied identity, tenant or owner
authority. Keep a local rollback-safe checkpoint until the Gallery receipt has
been verified, then reconcile rather than duplicate it.

Before starting or resuming work:

1. read the current Gallery task, checkpoint, handoff, reports and verified
   artifacts;
2. detect already completed or partially completed work;
3. estimate complexity, risk, reversibility and token/invocation/retry budgets;
4. select the minimum useful number of agents;
5. request only relevant files, capabilities and tenant-scoped memory;
6. acquire a tenant-bound claim/lease and create or update one compact
   `agentic_work_capsule_v1`.

The capsule contains `goal`, `scope`, `success_criteria`, `decisions`,
`completed`, `open_risks`, `relevant_files`, `changed_files`, `diff_summary`,
`test_state`, `artifact_hashes`, `reusable_results`, `next_action`, `budget`,
`created_at` and `expires_at`. `test_state` contains `passed`, `failed` and
`pending`; `budget` contains `token_limit`, `invocation_limit` and
`retry_limit`.

- Send capsule deltas instead of full history or repository context.
- Reuse artifacts only with matching tenant, hash, provenance, version,
  verification state and unexpired lifetime.
- Resume retries from the last verified checkpoint and block duplicate claims.
- Give reviewers criteria, diff, tests, evidence, risks and uncertainties only.
- Separate actual provider usage from estimates; never report estimated savings
  as actual or accept caller-invented usage.
- Apply early stop only after every acceptance, security and mandatory-review
  criterion is verified. Efficiency must not weaken quality, isolation,
  authorization or critical review.

More-specific `AGENTS.md` files remain authoritative within their directory.
