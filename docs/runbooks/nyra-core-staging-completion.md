# Nyra/Core staging completion

This runbook completes the existing `staging` environment without touching
production, Auth0, a live database, or any resource outside tenant `codexai`.
It is request-bound to two separately reviewed immutable artifacts:

- the issuer commit on `feature/nyra-staging-opaque-signer-v1`;
- the Core/MCP/Nyra commit on `feature/codex-chatgpt-staging-control-v1`.

## Fixed scope and cost ceiling

Only these changes are permitted:

1. create exactly one web service named `skinharmony-nyra-core-staging` from
   `render-nyra-core-staging.yaml`;
2. attach its 1 GB disk `nyra-core-staging-data` at `/var/data`;
3. attach one 1 GB disk named `universal-core-staging-data` at `/var/data` to
   the existing `skinharmony-universal-core-staging` service;
4. update only the existing Universal Core staging variables listed below;
5. update and deploy the existing staging Core issuer only with its reviewed
   issuer commit and dedicated remote-signer variables;
6. deploy the existing Core MCP staging service only with the reviewed
   Core/MCP/Nyra commit so the shared Gallery fallback reaches both clients.

The maximum incremental monthly cost is:

| Item | Maximum monthly increment |
| --- | ---: |
| One Starter web service | USD 7.00 |
| Nyra 1 GB persistent disk | USD 0.25 |
| Universal Core 1 GB persistent disk | USD 0.25 |
| **Total** | **USD 7.50** |

Do not create another database, service, disk, environment group, issuer, or
preview. A price or resource-count mismatch is a hard stop.

## Phase 0: request-bound release identity

- [ ] Record both exact branches, both full commit SHAs, task contract, Core
      decision, and both rollback commits in the Tenant Work Gallery.
- [ ] Require the issuer SHA to be reachable from
      `feature/nyra-staging-opaque-signer-v1` and the Core/MCP/Nyra SHA from
      `feature/codex-chatgpt-staging-control-v1`.
- [ ] Require issuer tests to be green for the issuer SHA, and repository CI,
      the Nyra runtime verifier, Universal Core tests, and Core MCP tests to be
      green for the Core/MCP/Nyra SHA.
- [ ] Do not use a branch-only deployment or `latest`.
- [ ] Keep `autoDeployTrigger=off` on the new staging service.

## Phase 1: read-only duplicate and boundary preflight

In the existing Render project and its existing `staging` environment:

- [ ] Query by exact name `skinharmony-nyra-core-staging`. The allowed count is
      zero before creation and exactly one afterward. If it already exists,
      stop and reconcile it; never create a second service.
- [ ] Confirm `skinharmony-universal-core-staging` exists exactly once and is a
      Starter web service in Oregon. Modify that service only.
- [ ] Confirm `skinharmony-core-mcp-staging` exists exactly once. It is a
      dependency/readback target, not a creation target.
- [ ] Confirm `skinharmony-core-staging-issuer` exists exactly once. It remains
      the Core staging issuer; do not create or repurpose another issuer.
- [ ] Confirm no disk named `nyra-core-staging-data` is attached elsewhere.
- [ ] Confirm Universal Core staging has no conflicting disk/mount. If it has
      durable storage already, stop and reconcile instead of attaching a
      second disk.
- [ ] Confirm each target service uses the same repository and its assigned
      exact reviewed branch/SHA pair; never substitute one artifact SHA for
      the other.
- [ ] Confirm no target URL, `fromService` reference, or environment value
      contains a production service name or origin.
- [ ] Confirm the projected delta is at most USD 7.50/month.

The create-only Blueprint intentionally omits Universal Core staging. Render
Blueprints do not safely adopt an unrelated existing service: redeclaring it
could create a duplicate owner or overwrite unrelated configuration. Apply the
Core overlay as a bounded update to its existing Render service.

## Phase 2: create Nyra in shadow

- [ ] Apply only `render-nyra-core-staging.yaml` in the existing `staging`
      environment.
- [ ] Verify Render created exactly one service and one 1 GB disk.
- [ ] Verify plan `Starter`, region `Oregon`, instance count `1`, health path
      `/healthz`, auto-deploy off, expected branch, and exact commit.
- [ ] Verify `/healthz` returns HTTP 200 with persistent storage and federation
      replay storage ready.
- [ ] Verify the public health payload contains no secret or credential value.

The initial configuration keeps operational evaluation off and Deep V2 in
`shadow`. It allows health, catalog, isolation, signature and restart tests
without granting execution authority.

## Phase 3: durable Universal Core staging overlay

Attach exactly one 1 GB disk to the existing
`skinharmony-universal-core-staging` service:

| Setting | Value |
| --- | --- |
| disk name | `universal-core-staging-data` |
| mount path | `/var/data` |
| size | `1 GB` |
| `CORE_SERVICE_STORAGE_ROOT` | `/var/data/universal-core-service` |

Keep the service Starter, Oregon, one instance, and auto-deploy off. Do not
change its service identity, database binding, Core key, owner key, or any
other existing variable.

Apply only this non-secret Deep V2 overlay:

| Core variable | Initial binding |
| --- | --- |
| `CORE_NYRA_DEEP_BRANCH_V2_ENABLED` | `true` |
| `CORE_NYRA_DEEP_BRANCH_V2_MODE` | `shadow` |
| `CORE_NYRA_DEEP_BRANCH_V2_URL` | `https://skinharmony-nyra-core-staging.onrender.com` |
| `CORE_NYRA_DEEP_BRANCH_V2_ALLOWED_ORIGIN` | `https://skinharmony-nyra-core-staging.onrender.com` |
| `CORE_NYRA_DEEP_BRANCH_V2_TENANT_ALLOWLIST` | `codexai` |
| `CORE_NYRA_DEEP_BRANCH_V2_BRANCHES` | the exact 21-branch list in the create-only Blueprint |
| `CORE_NYRA_DEEP_BRANCH_V2_EXPECTED_CATALOG_FINGERPRINT` | `c7b0b87765cac28c1fc5bd1ecf8fee5ddef97806c5da80f1a37e4bbab5d8c503` |
| `CORE_NYRA_DEEP_BRANCH_V2_EXPECTED_ROOT_BINDING_HASH` | `7231267d7ed3bee804289b21baf7246c558efd9e4f29439121ebc89458e836ec` |
| `CORE_NYRA_DEEP_BRANCH_V2_TIMEOUT_MS` | `2500` |
| `CORE_NYRA_DEEP_BRANCH_V2_CIRCUIT_FAILURE_THRESHOLD` | `3` |
| `CORE_NYRA_DEEP_BRANCH_V2_CIRCUIT_COOLDOWN_MS` | `30000` |
| `CORE_NYRA_DEEP_BRANCH_V2_SOURCE_FETCH_TIMEOUT_MS` | `5000` |
| `CORE_NYRA_DEEP_BRANCH_V2_SOURCE_MAX_BYTES` | `250000` |
| `CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED` | `false` |
| `CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_MODE` | `shadow` |
| `CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_TENANT_ALLOWLIST` | `codexai` |
| `NYRA_DEEP_RUNTIME_ENABLED` | `true` |
| `NYRA_DEEP_RUNTIME_MODE` | `active` |

The following values must use provider-native secret generation or
`fromService`; never reveal, copy, export, log, or save their values:

| Core variable | Opaque source |
| --- | --- |
| `CORE_NYRA_DEEP_BRANCH_V2_SERVICE_KEY` | `skinharmony-nyra-core-staging` / `NYRA_DEEP_BRANCH_V2_CORE_SHARED_SECRET` |
| `CORE_NYRA_DEEP_BRANCH_V2_LEDGER_SECRET` | generated once on Universal Core staging |
| `CORE_NYRA_DEEP_BRANCH_V2_MCP_REQUEST_SIGNING_SECRET` | existing `skinharmony-core-mcp-staging` variable with the same name |
| `CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_BEARER_TOKEN` | `skinharmony-core-staging-issuer` / `MCP_STAGING_NYRA_DEEP_V2_SIGNING_TOKEN` |

Do not configure `CORE_NYRA_DEEP_BRANCH_V2_ATTESTATION_PRIVATE_KEY`. The
private Ed25519 key remains confined to the existing Core staging issuer.

## Phase 4: remote signer and public verification material

The existing `skinharmony-core-staging-issuer` receives two dedicated,
Render-generated variables only:

- `MCP_STAGING_NYRA_DEEP_V2_SIGNING_SECRET`;
- `MCP_STAGING_NYRA_DEEP_V2_SIGNING_TOKEN`.

They are separate from collaboration receipts and are never read back. The
issuer provides:

- private, bearer-protected
  `POST /v1/nyra-deep-v2/sign-operational-attestation`;
- public `GET /.well-known/nyra-deep-v2-core-attestation-jwks.json`;
- fixed public key id `universal-core-nyra-v2`.

Configure Universal Core staging with:

| Core variable | Binding |
| --- | --- |
| `CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_URL` | provider-native private `hostport` reference to `skinharmony-core-staging-issuer` |
| `CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_ALLOWED_ORIGIN` | the same private issuer origin resolved by the client |
| `CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_EXPECTED_SERVICE` | `skinharmony-core-staging-issuer` |
| `CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_TARGET_COMMIT` | issuer `RENDER_GIT_COMMIT` via `fromService` |
| `CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_TIMEOUT_MS` | `2500` |
| `CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_MAX_RESPONSE_BYTES` | `393216` |

Fetch only the public JWKS document. Pin the reviewed public JWK/JWKS in
`CORE_NYRA_DEEP_BRANCH_V2_REMOTE_SIGNER_PUBLIC_JWKS`, and convert the same
public Ed25519 key to PEM for Nyra's
`NYRA_DEEP_BRANCH_V2_CORE_ATTESTATION_PUBLIC_KEYS` map under key
`universal-core-nyra-v2`. Public verification material is not a credential;
private material must never leave the issuer.

If Render cannot express the private host/origin binding without reading a
secret, stop. Do not replace it with a public bearer, copied token, shared
credential, or caller-supplied key.

Deploy order is fixed and bounded:

1. deploy the existing `skinharmony-core-staging-issuer` at the exact issuer
   SHA and verify its health plus public JWKS shape;
2. deploy the existing `skinharmony-universal-core-staging` at the exact
   Core/MCP/Nyra SHA and verify the private signer is configured;
3. deploy the existing `skinharmony-core-mcp-staging` at the same exact
   Core/MCP/Nyra SHA and verify Gallery fallback/readiness;
4. deploy the single new `skinharmony-nyra-core-staging` at that same exact
   Core/MCP/Nyra SHA.

No step creates another issuer, MCP, Core, database, environment group or
preview. A SHA mismatch is a hard stop before deployment.

## Phase 5: progressive verification and activation

Run in order and checkpoint each result in the Tenant Work Gallery:

1. Nyra build verifier and health.
2. Core health and configuration readback; no secret-bearing fields.
3. Tenant `codexai` shadow evaluation with the exact 21-branch catalog.
4. Wrong-tenant rejection and cross-tenant non-disclosure.
5. Missing token, wrong audience, wrong key id, stale attestation and malformed
   payload rejection.
6. Same nonce replay rejection.
7. Restart Nyra staging; verify the same replay remains rejected.
8. Restart Universal Core staging; verify ledger and configuration durability.
9. Verify circuit-breaker/fallback remains fail-closed when Nyra or signer is
   unavailable.
10. Verify Codex and ChatGPT clients resolve the same tenant-scoped Gallery
    work/remediation identifiers; do not change Auth0 to force this test.

Only after every prior check is green for the exact commit:

- set `NYRA_DEEP_BRANCH_V2_MODE=active` on the same Nyra service;
- set `NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED=true`;
- set `CORE_NYRA_DEEP_BRANCH_V2_MODE=active` on the same Core service;
- set `CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED=true`;
- set `CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_MODE=advisory`;
- redeploy the same exact commit and repeat steps 1-9.

Nyra remains advisory. Universal Core remains the only component that can
produce execution authority.

## Rollback without destructive cleanup

On any failure:

1. set `CORE_NYRA_DEEP_BRANCH_V2_ENABLED=false` and
   `CORE_NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED=false`;
2. set `NYRA_DEEP_BRANCH_V2_ENABLED=false` and
   `NYRA_DEEP_BRANCH_V2_OPERATIONAL_EVALUATION_ENABLED=false`;
3. redeploy the recorded previous Universal Core staging commit;
4. verify both health endpoints and Core MCP readiness;
5. preserve disks, ledger, replay records, Gallery audit and issuer audit;
6. suspend the new Nyra staging service only if the approved rollback gate
   explicitly permits it.

Do not delete the service, either disk, any issuer record, or audit evidence as
part of rollback. Cleanup requires a separate owner authorization.

## Completion evidence

Record only non-sensitive evidence:

- redacted Render identifiers;
- exact service names, region, plans and disk sizes;
- exact branch and commit;
- deploy identifiers;
- health/readiness booleans;
- catalog fingerprint/root hash;
- tenant-isolation, anti-replay and restart results;
- Core verdict/decision digest and Gallery checkpoint.

Never record environment values, credential URLs, tokens, private keys, bearer
headers, raw prompts, full chat transcripts, or cross-tenant data.
