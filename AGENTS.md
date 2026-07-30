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

More-specific `AGENTS.md` files remain authoritative within their directory.
