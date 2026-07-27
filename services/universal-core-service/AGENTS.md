# Universal Core agent rules

Core is the policy and decision authority. Nyra opens contextual branches; agents only advise through bounded contracts.

- Use deterministic routing, authorization, tenant isolation, schema validation and evidence storage before any model call.
- The coordinator owns the final response; use specialists as tools for bounded work. Handoffs are reserved for a true transfer of user-facing ownership.
- Keep specialist fan-out at three or fewer, with at most two model calls in parallel. Do not invoke vision without an image.
- A Core variant is always a proposal with contract, impact analysis, tests, evidence and rollback plan. It is never applied or published automatically.
- Pass only minimal tenant-scoped structured memory to a specialist. Never reuse tenant memory, identities, tokens or caches across tenants.
- Publishing, deployment, payments, customer contact, tenant writes and destructive actions require Core verdict, explicit owner confirmation, audit and a rollback/sandbox path.
- Keep SkinHarmony-specific protocol/catalog configuration in authorized domain adapters. Do not place tenant IDs, secrets or brand configuration in the universal horizontal engine.

## Mandatory agentic-efficiency protocol

Before work begins, inspect the current task, checkpoint, handoff, reports and
verified artifacts. Detect completed or partial work before planning anything
new. Estimate complexity, risk, reversibility and budget, then select the minimum
useful number of agents. A single agent is the default; multi-agent work is
allowed only for genuinely separable work, a critical task, or an independent
verification requirement.

Create or update one tenant-bound `agentic_work_capsule_v1` containing exactly:
`goal`, `scope`, `success_criteria`, `decisions`, `completed`, `open_risks`,
`relevant_files`, `changed_files`, `diff_summary`, `test_state`,
`artifact_hashes`, `reusable_results`, `next_action`, `budget`, `created_at` and
`expires_at`. The nested `test_state` contains `passed`, `failed` and `pending`;
the nested `budget` contains `token_limit`, `invocation_limit` and `retry_limit`.

- Send capsule deltas, never the complete history, repository, Nyra registry or
  tenant memory when the bounded capsule is sufficient.
- Request only relevant files, memory and tool schemas. Tools omitted by the
  scoped plan remain unavailable.
- Acquire a tenant-bound claim/lease before work. An equivalent active claim
  blocks duplicate execution.
- Reuse an artifact only when tenant, hash, provenance, version, verified state,
  security verification and expiry all match.
- Resume retries from the last valid checkpoint; never restart from zero merely
  because an invocation failed. Retry loops fail closed at the declared budget.
- Give a reviewer only acceptance criteria, diff, tests, evidence, risks and
  uncertainties. A reviewer does not repeat the author task.
- Apply early stop only after every acceptance criterion, required security test,
  evidence requirement and critical human review is verified.
- Use model routing only when the host exposes reliable control and Core
  authorizes it. Otherwise emit `recommendation_only`; never invent a model
  switch or saving.
- Keep actual provider usage distinct from estimates. Unverified cached tokens
  are zero, caller-supplied cost is rejected, and estimated savings are never
  presented as actual.
- Budget optimization cannot weaken quality, safety, tenant/client/audience
  isolation or mandatory critical review. A critical budget exhaustion requests
  escalation or safe degradation; it never produces an incomplete result labeled
  final and never applies a hard stop.
