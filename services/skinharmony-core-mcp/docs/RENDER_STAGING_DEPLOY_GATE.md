# Render staging deploy gate

This connector capability is a narrow executor for one service:

- tenant: `codexai`
- environment: `staging`
- service: `skinharmony-universal-core-staging`
- repository: `cardarellocristian86-debug/skinharmony-ai-backend`
- branch: `agent/nyra-policy-registry`

It is disabled by default. Enabling it requires server-side Render bindings:

- `RENDER_STAGING_DEPLOY_ENABLED=true`
- `RENDER_API_KEY`
- `RENDER_UNIVERSAL_CORE_STAGING_SERVICE_ID`
- `RENDER_UNIVERSAL_CORE_STAGING_ENVIRONMENT_ID`
- `RENDER_STAGING_GITHUB_READ_TOKEN` (dedicated read-only repository access)
- `RENDER_STAGING_CORE_RECEIPT_PUBLIC_JWK` (public Ed25519 key only)
- `RENDER_STAGING_CORE_RECEIPT_KID`
- `MCP_COLLABORATION_DATABASE_URL` (the isolated staging database)
- optionally `RENDER_STAGING_DEPLOY_TIMEOUT_MS`

Private credentials never enter tool arguments, model context, audit text, or
tool output. The receipt trust anchor is public; no private signing key belongs
in this service, Git, or shared memory.

## Authorization sequence

1. The client discovers `render_staging_deploy` from the dynamic catalog.
2. It calls `core_capability_invoke` with a fresh catalog revision, explicit
   owner confirmation and an idempotency key.
3. The router computes a SHA-256 digest over the exact validated arguments.
4. Universal Core receives the capability, digest, target service,
   environment, branch and commit under the high-impact, non-rollback profile.
   A generic allow is insufficient: Core must return a single-use Ed25519
   receipt bound to those exact values, the tenant, authenticated actor,
   verified owner-confirmation reference, catalog revision and hashed
   idempotency key.
5. The handler verifies the receipt signature, issuer, audience, expiry (at
   most 30 seconds), tenant and every request binding.
6. It proves through GitHub's compare API that the requested commit is the
   authorized branch head or one of its ancestors.
7. It atomically reserves both the request and receipt in the staging
   PostgreSQL idempotency table. A second replica can neither race the deploy
   nor reuse the receipt. A crash leaves the reservation pending and requires
   explicit reconciliation; it never retries a provider mutation blindly.
8. It reads the Render service and verifies name, service id, project
   environment id, repository, branch, service type and that auto-deploy is off.
9. It reuses an existing active deploy for the same commit or triggers exactly
   `POST /v1/services/{serviceId}/deploys` with `commitId` and no cache clear.
10. `render_staging_deploy_status` locates the deploy by commit and accepts the
    fixed `/healthz` endpoint only when it reports `ok=true`,
    `build.commit_verifiable=true`, and the exact target commit.

Production, other services, branch changes, environment-variable changes,
database changes, Auth0, merge, deletion, cross-tenant access, cache clearing,
restart, cancellation and rollback execution are outside this capability.

## Bootstrap boundary

This gate cannot deploy itself before a trusted MCP runtime already contains
it and holds the server-side Render bindings. Initial publication therefore
requires a separate, explicitly governed bootstrap. The code must never fall
back to a deploy hook, browser session, CLI credential or arbitrary Render API
route.

## Primary provider references

- Render API overview: https://render.com/docs/api
- Trigger deploy API: https://api-docs.render.com/reference/create-deploy
- Render deploy lifecycle: https://render.com/docs/deploys
- Render list deploys API: https://api-docs.render.com/reference/list-deploys
- GitHub compare API:
  https://docs.github.com/en/rest/commits/commits#compare-two-commits
