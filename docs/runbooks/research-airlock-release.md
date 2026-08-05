# Research Airlock v1 release runbook

## Promotion gates

1. Required CI: `universal-core`, `core-mcp`, `deployment-parity`.
   Because this release adds a PostgreSQL job to the protected workflow, use
   the existing monotonic digest rotation: deploy policy A with candidate B,
   merge the A-to-B workflow only while B is staged, then promote B to current
   and clear the candidate in a final policy-only release.
2. PostgreSQL replay/race test and adversarial matrix pass.
3. Pre-open regression and PostgreSQL race prove that a private/unclassified
   tool either taints the logical session before opening or observes the opened
   public-only work and is denied; no stale `ALLOW` can cross plan consumption.
4. Independent verifier confirms no raw source document crosses the model
   boundary and no legacy/open-world Nyra/Core research tool bypasses the FSM.
5. Merge only with exact Core host-native authorization.
6. Deploy only `skinharmony-universal-core` and `skinharmony-core-mcp`.
7. Read both `/healthz` payloads and require the exact merged commit SHA.
8. Require Universal Core `research_airlock.ready=true`,
   `mode=enforced`, `state_backend=postgresql`.
9. Run a connector smoke: Core plan issuance and single-use consumption work;
   benign fetch succeeds; injection quarantines; seal
   blocks a later web call; private capability replay fails.

## Rollback

1. Change `CORE_RESEARCH_AIRLOCK_MODE` to `shadow` with a bounded Core/Render
   ticket. This denies new work and fails active capabilities closed.
2. Forward-revert the release commit on `main` if code rollback is required.
3. Verify both services report the rollback SHA and healthy readiness.
   Universal Core must report `mode=shadow`, `operational_safe=true` and
   `accepting_new_work=false`; MCP must report `core_ready=true`. An unreachable
   Core remains `503` and is never treated as rollback.
4. Preserve work, capability, fetch-proof and event rows. Rotate signing material
   only if compromise is suspected.

## Acceptance metrics

- zero accepted private/network egress after sealing;
- zero Airlock plan issuance after a session has used private/unclassified tools;
- zero accepted nonce replay or cross-tenant/work/session use;
- zero suspicious raw documents returned to the model;
- all fetches carry DNS/IP, redirect, response, sanitizer, evidence and policy
  digests;
- no change to OAuth, provider execution (`execution_enabled=false`) or
  unrelated branch maturity.
