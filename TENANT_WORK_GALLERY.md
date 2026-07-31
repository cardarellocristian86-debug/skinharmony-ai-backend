# Tenant Work Gallery

Tenant Work Gallery is the default operational surface returned by
`work_preflight`. It uses the authenticated tenant identity and the
PostgreSQL Work Continuity runtime; callers cannot select a tenant in tool
arguments.

## Access model

| Identity | Tenant selection | Gallery capabilities | Owner/provider access |
| --- | --- | --- | --- |
| Tenant owner | Server-side OAuth owner binding | Read, coordinate, review, operate | Only after fresh, request-bound owner confirmation |
| Tenant member | Server-side membership | Read and coordinate | No |
| Reviewer | Server-side membership | Read, coordinate, review | No |
| Operator | Server-side membership | Read, coordinate, operate | No |
| Self-service user | Stable tenant derived from verified OAuth subject | Read, coordinate, review, operate in that personal tenant | No |
| Support delegate | Explicit tenant binding with delegation id and expiry | Read, coordinate, review until expiry | No |
| Codex service identity | Configured default tenant only | Read, coordinate, review, operate | Never crosses to a client tenant by request argument |

Support access is configured server-side:

```json
{
  "oauth|support-subject": {
    "tenant_id": "client-tenant",
    "role": "support_delegate",
    "delegation_id": "support-case-42",
    "expires_at": "2030-01-01T00:00:00.000Z"
  }
}
```

Expired support delegations fail authentication. A support delegate cannot
become tenant owner, enter provider setup, deploy, merge, or select another
tenant.

## First login and first Work Identity

With `MCP_SELF_SERVICE_TENANTS_ENABLED=true`, an unmapped verified OAuth
subject receives a stable isolated personal tenant. A client-owned shared
tenant instead uses an explicit owner binding; additional client users use
bounded membership bindings. Platform owner or god-mode configuration does not
automatically grant access to client tenants.

The first persistent Work Identity is never created by automatic preflight.
It requires `work_continuity_create` or
`work_continuity_start_or_resume` with a fresh, request-bound confirmation
from the server-bound tenant owner. Members, self-service users, and temporary
support delegates can open the Gallery and coordinate only a Work Identity that
already exists. This prevents them from silently creating durable client work.

## Canary

`render-tenant-work-gallery-staging.yaml` defines isolated MCP, Universal
Core, PostgreSQL, and disk resources on
`agent/tenant-work-gallery-on-continuity`. It contains no production
database or provider credential references.

The canary is push-triggered so it runs while this workflow exists only on the
candidate branch, before its PR can merge. `workflow_dispatch` is deliberately
not relied on for this gate: GitHub requires a manually dispatched workflow to
exist on the default branch.

Before the first candidate push, deploy both isolated Render services from
`main` at `569a8135a58e4ff0ad1b1ccf538fa0f6a5b6a9c1` and verify that both
`/healthz` `build.commit_sha` values attest that exact SHA. This is the
immutable `ROLLBACK_SHA`; update it only after repeating that baseline
attestation. Keep the isolated services' auto-deploy branch on
`agent/tenant-work-gallery-on-continuity`.

On every non-bot candidate push, the workflow binds `EXPECTED_SHA` to
`github.sha`, waits for both isolated endpoints to attest it and their
PostgreSQL durability, then forward-reverts the linear range from
`ROLLBACK_SHA` only if the candidate ref has not advanced. The bot-generated
revert is guard-skipped and remains staging-only. It never deploys or
references production.

This is an infrastructure/durability canary. An authenticated Gallery smoke
requires the explicitly isolated Auth0 values; it must not reuse production
credentials.
