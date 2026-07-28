# Agentic Efficiency integration contract — 0.16

The implementation is advisory and fail-closed. It never grants execution,
contacts a provider, changes a model, or adds an MCP top-level tool.

## Runtime exports

`src/agenticEfficiencyRuntime.js` exports:

- `buildAgenticEfficiencyPlan({ trustedContext, trustedVerification, request, now, mode })`;
- `evaluateAgenticBudgetGuard({ trustedContext, plan, policy, usage, rateCard,
  providerUsageVerified, auditReceiptVerified, trustedVerifications, now, mode })`;
- `validateWorkCapsule`, `createWorkCapsuleEnvelope`,
  `verifyWorkCapsuleEnvelope`, `workCapsuleHash`;
- `normalizeAgenticUsage`, `compareAgenticSavings`,
  `checkAgenticArtifactReuse`;
- `AGENTIC_EFFICIENCY_CAPABILITY_MANIFEST`.

`trustedContext` is resolved server-side and contains `tenantId`, `clientType`,
`audience`, `actorId`, `entitlements` and `scopes`. These fields are rejected in
the request body and query. Caller booleans never prove acceptance, tests,
security, tenant isolation, exposure, quality or savings.

## Route mount

`mountAgenticEfficiencyRoutes` in `src/agenticEfficiencyRoutes.js` accepts:

```js
mountAgenticEfficiencyRoutes({
  app,
  store,
  resolveRequestContext,
  verifyProviderUsage,
  verifyAcceptanceEvidence,
  verifyGovernanceEvidence,
  verifySavingsEvidence,
  audit,
  efficiencyMode,
  budgetMode,
});
```

All verifier callbacks are server-side. Defaults fail closed. The mount returns
`top_level_mcp_tools_added: 0` and `execution_authorized: false`.

| Capability | Method and route | Request schema | Response schema |
|---|---|---|---|
| `agentic_efficiency_plan` | `POST /v1/agentic-efficiency/plan` | `agentic_task_v1` | `agentic_efficiency_runtime_v1` |
| `agentic_efficiency_status` | `GET /v1/agentic-efficiency/status` | `empty_query_v1` | `agentic_efficiency_status_v1` |
| `agentic_efficiency_report` | `GET /v1/agentic-efficiency/report` | `empty_query_v1` | `agentic_efficiency_report_v1` |
| `agentic_budget_preview` | `POST /v1/agentic-efficiency/budget/preview` | `agentic_budget_preview_v1` | `agentic_budget_governance_verdict_v1` |
| `agentic_budget_status` | `GET /v1/agentic-efficiency/budget/status` | `empty_query_v1` | `agentic_budget_status_v1` |
| `agentic_work_capsule_read` | `GET /v1/agentic-efficiency/work-capsules/:capsule_id` | `agentic_work_capsule_read_v1` | `agentic_work_capsule_v1` |
| `agentic_savings_compare` | `POST /v1/agentic-efficiency/savings/compare` | `agentic_savings_compare_v1` | `agentic_savings_comparison_v1` |
| `agentic_artifact_reuse_check` | `POST /v1/agentic-efficiency/artifacts/reuse-check` | `agentic_artifact_reuse_check_v1` | `agentic_artifact_reuse_verdict_v1` |

These eight operations are read-only computations or tenant-scoped metadata
reads. `mutation=false`; therefore idempotency keys and `expected_revision` are
not accepted by this surface. Persistence mutations are private Core operations:
`saveWorkCapsule` requires a receipt plus `expected_version`, and enforces
create/update optimistic concurrency.

## PostgreSQL

`createAgenticEfficiencyPostgresStore` uses only the existing
`GOVERNED_AGENT_DATABASE_URL` and the isolated `agentic_governance` schema.
Migration SQL is additive. Rollback records a disabled state without dropping
capsules, usage lineage, audit or comparison data. No raw prompt, credential,
token, repository content or customer payload has a storage column.

Runtime reads and writes additionally require a pre-existing, identifier-validated
`runtimeRole` and `roleSeparationAttested=true`. Each operation executes under
`SET LOCAL ROLE` in a transaction. If role separation is not attested, runtime
access fails closed. The static migration creates a dedicated `NOLOGIN` role and
grants it the minimum schema/table privileges; runtime code never creates roles,
credentials or environment variables. Because both runtimes currently enter that
role through the same `GOVERNED_AGENT_DATABASE_URL` session, this is privilege
separation rather than independent database credentials.

## Required application integration

The Universal Core composition root must:

1. create the store only from the server-side governance database URL and an
   already provisioned least-privilege runtime role;
2. mount the routes with authenticated context and evidence verifiers;
3. add the eight pure manifest entries to the exposure-filtered dynamic catalog;
4. map Core MCP dynamic capability handlers to these exact routes;
5. leave the top-level MCP tool count at 13;
6. keep `execution_enabled=false`;
7. keep the initial modes `shadow` and `observe`.

The connector must never accept an arbitrary route. It dispatches only a
capability ID present in the authenticated, server-filtered manifest.
