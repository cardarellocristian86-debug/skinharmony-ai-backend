# Core Block Remediation rollout

## Shadow canary

1. Deploy the exact reviewed commit to the isolated MCP staging service.
2. Keep `CORE_BLOCK_REMEDIATION_MODE=shadow` (the safe code default).
3. Submit one tenant-scoped blocked action for each mapped block class.
4. Confirm the legacy `allowed=false` response and the additive remediation
   envelope share the same tenant, work, decision and scope digests.
5. Restart MCP staging and verify the same remediation ID is readable.
6. Verify the decision-ledger digest chain and confirm that stored payloads
   contain no prompt, bearer, credential value or personal data.

## Active-mode gate

Changing the live flag to `active` requires a separate owner authorization.
Before that gate, verify proposal idempotency, stale-version rejection,
cross-tenant denial, scope-expansion denial, owner-confirmation binding and that
every resubmission reaches Universal Core's normal evaluator.

## Rollback

Set `CORE_BLOCK_REMEDIATION_MODE=disabled` and redeploy the same application
version. Do not remove historical remediation records or decision-ledger events.
No destructive database migration is required.
