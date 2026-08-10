# Project Scope Render Origin Resolution v1

## Purpose

Host-native deployment and rollback tickets must obtain each Render origin
from server-controlled state. A release manifest, action request, service slug,
or other caller input is never an origin authority.

Resolution is fail-closed and ordered:

1. an exact server environment-registry binding for tenant, repository,
   service and environment;
2. one verified Project Scope repository/service pair in PostgreSQL;
3. block with `origin_not_bound`.

Malformed environment registry results do not fall through. Project Scope
ambiguity, database errors, stale/future verification, a digest mismatch, an
untrusted provenance shape, or a non-`https://*.onrender.com` origin also
block. No default service-slug origin is used.

## Project Scope binding contract

The repository resource is:

- `resource_type`: `github_repository`
- `canonical_identifier`: exact `owner/repository`
- `environment`: `shared`
- `active`: `true`
- `provenance.schema_version`: `project_scope_repository_provenance_v2`
- provenance exact fields: `schema_version`, `observation_id`,
  `observation_digest`, `evidence_digest`

The Render resource is:

- `resource_type`: `render_service_origin`
- `canonical_identifier`: exact Render service ID
- `environment`: exact target environment
- `active`: `true`
- `provenance.schema_version`: `project_scope_render_origin_provenance_v2`
- provenance exact fields: `schema_version`, `observation_id`,
  `observation_digest`, `evidence_digest`

Both resources must share the authenticated tenant and the same Project ID.
Each provenance reference must resolve, in that same tenant and Project, to a
persisted `core_reality_observations` receipt. Core recomputes the observation
digest and requires exact evidence digest, observer identity and role,
`contradiction_status: NONE`, and authenticated independence of
`INDEPENDENT_SYSTEM`, `INDEPENDENT_HUMAN`, or `FORMAL`. `EXECUTOR` evidence is
not sufficient. The observation's exact source payload binds the repository;
the Render observation additionally binds service ID, environment, and strict
origin. A caller-built provenance object and internally consistent resource
digest without these authoritative observation receipts is rejected.

Both `last_verified_at` values must be no older than 24 hours by default and
must not be in the future. The bounded maximum can be configured with
`CORE_HOST_NATIVE_RENDER_SCOPE_MAX_AGE_MS`; invalid values fail service
construction rather than weakening freshness.

`resource_digest` is SHA-256 over canonical JSON with schema
`project_scope_resource_digest_v1` and these normalized fields:

`tenant_id`, `resource_id`, `project_id`, `resource_type`,
`canonical_identifier`, `environment`, `ownership`, `active`, `provenance`,
and ISO `last_verified_at`.

Use the exported `projectScopeResourceDigest` helper when the trusted readback
adapter prepares a binding. The PostgreSQL-generated `first_seen_at` and the
digest field itself are deliberately excluded.

## Verification and operation

Run the focused contract suite:

```sh
cd services/universal-core-service
node --test test/project-scope-render-origin-resolver.test.js \
  test/host-native-resolver-registry.test.js \
  test/host-native-governance.test.js \
  test/host-native-governance-adversarial.test.js
```

The health payload reports one of:

- `exact_registry_then_project_scope`
- `exact_registry_only`
- `project_scope_only`
- `fail_closed_unavailable`

The last state still supplies a blocking resolver so a manifest origin cannot
silently become authoritative.

## Rollback

Application rollback restores the previous resolver wiring; no database
migration is introduced. Project Scope rows remain additive and inert for the
old application. If only the fallback must be disabled, keep the environment
registry exact binding configured and remove or deactivate the corresponding
`render_service_origin` resource through the governed Project Scope workflow.
Do not delete or rewrite causal history.
