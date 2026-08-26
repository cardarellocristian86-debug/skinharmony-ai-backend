# Nyra Governed Multi-Host Work v1

## Decision

Nyra accepts Work continuity requests from ChatGPT, Codex and future AI
applications through one server-owned application registry. The caller cannot
select its own host identity, tenant, capabilities or authority by sending
`client_type`, `host_type`, role or owner fields.

The authorization decision is the intersection of four independent bindings:

1. authenticated human or service subject and exact tenant;
2. server-registered application identity and application capabilities;
3. Work ACL, Work revision, Intent and project/session bindings;
4. Universal Core's independent verdict for the requested operation.

An allow at one layer never implies an allow at another. Provenance,
completeness, confidence, Nyra reasoning and application registration are not
authority.

## Registered application contract

`MCP_HOST_APP_REGISTRY_JSON` is a strict `mcp_host_app_registry_v1` document.
Every enabled application has one immutable `app_id`, one authentication kind,
one host kind, one interaction mode and an explicit capability set. OAuth apps
bind by verified OAuth client id. Service applications bind by a dedicated
bearer secret and an exact tenant; their role is limited to `member`,
`reviewer` or `operator` and can never be an owner role.

Supported application capabilities are:

- `core.read`
- `core.operate`
- `core.admin`
- `work.read`
- `work.coordinate`
- `work.review`
- `work.operate`
- `work.create`
- `governed_continue`
- `host_native.delegate`
- `host_native.authorize`

The registry produces a deterministic revision digest. Agent presence,
continuation candidates and host-native audience are bound to the authenticated
`app_id`, host kind and registry revision. Changing the registry therefore
invalidates stale continuation authority instead of silently reinterpreting it.

Application capability checks and authenticated subject-role checks run before
presence registration, decision-ledger start, cache reads, generic Work
preflight, Gallery discovery and dispatch. A tenant claim without a fresh,
exact subject membership binding grants no Work access. The same application
check resolves the exact target of
`core_capability_read` and `core_capability_invoke`; catalog and semantic
discovery omit capabilities denied to the app. Direct and dynamic routing
therefore have the same authorization result.

The Core capabilities are deliberately separate from the Work capabilities.
`core.read` permits non-Work read targets, `core.operate` permits ordinary
non-Work mutations, and `core.admin` is required for Policy Registry lifecycle
operations. A Work-only application can still use the dynamic wrapper for an
exact Work target, but it cannot discover or substitute a Core target. OAuth
scope, owner/Good Mode role and a Core verdict can only further restrict these
application grants; they never enlarge them.

An unknown OAuth client remains read-only for continuity diagnosis and cannot
obtain governed continuation or host-native authority. An unknown bearer is
rejected.

## Resume path

Nyra opens the tenant-scoped Gallery before considering creation.

- One exact canonical Work match: reuse that persistent Work Identity.
- Multiple plausible operational Works: `HOLD` and request disambiguation.
- No match: report the governed bootstrap requirement; do not use the legacy
  create-or-resume shortcut and do not create a duplicate.

Resume is an idempotent internal continuity operation. It still requires both
the subject's Work permission and the registered application's corresponding
capability. It does not authorize execution or any external mutation.

## Create path

Canonical V2 Work creation is a two-phase, fail-closed operation:

1. `nyra_converse` validates the complete bounded Work specification, binds it
   to the authenticated tenant, project, session, app, host and registry
   revision, and issues a short-lived signed candidate.
2. `review_work_bootstrap` atomically reserves the durable
   `(tenant, subject, request_id)` identity, binds its canonical request digest,
   and opens an idempotent duplicate/conflict review. It does not create or
   mutate a Work.
3. `create_work` must present the same signed candidate, exact specification,
   review id/digest and a fresh owner confirmation. Universal Core verifies the
   dedicated `work.continuity.v2.create` action independently.
4. The V2 store locks the durable request mapping before its review, then holds
   the project-scoped transaction advisory lock, creates one Work, consumes the
   review, links the request to that Work and writes the canonical events
   atomically. Replicas use the same lock order.

Legacy compatibility tools cannot bypass this sequence:
`work_continuity_create` fails closed with
`canonical_work_bootstrap_v2_required`, while
`work_continuity_start_or_resume` can bind/resume an existing Work only.

Specification or task-identity substitution, tenant/app/session drift, expired
candidates, ambiguous Work resolution, stale reviews and concurrent duplicate
attempts all fail closed. Idempotent replay returns the same record even after
the consumed review TTL or a process restart. An ambiguous historical mapping
is preserved for audit and left unmapped instead of being guessed.

Continuation nonces derive the downstream Core/Work idempotency key on the
server. A replay after restart or on another replica therefore converges on
the same durable review, delegation or ticket even though the short in-process
replay cache has been lost. Creation persists the bounded Universal Core
authorization target, decision reference and deterministic receipt digest in
the Work event ledger. Before requesting new authority, an exact retry performs
a read-only lookup bound to tenant, subject, request id, canonical request
digest, review decision and the adjacent immutable creation events. When that
evidence proves that creation already committed, the server returns the same
Work with `execution_authorized=false` and the persisted receipt only as
historical evidence. It neither calls Core again nor treats an expired receipt
as current authority. Nyra reports `work_replayed` and does not claim that a
second Work was created. Missing, ambiguous or corrupted replay evidence fails
closed and resumes the ordinary governed path only when no consumed mapping
exists.

A registered service AI may review, coordinate or operate only to the extent
allowed by both its role and application capabilities. It cannot satisfy the
owner confirmation needed to create a Work. A future service-to-service create
flow would require a distinct, explicit Core delegation contract; it must not
be inferred from `work.create` alone.

## Nyra interaction

A registered conversational app sees two direct tools:

- `nyra_converse`, for Nyra's diagnosis, resume and signed proposal;
- `nyra_governed_continue`, for the exact next governed phase.

The second tool is deliberately absent from dynamic capability discovery. Nyra
must name the problem, required evidence, responsible actor and exact next
operation. It never reports that a Work, delegation, ticket, merge, deploy or
publish occurred unless the corresponding durable readback exists.

## Authority boundary

The invariant remains:

`Context -> Nyra reasoning -> Universal Core authority -> bounded host execution -> evidence`

Application registration allows a host to participate in that protocol; it
does not make the application an authority. Host sandbox and approval policy
remain additive and cannot be bypassed by Nyra or Core.

## Activation and readiness

The path stays code-dark unless all of the following are true:

- `NYRA_GOVERNED_CONTINUE_ENABLED=true`;
- `HOST_NATIVE_AGENT_PROTOCOL_ENABLED=true`;
- a valid non-empty `MCP_HOST_APP_REGISTRY_JSON` is loaded;
- `NYRA_GOVERNED_CONTINUE_SIGNING_SECRET` contains at least 32 independent
  UTF-8 bytes and is not reused by another trust domain;
- `AGENT_PRESENCE_SIGNATURE_VERSION=v2`, after the bounded v1 lease/ticket
  drain window has completed;
- Work Continuity V2 persistence and the required Core routes are ready.

Readiness exposes only the registry revision, registered app count and boolean
configuration state. It never exposes bearer values or credential environment
names.

Rollout is two-step and backward compatible. Deploy the code first with the
default presence version `v1`; existing session fingerprints, leases and
tickets remain stable. Stop minting long-lived v1 authority, wait for its
bounded TTL to expire, then set `AGENT_PRESENCE_SIGNATURE_VERSION=v2` and
enable governed continuation. V2 binds presence to app id, host kind and
registry revision. Rolling back the setting before issuing v2 authority is
non-destructive.

Production-to-staging routing uses only the signed
`environment_delegation_v3` envelope. V3 binds the JSON-RPC method and request
id, direct tool, exact dynamic target, canonical forwarded arguments and MCP
session id. It preserves the exact authenticated host principal, fresh tenant
membership and an already-verified owner confirmation as request-bound
digests; staging never consumes the browser assertion a second time. The
envelope is single-use, expires within 30 seconds and its nonce is claimed in
the shared PostgreSQL store, so replicas share one replay barrier. V1/V2 are
rejected. Production accepts only one credential-free HTTPS staging origin;
redirects, URL drift, non-JSON responses, responses over the streaming bound
and timeouts fail closed. Readiness verifies the distributed nonce schema.
Deploy and verify the staging receiver before enabling the production sender.
Rollback disables the sender first, then the receiver after in-flight
envelopes have expired.

The additive `tenant_work_bootstrap_request` migration runs code-dark before
enforcement. Its backfill adopts only unambiguous historical review bindings;
it never deletes, rewrites or merges existing Work. Conflicting historical
digests or consumed Work identities cause a fail-closed operator-visible gap.

Legacy `CODEX_BEARER_KEYS` remain transport-compatible but do not receive the
new all-capability host principal by default. Migrate Codex to an exact enabled
registry app (`app_id=codex`, `client_type=codex`,
`host_kind=codex_native`) and a dedicated bearer environment variable, then
remove the same secret from `CODEX_BEARER_KEYS`. The temporary
`MCP_LEGACY_CODEX_HOST_PRINCIPAL_ENABLED=true` switch is explicit and exposed
in readiness; it must not be the steady state.

A normal registered Codex app should receive `work.read`, the specific Work
mutation capabilities it needs, plus `core.read`/`core.operate` only when it
uses those non-Work surfaces. `core.admin` is a separate policy-operator grant
and is not implied by Good Mode, `owner:root`, OAuth scopes or
`core.operate`.

## Current bounded gap

The multi-host Work kernel supports registered future applications for
conversation, resume, review and owner-governed creation. Native specialist
assignment and standing release execution still use the currently implemented
ChatGPT/Codex host receipt schemas. A new host must not receive those execution
capabilities until its native assignment, verifier independence, ticket
readback and host-policy attestation contracts are implemented and verified by
Universal Core.
