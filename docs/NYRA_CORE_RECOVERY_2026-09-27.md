# Nyra Core recovery — September 27, 2026

The previous session left an uncommitted horizontal recovery candidate on
`fix/nyra-closure-orchestrator-v2`. Production and GitHub main are at
`8cced7faac1cc2fbfe75bd6367409b927937110b`, including PRs 598–602. This candidate
preserves those released fixes and reconciles the remaining changes on the
external disk in `fix/nyra-core-reviewed-recovery-20260927`.

The remaining changes cover bounded branch taxonomy reads, complete Work
readbacks, causal capsules, queued Work activation and initial Entity360
readiness, explicit verifier test verdicts, typed continuation replay, and
fresh Entity360 context before semantic authorization.

Independent review found and corrected two additional defects:

- An existing verified Entity360 snapshot supplied a verification digest,
  whereas readiness persistence required a bootstrap gate digest. The two
  evidence kinds now have distinct bindings and the schema adds a nullable
  verification-digest column without rewriting historical events.
- Legacy causal snapshot requests used output-derived idempotency material.
  Bootstrap now uses a versioned namespace and stable capsule instruction.
  A legacy READY status alone cannot attest the new verified lineage; recovery
  requires the matching v2 event.

## Verification

- Core MCP: 1,387 tests, 1,373 passed, zero failed, 14 configuration-gated skips.
- Universal Core: 1,504 tests, 1,488 passed, zero failed, 16 configuration-gated
  skips; subsequent smoke test passed with both Rust components compiled.
- Dedicated local PostgreSQL tests: 12 Work/task integration cases and 21
  Entity360/ICF integration cases passed without skips.
- Ghidra 12.1.2 imported and analyzed the local Node 26 launcher successfully.
  This establishes only the native runtime boundary, not Work correctness.
- Frida 17.15.3 spawned the local test target, but attachment timed out. No
  trace was collected; the suspended test process was terminated.

Independent production readback found all three services on `8cced7fa`, with
HTTP 200 liveness/readiness and no error logs in the sampled window. That is
baseline evidence, not evidence that this uncommitted candidate is deployed.

## Release and closure conditions

Canonical recovery Work: `4fd373c7-bb9f-5b3b-bb6f-1cacf4382b2a`.
Parent: `25790eaa-4180-5d36-b84e-1df53b498a2f`.
Review plan: `5baa7ee1-79c2-512f-b9db-03a07401d75f`.

The production Gallery contains 29 open Work identities. Nine have no pending
required tasks, but none has a persisted final closure receipt. Task counts
alone are insufficient for closure: the native release receipt and Core Join
must be reconciled against each Work's immutable intent and live evidence.

Publishing this candidate requires independent final review and exact Core
tickets for commit, push, PR, merge and Render deployment. The rollout must
preserve policy signer commit bindings across MCP, Nyra and Universal Core.
Rollback is to the currently verified baseline `8cced7fa`; the prior common
deployed commit `d9a2f6cc` is also identified in the independent baseline report.
Database rollback must retain the additive columns and append-only events.

Redacted local logs, inventory and independent reports are retained outside
the repository at `/Volumes/Esterno/nyra-core-recovery-evidence-20260927`.
No completion claim is made for the release or the 29 open Work identities.
