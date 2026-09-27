# Nyra/Core horizontal runtime audit — 2026-09-23

> Historical audit recovered from the previous local session. Statements below
> describe observations on September 23–24, not the current production state.
> The September 27 candidate is rebased onto live commit `8cced7fa` and has a
> separate verification record in `NYRA_CORE_RECOVERY_2026-09-27.md`.

## Scope and evidence rule

This audit initially followed the deployed runtime at merge commit
`82e306f3c023f05d62fd7617a3a0abfa52ac0421` and was refreshed after the live
triple converged on `9597246b430ecf53776607b5b8a9153db5e79c4f`. Pull-request descriptions are
not treated as proof. A capability is considered operational only when the
deployed service, its public contract, and a live readback agree.

Evidence sources:

- Render deploy identities and live `/livez` and `/healthz` responses for all
  three services, plus `/readyz` for Core MCP and Universal Core. Nyra's
  unauthenticated `/readyz` correctly returns 401 and is not counted as HTTP
  200 evidence;
- authenticated production MCP calls from the registered Codex host;
- static call-site and route inventory from the exact deployed source digest;
- Frida 17.15.3 tracing of the local Node 26 HTTPS boundary while calling all
  three production health endpoints;
- focused runtime and contract tests.

Ghidra 12.1.2 was invoked against the local native Node runtime with the local
OpenJDK 21 toolchain. The 1-second headless analysis of the 26.0.0 arm64 Node
launcher completed and showed that application execution is delegated to
`libnode.147.dylib` and standard runtime libraries; it exposed no Nyra/Core
application symbols. A deeper analysis of the 67 MiB `libnode` image reached
the explicit 180-second bound after resolving 89,000 chained pointers. This is
useful negative evidence: the Work/closure/ticket decisions are JavaScript and
PostgreSQL contracts, not hidden native application branches. The app-level
call graph below is therefore derived from the exact source and corroborated at
the native boundary with Frida rather than inferred from an incomplete native
decompilation.

## Executive result

The three production services are now aligned and ready on the same commit:

| Service | Commit | HTTP | Runtime readiness |
|---|---|---:|---|
| `skinharmony-core-mcp` | `9597246b...` | 200 | `ok=true`, `render_ready=true` |
| `skinharmony-nyra-core` | `9597246b...` | 200 health | signer and replay `ready`; public readiness is authenticated |
| `skinharmony-universal-core` | `9597246b...` | 200 | policy proof E2E `ready` |

The outage was not caused by PR #596. The observed diagnosis was a release-order
defect: the Core
MCP signer uses the manually provisioned
`POLICY_REGISTRY_NYRA_SIGNER_TARGET_COMMIT`, while Nyra binds every attestation
to its immutable Render commit. The MCP pin still targeted the previous Nyra
release during the rollout, so Nyra correctly failed closed with the generic
`nyra_policy_signer_unavailable`. Updating the pin to the exact deployed Nyra
SHA and redeploying Core MCP restored the complete chain without weakening any
gate. The former target value and failure log were not persisted into this
audit, so the historical causal attribution is operationally observed but not
independently reproducible from this document alone.

## Horizontal call-path matrix

| Path | Live state | Evidence | Defect / delta |
|---|---|---|---|
| Host identity → MCP | PASS | Codex native identity, tenant and session fingerprint returned | None observed |
| Natural-language intake → canonical intent | PASS for tested read | Explicit read-only request remained `READ_ONLY` | Broader ambiguous-language suite still required |
| Gallery list/pagination | PASS | 23 operational Work returned over 3 pages at verification time | Gallery is not reconciled; many overlapping release-recovery Work remain |
| Work select/resume | PASS | Work `7b99...` bound without creating a duplicate | Response is too terse and hides requested readback details |
| Persistent final outcome | PASS | outcome revision, target and criterion digests returned | 9 intermediate goals remain unverified |
| Checkpoint | PARTIAL | `checkpoint_available=true` | checkpoint body/reference not materialized in the host response |
| Handoff/inbox | INCONSISTENT | `handoff_available=true`; a verifier assignment was claimed during this audit | memory reports `handoff_count=0`; handoff body/inbox not returned |
| Assignment | PARTIAL | verifier assignment `b5602acc...` was offered and then claimed | no complete task brief in `connected_ai_brief`; the offered-state row is a past snapshot |
| Branch taxonomy | FAIL READBACK | 13 required Nyra branches are present in the Work verdict | taxonomy read currently fails `502 core_response_too_large`; nested branches are not usable |
| ICF | FAIL READBACK | feature exists in Core | resumed public response omits a verified ICF projection |
| Entity360 | ENFORCED / FAIL READBACK | Control Room reports `ENFORCED`, ready | resumed public response omits a Work-bound Entity360 projection |
| Software Cognition / Atlas | FAIL READBACK | implementation exists | `software_state=not_indexed`, `atlas_revision=0` |
| Policy Registry | PASS | mandatory, signer Ed25519, proof E2E ready | release pin update is manual and temporarily breaks readiness |
| Research Airlock | PASS | `ENFORCED`, `READY`, operational safe | stress/failure injection not yet repeated in this audit |
| Core authorization | PASS for read | fresh verdict `ALLOW`, no mutation ticket requested | mutation chain must be retested after readback repair |
| Generic Work Core Join | INCONSISTENT | remote Ed25519 join is enabled, required and ready | legacy join projection simultaneously reports disabled/unconfigured |
| AEC / ECT closure | NOT COMPLETE | Work closure is false | 4 required tasks and 9 intermediate goals remain pending |

## Runtime tracing result

Frida traced native `connect`, `SSL_write`, and `SSL_read` calls from the local
Node runtime to all three Render services. Each endpoint returned HTTP 200 and
three independent TLS connections were observed. This proves network and TLS
transport from the execution host; it does not prove application semantics,
which are covered by the structured live readbacks above. This run was observed
interactively but no immutable trace artifact was retained, so it is supporting
diagnostic evidence rather than independently reproducible proof.

Static source searches show hundreds of HTTP route registrations and more than
one thousand database/network call sites. Exact totals depend on the search
definition, so they are deliberately not used as evidence of operability; the
matrix above uses live behavior as the deciding evidence.

### Deep closure/ticket trace added after the first governed release attempt

The exact production sequence for Work
`25790eaa-4180-5d36-b84e-1df53b498a2f` was followed through native report
admission, task-scoped evidence promotion, Work-wide closure evaluation, V2
task snapshot binding and precommit gate materialization. Frida 17.15.3 then
spawned the same Node 26 test process with native hooks on `connect`, `open`,
`openat` and `posix_spawn`. The focused closure suite passed without any
network connection and only the Node test-runner child spawn crossed a hooked
boundary. This confirms that the reproduced failure is deterministic local
contract logic, not Render, TLS, OAuth or a remote provider.

Three coupled failure modes were isolated:

1. `reportNativeAgent` persisted `tests` as arbitrary JSON, while both
   `evaluateTaskScopedNativeVerifierEvidence` and `evaluateNativeClosure`
   interpret success only when `test.passed === true`. A verifier naturally
   reported `passed: 1317` as a count. Admission accepted it, task promotion
   silently remained false, and closure later emitted the misleading generic
   `test_failure_present`. The candidate now normalizes test evidence to
   `native_test_evidence_v1` and rejects a non-boolean verdict, inconsistent
   counts, missing names and a positive verdict with failures at admission.
2. A pending V2 task is allowed during commit-ticket acquisition only when it
   is the server-recognized gate task. The recognition is read from the
   append-only gate tables. In the failed run the manually added release task
   was not such a gate; it remained pending because the malformed verifier test
   report could not promote it. That is not repaired by matching titles or by
   weakening the task gate. A fresh plan with valid evidence must first promote
   the release task; only then may closure materialize its own server-owned
   `git.commit` gate task.
3. The typed `git.commit` path claimed the one-use precommit gate before
   Universal Core had completed its action/delegation/branch/path/budget
   checks. A deterministic Core denial returned before any ticket locator was
   therefore persisted as `before_ticket_locator`, but the only abandonment
   path required an inactive delegation. With an otherwise valid active
   delegation, the claim stayed live forever: a corrected request could not
   acquire a new claim, closure continued to see an unresolved claim, and the
   public recovery path could only return `BLOCKED`. The candidate now
   distinguishes a received deterministic no-ticket denial from transport,
   timeout and uncertain outcomes. Only the former receives an append-only
   terminal denial reconciliation; transient or possibly-effectful outcomes
   remain frozen for replay/reconciliation.

The relevant call chain is:

`work_continuity_native_report`
→ `reportNativeAgent`
→ normalized test/precommit evidence
→ `evaluateTaskScopedNativeVerifierEvidence`
→ native verifier evidence bridge
→ V2 task acceptance
→ `reevaluate_native_closure`
→ `evaluateNativeClosure`
→ `nativeV2TaskClosureSnapshot`
→ `bindNativeV2TaskSnapshotToEvaluation`
→ native precommit gate bridge
→ server-owned gate task
→ typed delegation/action-ticket path.

After the P0 correction, Frida spawned the two exact authorizer/continuation
regression suites with hooks on `connect`, `open`, `openat` and `posix_spawn`.
All 95 tests passed. The trace observed only local file opens and two
test-runner child spawns; it observed no `connect` call. This independently
confirms that deterministic denial classification and claim retirement execute
inside the local server contract, while the tests separately require the exact
shape produced by a received Core HTTP denial. A local lookalike error, timeout,
rate limit or unknown failure cannot enter the terminal-denial path.

## Gallery inventory

The production selector reported 23 operational Work at independent
verification time. The following list is a non-exhaustive cluster sample, not a
complete accounting:

1. PR 567 release/precommit recovery: 6 Work.
2. Entity360 release/freshness/ICF recovery: 9 Work.
3. Queue-only continuity: 2 Work.
4. Session/resume/taxonomy: 1 Work.
5. Precommit/Gallery parity: 1 Work.
6. Terminal revival/reconciliation: 1 Work.
7. Nyra Dialogue creation/readback: 1 Work.

These records must not be closed in bulk merely because the associated code is
merged. Each requires a canonical-successor relation, evidence reconciliation,
or verified closure. The current system exposes the duplicate pressure but does
not yet present a fluent merge/reconcile action to the connected AI.

## Canonical Work currently resumed

- Work: `7b99fb3f-6033-56f8-aa26-12f6dbd313a7`
- Name: Nyra Horizontal Independent Agent Factory V1
- Status: `ACTIVE`, progress `0%`, closure not verified
- Required tasks: 4 pending
- Acceptance criteria: 5
- Intermediate goals: 9 pending
- Next task: `Inventory and register existing vertical capabilities`
- Verifier assignment: `b5602acc-66fa-43c1-8e51-670060ac1be3`; it was offered
  and subsequently claimed during the audit
- Persisted next action: reconcile submitted execution evidence before
  advancing the outcome.

## Root causes ranked

1. **Precommit claim ordering loop.** The one-use claim was persisted before
   the authoritative Core decision and could not be retired after a
   deterministic no-ticket denial while the delegation remained active.
2. **Projection fragmentation.** Gallery, memory, Dialogue, Work Continuity,
   ICF, Entity360, Atlas and assignment inbox expose different slices of the
   same Work. The host receives contradictory availability flags instead of one
   canonical operational projection.
3. **Release signer pin is non-atomic.** A valid security binding is maintained
   manually across deployments, creating a predictable fail-closed outage
   window.
4. **Read responses suppress actionable state.** The server has checkpoint,
   handoff and assignment identifiers but renders only “four activities
   remain” and an empty waiting brief.
5. **Reconciliation is not surfaced as the default continuation.** Duplicate
   clusters remain visible, while the host is required to select each Work
   manually and cannot naturally request canonical successor/child/merge.
6. **Presence is not durable participation.** Control Room currently shows two
   active sessions, but the newly authenticated audit session was not
   registered as a durable Work participant; presence and participation remain
   separate projections.
7. **Oversized taxonomy response.** The branch registry attempts to return a
   response above the Core transport ceiling, producing
   `core_response_too_large` instead of a paginated tree.

## Remediation candidate produced from this audit

The branch `fix/nyra-closure-orchestrator-v2`, based on
`9597246b430ecf53776607b5b8a9153db5e79c4f`, now contains the first bounded
horizontal remediation set:

1. `nyra_converse` can persist a semantic typed Core request as an immutable,
   server-owned record and return only an opaque continuation reference. The
   host no longer reconstructs Work, Intent, identity, digest or idempotency
   bindings when continuing a delegation or action request.
2. `nyra_continue` consumes that exact record and rejects client-side request
   reconstruction, tenant/host/principal/session drift, operation drift and
   legacy ref-only guessing. Existing non-typed continuations remain supported.
3. The Work read projection reconciles authoritative V2 revision/state with the
   dialogue projection and returns stable checkpoint/handoff references and a
   truthful `next_action_available` value.
4. Branch taxonomy reads use deterministic, tenant- and taxonomy-bound opaque
   cursors, a default page of 100 and a hard page maximum of 200. A test walks
   all 2,518 taxonomy items while keeping every page below 512 KiB.
5. The public compact connector keeps `typed_core_request` opaque in
   `tools/list`; the complete closed schema remains enforced at invocation.
6. Native report admission and its public MCP schema now agree on an explicit
   boolean test verdict plus named, internally consistent counters. Numeric
   pass counts can no longer be stored as if they were closure verdicts.
7. Task-scoped V2 promotion requires an exact `v2-task:<digest>` attestation,
   including when the verifier also submits Work-wide acceptance evidence;
   evidence for task A can no longer promote task B.
8. A received, allowlisted deterministic Core denial before any ticket locator
   produces an append-only terminal reconciliation for that claim. Exact retry
   does not call Core twice, while a corrected request bound to a new gate can
   proceed. Transient and uncertain outcomes remain frozen for reconciliation.

Verification on the candidate:

- Core MCP complete suite: 1,328 passed, 0 failed, 12 skipped.
- Universal Core complete Node test suite: 1,468 passed, 0 failed, 16 skipped.
- Typed precommit authorizer/continuation suite under Frida: 95 passed, 0
  failed; no network connection was observed.
- Candidate branch taxonomy traversal: complete, stable and tamper/cross-tenant
  negative cases passed.

## Deep bootstrap/readiness trace — 2026-09-24

The later trace of Work `25790eaa-4180-5d36-b84e-1df53b498a2f` disproved the
earlier hypothesis that its causal Work binding was absent. The binding is
verified and its project, Genesis, approved Intent revision and Work event are
readable. Two independent materializations were missing:

1. `core_causal_continuity_capsules` had no capsule for the otherwise verified
   Work binding, so `continuity_capsule_resume` returned
   `causal_causal_not_found` even though the legacy checkpoint existed.
2. Entity360 resolved the Work identity but had no initial snapshot, so the
   Semantic Scope resolver could not produce the exact context required by the
   native Core ticket path.

The Entity360 bootstrap itself contained two coupled defects:

- MCP reused the ordinary lease-backed DTT mutation envelope. A newly created
  Work cannot possess that operational lease before its initial context is
  ready, producing a circular dependency.
- Universal Core sampled the snapshot `as_of` application timestamp before it
  called the initial ICF seed transaction. When the seed was created by that
  call, the subsequent bitemporal query correctly excluded it because its
  database `created_at` was later than `as_of`. The Work therefore remained
  incomplete despite the server having just written its own required seed.

The candidate now implements the horizontal repair:

- a dedicated `dtt_work_bootstrap_context_v1` envelope, signed by MCP and bound
  to the exact tenant, Work, authenticated principal/session, immutable Work
  binding digest, HTTP method, route, request body and expiry;
- Universal Core accepts this non-executing envelope only on the initial
  Entity360 Work snapshot route; ordinary lease tokens and every other route
  fail closed;
- the ICF transaction returns a database-owned consistent cut sampled after
  the seed has been written or verified, and Entity360 uses that exact cut;
- Work Continuity persists an explicit Entity360 readiness projection
  (`PENDING`, `READY` or `NOT_REQUIRED`) with the snapshot and gate digests;
- creation/replay and mutating resume require the joined causal + Entity360
  readiness, while read-only Gallery access remains available;
- canonical causal reconciliation now also builds/replays the exact causal
  continuity capsule, so a Work cannot be advertised as newly operational with
  only a binding and no resumable capsule.

Focused verification after this repair:

- Core MCP bootstrap, transport, Work-store and causal suites: 186 passed,
  0 failed;
- Universal Core Entity360, route and ICF suites: 118 passed, 0 failed;
- Core MCP complete suite: 1,335 passed, 0 failed, 12 skipped;
- Universal Core complete suite after the static route correction: 1,478
  passed, 0 failed and 16 skipped; its separate service smoke passed. Express
`send` had rejected the hidden `.codex` worktree component, so the route now
uses the trusted UI directory as `sendFile` root.

The independent release review then found and closed three additional gaps
before publication:

- Entity360 `READY` is monotonic under serialized recovery: a later timeout or
  concurrent `PENDING` retry cannot erase the verified entity, snapshot and
  gate binding;
- the causal capsule readback is accepted only when its outer and embedded
  project/Work locators match the canonical Work and its canonical digest is
  recomputed exactly;
- the bootstrap transport has negative coverage for signature tamper, tenant,
  Work, request body, route, expiry, not-yet-active issuance and mismatch with
  the independently verified agent principal.

After these changes the focused MCP set passed 139/139, the focused Universal
Core set passed 118/118, the full MCP suite passed 1,335 with 0 failures and 12
environment-dependent skips, and the full Universal Core suite passed 1,478
with 0 failures and 16 environment-dependent skips.

The final deep-flow trace also closed the retry loops that remained hidden by
the first green suite:

- causal snapshot retry no longer changes when only a server-derived timestamp
  advances, and capsule replay returns its original immutable record after the
  timeline moves forward;
- a Work cannot be marked causally `READY` without the verified binding digest;
  migrated rows lacking a real digest become `PENDING` and are recovered by the
  server-owned readiness path;
- a queued Work without a legacy bridge is explicitly
  `ACTIVATION_REQUIRED`, remains resumable, and defers Entity360 until the
  accepted host activates the canonical bridge;
- Entity360 bootstrap v2 excludes actor, session and caller time from its
  canonical digest, so a lost response can be replayed by another registered
  host without changing the Work;
- an existing revision-0 snapshot is adopted only after exact tenant, Work,
  policy, ontology, adapter and ICF-ledger validation;
- stale Entity360 context is refreshed with predecessor CAS before semantic
  ISSUE or RESERVATION, and ISSUE now requires a freshness horizon covering
  the full ticket TTL. A changed snapshot requires a new ticket and
  idempotency key; an old ticket is never silently rebound.

These are candidate results, not live proof. Production remains on
`9597246b430ecf53776607b5b8a9153db5e79c4f` until the exact Core-governed
release path authorizes and deploys this candidate.
- `git diff --check`: passed.

Live governance readback also exposed a remaining release blocker rather than
hiding it: all 24 operational Gallery Work currently return no applicable
precommit ticket gate. The Work used for this remediation has completed task
and evidence counters but its earlier gate is no longer available for a new
commit. The typed AI→Core path successfully issued a fresh bounded delegation;
Core correctly refused to reuse an unrelated/consumed Work gate. A new
reviewed child/extension requires an OAuth owner-bound creation continuation,
which a legacy Codex bearer cannot impersonate. This is the precise remaining
workflow condition to resolve before publishing this candidate; bypassing it
would invalidate the audit's governance claim.

## Remediation sequence

1. Add a dual-slot/dual-target release contract (or an equivalent candidate
   signer endpoint) spanning Core MCP, Nyra and Universal Core. Pre-verify the
   candidate slot, switch all three services to the same attested commit, then
   retire the predecessor only after health convergence. The current
   single-version architecture cannot provide an atomic zero-outage update,
   because its E2E readiness requires all three live services to share the
   exact commit.
2. Build one server-derived `operational_work_projection` joining final outcome,
   tasks, ICF, Entity360, Atlas, branches, checkpoint, handoff, inbox and
   assignment without granting mutation authority.
3. Render that projection in Dialogue and populate a bounded connected-AI brief
   from the actual next task/assignment.
4. Expose canonical duplicate classification and successor/child/reconcile
   operations through the governed continuation path.
5. Reconcile all 23 currently visible Gallery Work cluster by cluster,
   re-reading the count before each batch and preserving audit lineage,
   then close only those with verified ECT evidence.
6. Repeat positive, negative, interruption and multi-host E2E tests and update
   the persistent Self Model from the verified result.

## Immediate acceptance checks

- A generic “what Work are open?” request returns the complete paginated count
  without becoming `work_bootstrap`.
- Resuming one Work returns its exact objective, final outcome, tasks,
  checkpoint, handoff/inbox, branch tree and assignment in one read-only turn.
- A connected AI can claim the exact assignment, submit evidence, hand it to a
  distinct verifier and resume after session restart.
- A duplicate request yields `DUPLICATE`, `EXTENSION`, `DEPENDENCY` or
  `PARALLEL_VALID`, followed by an executable governed continuation.
- A release candidate uses a separately verifiable signer slot across Core MCP,
  Nyra and Universal Core; promotion and rollback switch only between complete,
  already attested triples.
- Closure remains impossible until AEC and ECT evidence are both verified.

## Governed release follow-up — 2026-09-24

The earlier statement that an OAuth owner-bound child could not be created is
no longer current. The governed anti-duplicate review created the exact child
Work `4fd373c7-bb9f-5b3b-bb6f-1cacf4382b2a`, linked to parent
`25790eaa-4180-5d36-b84e-1df53b498a2f`, with canonical Intent digest
`4b6dfa1ddcf99e56aedb5c8d892e31dd2e1779f863c0bd1bb55531f2e946de52`.
Its causal lineage is `READY`; the anti-duplication/child-lineage activity was
recorded as completed only after that readback. Release and live-verification
tasks remain open and were not falsely completed.

The production Control Room readback now reports:

- Nyra Dialogue `ON`;
- Entity360 `ENFORCED` and ready;
- Semantic Scope Guard `ENFORCE`;
- Research Airlock `ENFORCED` and operationally safe;
- Policy Registry `READY` with mandatory enforcement;
- Work Continuity `READY` with the child Work visible and coordinated by
  transport-bound Codex sessions.

The native-tool audit is preserved separately in
`/tmp/NYRA_CORE_GHIDRA_FRIDA_TRACE_2026-09-24.md`. Ghidra 12.1.2 evidence is
bound by digest
`7b0dd45209c06db0f25bb096f6367af597928b176fe6820d1923a0b849960ad2`;
Frida 17.15.3 evidence is bound by digest
`5a69ae0fdfbfc76a126e13544a69fc76a81358cdcf9266c5bda4a131fa786922`.
Those traces prove the local native/runtime boundary used for the requests,
but the failure itself is JavaScript orchestration state, not a native binary
fault inside Node, TLS or libc.

### Newly isolated release deadlock

The first candidate verification exposed a narrower horizontal defect. The
precommit snapshot allowed a commit ticket only when the sole unfinished
required V2 task was the synthetic ticket task. A real release Work separates
candidate verification, release execution and live verification; therefore
post-commit and post-deploy tasks must honestly remain pending. The old rule
made that honest Work unable to obtain its first commit ticket.

A first relaxation that accepted any additional pending task was rejected by
the independent verifier. It would have admitted an unrelated or unbound task
and Dialogue would still have disagreed with the claim store. That relaxation
was removed before delivery.

The bounded correction under verification instead requires all of the
following:

1. the native plan explicitly proposes only `POST_COMMIT` or `POST_DEPLOY`
   V2 task deferrals;
2. the server resolves each task from the current tenant/Work projection and
   freezes task ID, task digest, revision, required state and phase into the
   immutable plan digest;
3. an independent verifier attests the exact frozen deferral-set digest;
4. closure evaluation admits pending tasks only when every one is either the
   server-recognized synthetic commit-ticket task or a verified frozen
   deferral;
5. gate readback and claim revalidate the same task digests, revisions and
   states; drift or tampering makes the gate stale;
6. Nyra Dialogue consumes that same gate projection, hides only verified
   deferred tasks from the precommit blocker, and continues to show them as
   mandatory for final Work closure.

Production exposes a legitimate recovery path for a defect in the normal
release gate: both `bootstrap_release_exception` and
`bootstrap_deadlock_verdict` report `ready`, use PostgreSQL state and bind a
single short-lived `github.merge` action to green checks, exact PR/head,
request-bound Owner confirmation, rollback obligations and post-deploy
verification. It is a bounded Core path, not a branch-protection bypass. It
may be used only after the corrected candidate and its independent evidence
are complete.

### Remaining live proof, not yet claimed

The candidate still requires one real multi-host chain after deployment:
create/resume/reconcile Work, checkpoint plus handoff across two AI sessions,
exact ticket issue/readback/reservation, provider effect reconciliation,
three-service commit convergence, AEC, ECT and terminal readback from a fresh
session. Unit and integration suites cannot substitute for that chain.
