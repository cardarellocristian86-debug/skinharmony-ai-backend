# GitHub App worker release checklist

Every item is fail-closed. A later phase cannot start until all checks in the
current phase pass. Secrets never enter Git, MCP payloads, logs, Work records or
test fixtures.

## 1. Authority contract

- [x] GitHub App is installed only on the owner-selected repository.
- [x] Main branch rules require exact CI checks and independent approval.
- [x] Customer installations use separate tenant/install/repository bindings.
- [x] The worker private key destination is the protected Render variable
  `GITHUB_APP_PRIVATE_KEY`.
- [x] Core emits a short-lived, one-use execution claim only after a valid
  standing-release reservation.
- [x] The claim binds tenant, Work, repository, ticket, reservation, exact
  action digest, issue time and expiry.
- [x] The worker rejects missing, forged, expired, replayed, cross-tenant,
  cross-repository and action-drift claims.

## 2. Durable execution lifecycle

- [x] A single-instance persistent ledger records `accepted`, `in_progress`,
  `succeeded`, `failed` or `outcome_unknown` before returning a response.
- [x] State writes are atomic and signed; no reusable lock file is retained.
- [x] A lost/timeout response never triggers a blind provider retry.
- [x] Reconciliation reads GitHub authoritatively and either proves the exact
  effect or quarantines it as unknown.
- [x] Kill switch is evaluated immediately before every provider side effect.

## 3. GitHub capability boundary

- [x] Installation tokens are short-lived and limited to one server-bound
  repository.
- [x] Supported GitHub actions are exact-schema and constructed server-side.
- [x] Force push, ref deletion, tags, workflow edits, secrets, environments,
  administration changes and arbitrary API calls are impossible.
- [x] `git.commit` remains a host Git-lane operation; the GitHub peer never
  accepts arbitrary file contents or shell commands from MCP.
- [x] Ready and merge re-read exact PR/head/base state; Core separately proves
  fresh checks, review and protection immediately before reservation.
- [x] Merge uses the exact Core-authorized head and normal merge method only.

## 4. Verification

- [x] Unit tests cover JWT, installation token scope and tenant isolation.
- [x] Contract tests cover claim signing, verification, expiry and replay.
- [x] Executor tests mock GitHub and prove exact URLs, methods and bodies.
- [x] Recovery tests cover restart during an effect, response loss and
  expired reservations.
- [ ] Existing Core, MCP, standing-release, deployment-parity and PostgreSQL 16
  gates pass on the final diff.
- [ ] Diff check, syntax check and secret scan are clean.

## 5. Publication and deployment

- [ ] Create one intentional commit on the authorized agent branch.
- [ ] Push non-forced and open one draft PR to `main`.
- [ ] Repair only failures within the approved cone; stop on security,
  workflow, secret or deployment-parity drift.
- [ ] Require independent approval and all three required checks green.
- [ ] Merge without force only after fresh Core/GitHub readback.
- [ ] Create the Render worker with execution disabled.
- [ ] Generate a new GitHub App private key only when the exact Render secret
  destination exists.
- [ ] Transfer the key directly to `GITHUB_APP_PRIVATE_KEY`; never display or
  persist it elsewhere.
- [ ] Enable the worker only after health, identity and negative tests pass.
- [ ] Verify exact live commit and retain emergency stop plus previous release
  rollback.

## Stop conditions

Stop without generating or transferring a key if any authority binding is
ambiguous, CI is not fully green, independent approval is absent, Render does
not expose the exact protected destination, or worker reconciliation cannot
determine whether a provider effect occurred.
