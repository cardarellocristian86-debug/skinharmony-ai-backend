# Universal Core MCP Gateway

Remote MCP endpoint compatible with existing scoped Codex bearer tokens and ChatGPT OAuth 2.1 clients backed by Auth0. Authentication never accepts an owner-confirmation field and never derives tenant access from client input.

The repository path and package name retain the historical SkinHarmony name for deployment compatibility, but the gateway contract is horizontal. MCP tools do not expose a `domain_pack` selector and never forward one supplied out of schema. Suite, SmartDesk and Analyzer packs are resolved only from the authenticated server-side Core key metadata.

## Stable dynamic connector surface

Version `0.17.0` keeps the connector registration stable while making Nyra the
only conversational front door for authenticated conversational clients. An
unregistered/read-only ChatGPT OAuth client sees only `nyra_converse`; a
server-registered conversational application with the exact
`governed_continue` capability sees `nyra_converse` plus the direct
`nyra_governed_continue` tool. It no longer has to assemble an operational
answer by calling a preflight, catalog, branch registry or self-model read.
Codex and registered native-tooling clients retain their bounded native
surface. Internal capabilities can still evolve behind the governed registry
without expanding the conversational surface.

An already-open ChatGPT session can retain stale read descriptors. The gateway
translates the supported stale descriptors into Nyra's narrow input contract
after schema validation and adds only a server-owned, non-serializable routing
hint. Raw catalog arguments, tenant fields and caller authority do not cross
that boundary. `core_health` remains a non-conversational compatibility read;
mutating descriptors are never translated.

### Conversational Nyra

`nyra_converse` is the read-only conversational entrypoint for a connected
ChatGPT, Codex or compatible MCP host. ChatGPT invokes it directly. The handler
performs its own authenticated Work preflight, resumes one unambiguous tenant
Work when continuity policy permits and recalls only bounded memory context.
A pure resume can reuse the current persisted dialogue. Every new technical or
consequential request receives a fresh preflight and Core interpretation so an
old checkpoint cannot monopolize the conversation. Caller arguments cannot
select a tenant, owner, provider, model, authorization or preflight envelope.

The response contains `nyra_orchestration_directive_v1`. Nyra names the
problem, lists machine-readable needs, orders the next actions by actor and
states what the authenticated connected AI may continue locally. A bounded Work Continuity V2 projection
contributes only identity/revision bindings, aggregate criteria/task/evidence
counts, the next required task and deterministic digests; raw evidence and task
metadata are not returned. The directive can also prepare a revision-bound
`core_ticket_request_candidate_v1`, but it never issues a ticket or turns
provenance, completeness or confidence into authority.

`COMPLETE` requires `tenant_work_closure_verification_v1` from the V2 store.
That projection rechecks the exact tenant/Work terminal state, required tasks,
independently verified evidence, signed Core Join, closure receipt, canonical
final report and hash-bound terminal event. Merely well-formed receipt digests
are insufficient. A missing, legacy-unprojected or inconsistent artifact stays
`INSUFFICIENT_CONTEXT` and exposes no raw closure data. Replaying the governed
finalization of a pre-existing valid closure deterministically canonicalizes
only its derived report digest and appends the missing V2 terminal event in the
same transaction; raw report/evidence data is not rewritten. Any failed
cross-check rolls the forward projection back.

The MCP does not generate language with a server-side provider. It returns a
small host-response contract that tells the already-connected host model to
answer directly in first person as Nyra and in the user's language. All
operational fields are server-validated, bounded and tied to the authenticated
Work; false completion claims from upstream text are quarantined. Risk, Work
state, disposition and Core runtime use closed enums. Raw memory, raw evidence,
customer records, secrets and provider credentials are not returned.

Fresh interpretation fails closed unless the authenticated Work preflight and
the Nyra/Core interpretation report `ok=true` for the exact tenant. Preflight
must be `ready_read_only`; unavailable, malformed and non-ready states are
rejected. Core runtime must identify a valid V0/V1/V2 route and authority, an
`active`, `shadow` or `off` mode, and `execution_allowed=false`. Every turn fixes
`execution_authorized=false`, `external_action_authorized=false`,
`provider_execution=false`, `provider_api_key_required=false` and
`server_model_calls=0`. A Core block on an external action does not erase safe
local analysis, tests or evidence collection: Nyra can return
`PREPARE_BOUNDED_WORK` with explicit limits. Deploy, live/production release,
distribution, publish, push and other side effects still need a separate
governed action, independent Core verification and every host approval. Merge
is always represented as `MANUAL_ONLY` for the owner; Nyra and the connected AI
do not perform it through this conversational contract.

Dynamic routing never accepts a URL, HTTP method, tenant id, credential or
arbitrary handler name. Every capability must exist in the server registry,
match its current catalog revision and pass its original schema and scopes.
The authenticated app capability is checked before any cache, preflight or
dispatch; dynamic catalog/read/invoke resolve and filter the exact target with
the same policy as a direct call.
Reads and mutations are separate. Owner-directed mutations require a fresh,
request-bound owner confirmation, an idempotency key, a Universal Core verdict
and the target handler's own controls. Narrow internal coordination can proceed
without repeated owner confirmation only when it matches the server-defined
tenant, target, idempotency and no-side-effect contract or a previously
owner-confirmed bounded delegation. The host-native continuity protocol is
catalog-backed. The compact native-tooling surface contains eleven tools; a
registered conversational host receives exactly the two Nyra tools described
above, and the continuation tool is not dynamically discoverable. There are no
provider onboarding or execution tools. Retired portal paths return `410 Gone`
and do not read credentials; they are never a dependency of host-native work.

### Registered ChatGPT and future-AI Work participation

`MCP_HOST_APP_REGISTRY_JSON` binds a verified OAuth client or dedicated service
bearer to one `app_id`, `host_kind`, interaction mode and explicit capability
set. Caller `client_type`, `host_type`, tenant, role and owner fields are never
accepted as this binding. Effective permission is the intersection of the
authenticated subject, tenant membership/owner state, registered application
capabilities, Work ACL and the independent Universal Core verdict.

Nyra always opens the tenant Gallery before creation. One exact canonical Work
is resumed; ambiguity produces `HOLD`; absence produces a signed, bounded
bootstrap candidate. Canonical creation then requires an idempotent duplicate
review followed by the same candidate and specification, a fresh owner
confirmation, the dedicated Core `work.continuity.v2.create` verdict and a
durable `(tenant, subject, request_id)` mapping plus transactional
project-scoped duplicate recheck. Exact replay after process restart or review
expiry returns the same Work and Nyra reports it as a replay, not a new
creation. The replay is a read-only, request-bound durable readback with
`execution_authorized=false`; its persisted Core receipt is historical evidence,
not renewed authority. Ambiguous historical mappings fail closed. The legacy create-or-resume
path is not used for this canonical V2 bootstrap:
`work_continuity_create` fails closed and
`work_continuity_start_or_resume` is resume-only.

See
[`docs/architecture/nyra-governed-multi-host-work-v1.md`](../../docs/architecture/nyra-governed-multi-host-work-v1.md)
for the complete authorization and failure contract.

Example registry shape (OAuth client ids are deployment-specific):

```json
{
  "schema_version": "mcp_host_app_registry_v1",
  "apps": [
    {
      "app_id": "chatgpt_prod",
      "auth_kind": "oauth",
      "oauth_client_id": "<verified-chatgpt-oauth-client-id>",
      "host_kind": "chatgpt_native",
      "client_type": "chatgpt",
      "interaction_mode": "nyra_conversational",
      "capabilities": [
        "work.read",
        "work.coordinate",
        "work.review",
        "work.operate",
        "work.create",
        "governed_continue",
        "host_native.delegate",
        "host_native.authorize"
      ],
      "enabled": true
    },
    {
      "app_id": "codex",
      "auth_kind": "bearer",
      "credential_env": "MCP_HOST_APP_TOKEN_CODEX",
      "tenant_id": "tenant-a",
      "service_role": "operator",
      "host_kind": "codex_native",
      "client_type": "codex",
      "interaction_mode": "native_tooling",
      "capabilities": [
        "core.read",
        "core.operate",
        "work.read",
        "work.coordinate",
        "work.review",
        "work.operate",
        "host_native.delegate",
        "host_native.authorize"
      ],
      "scopes": ["core:read", "core:govern"],
      "enabled": true
    },
    {
      "app_id": "future_ai",
      "auth_kind": "oauth",
      "oauth_client_id": "<verified-future-ai-oauth-client-id>",
      "host_kind": "future_ai_native",
      "client_type": "api_agent",
      "interaction_mode": "nyra_conversational",
      "capabilities": [
        "work.read",
        "work.coordinate",
        "work.review",
        "work.create",
        "governed_continue"
      ],
      "enabled": true
    }
  ]
}
```

An app capability is only an upper bound. `work.create` still requires the
authenticated subject to be the bound owner, a fresh request confirmation and
the independent Core create verdict. A service bearer app is configured with a
dedicated `credential_env`, exact `tenant_id` and non-owner `service_role`; it
cannot become owner through this registry.
Enabled bearer values must be unique and cannot equal a Codex, Core, gateway,
Suite or signing secret. Configuration fails at startup on any cross-trust
collision without logging the credential.

`core.read`, `core.operate` and `core.admin` are independent from the Work
grants. They respectively bound non-Work reads, ordinary non-Work mutations
and Policy Registry lifecycle administration. A Work-only app may use the
dynamic wrappers for an exact permitted Work target without receiving a Core
grant. Registered Good Mode/owner roles and OAuth scopes do not expand the
configured app scopes or capabilities. Keep `core.admin` out of ordinary
ChatGPT/Codex registrations unless the app is explicitly the policy operator.

## Governed Continuity Fabric

The Governed Continuity Fabric turns the first complete work request into a
tenant-bound Intent Anchor and carries the same `work_id` through planning,
host-native specialist work, verification, governed side effects, live checks
and evidence-backed closure. It is designed for ChatGPT and Codex hosts that
already provide native subagents: the host creates those subagents directly and
no OpenAI API key is required or read by this protocol.

Nyra interprets the request, supervises bounded specialist work and asks for
corrections. Universal Core remains the policy and authorization authority.
Specialists cannot authorize themselves, and a reviewer that shares the same
OAuth principal is an independent quality check, not an independent security
principal. Commit, push, merge and deploy still require an exact, request-bound
Core authorization plus every approval required by the ChatGPT/Codex host.
OAuth owners explicitly confirm issuance or renewal of the narrow delegation.
The exact configured Codex Good Mode profile may initiate that same signed
delegation without a repeated form confirmation; it cannot bypass a Core ticket
or any approval enforced by the ChatGPT/Codex host. An action that matches the
delegation exactly can then use a one-time Core ticket without asking the owner
to interpret and reconfirm every underlying command. Drift, expiry, revocation,
hard blocks and host policy still stop execution.

Builder and verifier receipts must come from distinct bound MCP/native transport
sessions. Their fingerprints and presence signatures prevent session reuse and
impersonation, but separate sessions under one OAuth principal are not
independent cryptographic identities. The closure attestation signed by MCP is a
service-to-service integrity proof over the persisted evaluation and evidence;
it does not turn those sessions into a security quorum.

The fabric has six durable records:

- an immutable, redacted Intent Anchor with completion criteria;
- a Work Atlas that indexes the relevant repository cone, components, symbols,
  tests, CI and deploy services;
- append-only changes, checkpoints and handoffs under one canonical `work_id`;
- an Incident Runbook indexed by failure fingerprint and verified resolution;
- an append-only signed Core Join that binds the local plan/evaluation to the
  exact release intent before `release_ready`;
- a final closure receipt that records tests, independent review, exact commit and
  deployment evidence, rollback readiness and live verification.

Interrupted work resumes from the last verified checkpoint. It does not rescan
the complete repository when the Work Atlas identifies the affected cone, and
it does not mark the overall request complete merely because one tool call or
worker completed. Iterations, specialist fan-out and parallelism remain bounded.

Runtime activation is fail-closed. The MCP recognizes
`WORK_CONTINUITY_AUTO_CAPTURE_ENABLED`, `HOST_NATIVE_AGENT_PROTOCOL_ENABLED`
and `NYRA_GOVERNED_CONTINUE_ENABLED`; all default to disabled in code and must
be enabled explicitly by deployment policy. Governed continuation additionally
requires a valid `MCP_HOST_APP_REGISTRY_JSON` and an independent
`NYRA_GOVERNED_CONTINUE_SIGNING_SECRET`, plus
`AGENT_PRESENCE_SIGNATURE_VERSION=v2`. Deploy with the default `v1` first to
preserve in-flight fingerprints, leases and tickets; drain their bounded TTL,
then switch to v2 and enable continuation. Universal Core independently gates
its host-native routes with `CORE_HOST_NATIVE_GOVERNANCE_ENABLED`, also disabled
by default, and signs bounded authority records with the dedicated
`CORE_HOST_NATIVE_SIGNING_SECRET`. None of these settings enables off-host model
execution or bypasses Core and host approvals.

The host-native path does not read an external-model key or make a server-side
model call. It returns `provider_execution=false`,
`provider_api_key_required=false` and `server_model_calls=0`; CI verifies those
exact contract values and zero outbound model fetches. This is the production
contract, not a dry-run or a best-effort convention.

### Production trust and database bindings

The baseline host-native gateway uses four independent shared secrets.
Governed multi-host continuation adds a fifth independent signing secret. Each
must contain at least 32 UTF-8 bytes; a shorter, missing or cross-purpose reused
value is unavailable and readiness fails closed when its feature is enabled.

| Variable | Exact use | Render binding |
| --- | --- | --- |
| `CORE_MCP_TENANT_GATEWAY_KEY` | MCP-to-Core bearer authentication for tenant-gateway routes only | Generated on Core MCP; referenced by Universal Core with `fromService` |
| `CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET` | HMAC for `x-sh-tenant-context` only | Generated on Core MCP; referenced by Universal Core with `fromService` |
| `CORE_OWNER_CONTEXT_SIGNING_SECRET` | Request-bound OAuth-owner or exact configured Codex Good Mode context for host-native delegation/revocation | Generated on Core MCP; referenced by Universal Core with `fromService` |
| `DTT_AGENT_IDENTITY_SIGNING_SECRET` | DTT identity receipts, native assignment capabilities and closure attestations | Generated on Core MCP; referenced by Universal Core with `fromService` |
| `NYRA_GOVERNED_CONTINUE_SIGNING_SECRET` | Short-lived app/session/Work-bound Nyra continuation and Work-bootstrap candidates | Generated on Core MCP only; never shared with clients |

There is no cross-purpose fallback: tenant context never uses the owner secret,
host-native owner context never uses the gateway, and assignment/closure signing
never uses `AGENT_SIGNATURE_SECRET`, owner context or a development literal.
`CORE_HOST_NATIVE_SIGNING_SECRET` is a separate Core-only value for Core
delegation, action-ticket and final receipt records and is never copied to MCP.
Tests and local development must provide explicit fixture values; they do not
receive a weaker implicit path.

Production persistence uses one managed PostgreSQL 16 database. Core MCP reads
the canonical connection from `DATABASE_URL`. Universal Core receives the same
connection as `GOVERNED_AGENT_DATABASE_URL` through a Render `fromService`
reference to MCP's `DATABASE_URL`; each service retains tenant-scoped,
service-owned tables. `WORK_CONTINUITY_DATABASE_URL` is reserved for the
isolated CI PostgreSQL 16 job and must not be configured as a second production
database.

### Initial bootstrap and secret rotation

Initial secret bootstrap requires an authenticated owner to authorize the exact
purpose and environment and a ChatGPT/Codex host or Render administrator to
perform the control-plane write. The host provisions four independent current
values, binds both services through Render, deploys them and verifies non-secret
readiness plus the bounded host-native contract. Nyra and Core can diagnose a
missing binding, but cannot bootstrap their own authority.

Rotate each secret independently through `current → candidate → promote`.
`current` stays active while the owner authorizes scope and rollback.
`candidate` is a new value of at least 32 bytes held only by Render and bound to
the producer/verifier pair for coordinated readiness and contract checks.
`promote` makes it current only after both deployments and readback pass; the
old value is revoked after the rollback window. The runtime accepts one active
value per variable, so this is a coordinated service promotion, not a hidden
dual-key grace period. Candidate failure preserves current or activates the
recorded rollback, and no rotation may reuse one trust-domain secret as another.

The project-scoped `.codex/config.toml` enables native agents with at most three
concurrent session threads, selects the bounded `workspace-write` sandbox and
keeps approval interactive with `on-request`. `auto_review` swaps the reviewer
for eligible approval prompts; it does not expand network access, filesystem
roots or the sandbox. Organization-managed Codex policy always takes
precedence.

See
[`docs/architecture/governed-continuity-fabric-v1.md`](../../docs/architecture/governed-continuity-fabric-v1.md)
for the authority model, state machine, host protocol, data ownership, failure
semantics and deployment boundary.

## Authentication

## ChatGPT and Codex native onboarding

Users install this connector in ChatGPT and authenticate with their own account;
they never need access to Render or an external-model API key. On first use,
Nyra plans and coordinates while Universal Core remains the final safety
authority. Native ChatGPT/Codex subagents are created by the host directly; the
MCP never accepts model credentials in a chat message, tool argument or browser
form.

### What users need to know

1. **Install and sign in.** Add the connector in ChatGPT and complete OAuth. This binds the session to the correct tenant; Render is never visible to the user.
2. **Describe the job.** State the objective, desired result, constraints, deadline and whether it is research, analysis or planning. Nyra and Core prepare a bounded plan before work begins.
3. **Build agents safely.** An agent is a bounded role in a governed plan, not an autonomous account. ChatGPT or Codex creates specialists with its native subagent capability. The plan has explicit dependencies, acceptance criteria, limits and a deadline; specialist fan-out remains three or fewer, with at most two active in parallel.
4. **What is automatic.** The enabled continuity fabric anchors or resumes the initial request, exposes the tenant Work Gallery so authenticated users and chats can join the same work without duplication, recalls tenant memory, aggregates the bounded tenant/project Work Atlas, records Core-confirmed Git deltas and indexes exact candidates for connector failures, lease expiry, failed tests, verifier dissent, correction requests, closure gaps and final readback errors. Gallery branches use bounded participant leases and structured handoffs; incident candidates remain unusable until independent verification.
5. **What the root host must drive.** ChatGPT/Codex selects the relevant Atlas cone, requests and materializes the bounded plan, submits assignment/result receipts, checkpoints blockers and requests review and closure under the same `work_id`. The connector cannot manufacture a native subagent or approve the host's local command prompt. Browser or tool side effects, messages to customers, payments, publishing, deployment and data deletion require their separate Core verdict, bounded owner authority and host approval.
6. **Host-native multi-agent mode.** When the user asks to work in multi-agent mode, the root ChatGPT/Codex agent requests a bounded host-native plan and creates specialists directly with the host's built-in capability. The verified contract fixes `provider_execution=false`; Nyra supervises, Core governs, and the root host remains responsible for spawning, collecting and submitting specialist results.
7. **Retired browser paths.** `/connect/openai`, `/agents` and `/mobile/agents` return `410 Gone`. They do not initiate credential setup, model execution or a parallel agent system; continue the work in the native ChatGPT/Codex session instead.
8. **Research and privacy.** Research is planned first, then evidence is sourced and reviewed through the host-managed browser. Do not send secrets, raw customer records or full pages to the connector.

### GitHub App onboarding for customer repositories

The GitHub integration is installation-scoped, not account-scoped. A customer
never receives the GitHub App private key, the owner installation id, a Render
credential or access to the Nyra/Universal Core source repository.

For each tenant that wants governed GitHub automation:

1. the customer opens the GitHub App installation page while authenticated to
   their own GitHub account or organization;
2. the customer selects only the repositories that Nyra may operate on;
3. GitHub creates a distinct installation id for that customer installation;
4. an administrator binds that installation id, exact repository allowlist and
   tenant id in the server-side credential registry;
5. ChatGPT, Codex or another MCP-compatible AI authenticates to the customer's
   tenant and requests work through MCP;
6. Universal Core validates tenant, Work Identity, persisted Intent, repository,
   branch, file cone and action, then issues a bounded one-use ticket;
7. the separate GitHub worker exchanges its private App key for a short-lived
   installation token and executes only the authorized ticket.

The client never supplies `tenant_id`, `installation_id`, repository bindings,
provider URLs, tokens or private keys in an MCP tool call. Those values are
resolved from authenticated server-side configuration. An installation bound
to one tenant must never authorize another tenant, and an installation for a
customer repository must never authorize the proprietary Nyra/Core repository.
Removing the GitHub App installation immediately removes the customer's
provider access; Core revocation and emergency-stop controls remain independent.

The private key belongs only in the protected environment of the dedicated
GitHub worker. It must not be committed, copied into MCP responses, exposed to
AI agents or shared with a customer. MCP exposes governed capabilities, not the
credential itself. See
[`docs/runbooks/github-app-tenant-onboarding.md`](../../docs/runbooks/github-app-tenant-onboarding.md).

- Codex: preferred steady state is a dedicated bearer entry in
  `MCP_HOST_APP_REGISTRY_JSON` with `app_id=codex`, `client_type=codex` and
  `host_kind=codex_native`. Legacy `CODEX_BEARER_KEYS` remain transport
  compatible, but the all-capability legacy host principal is code-dark unless
  `MCP_LEGACY_CODEX_HOST_PRINCIPAL_ENABLED=true` during a bounded migration.
- ChatGPT: Auth0 RS256 access token verified against JWKS, exact issuer, audience, expiry and optional `nbf`.
- OAuth discovery: `/.well-known/oauth-protected-resource` and the RFC 9728 path-specific `/.well-known/oauth-protected-resource/mcp` advertise the protected resource. The compatibility authorization-server endpoint advertises authorization-code flow with PKCE `S256` only.
- MCP tools expose OAuth `securitySchemes`, minimum per-tool scopes, titles, descriptions and read-only/idempotent impact annotations. Preconfigured Codex bearer tokens remain supported at the transport layer without advertising an unsupported tool-level scheme.

Required configuration:

```text
MCP_PUBLIC_URL=https://mcp.example.com
AUTH0_ISSUER=https://YOUR_TENANT.auth0.com
AUTH0_AUDIENCE=https://mcp.example.com/mcp
# Strict server-owned registry for ChatGPT, Codex and future AI applications.
# JSON references bearer environment-variable names; it never contains secrets.
MCP_HOST_APP_REGISTRY_JSON=<mcp_host_app_registry_v1 JSON>
MCP_HOST_APP_TOKEN_CODEX=<dedicated registered Codex bearer>
# Temporary migration switch only. Disable after registered Codex cutover.
MCP_LEGACY_CODEX_HOST_PRINCIPAL_ENABLED=true
CODEX_BEARER_KEYS=<comma-separated secrets>
CODEX_BEARER_SCOPES=core:read,core:govern
MCP_SUPPORTED_SCOPES=core:read,core:govern
UNIVERSAL_CORE_URL=https://your-universal-core.example.com
UNIVERSAL_CORE_KEY=<server-side scoped Core key>
UNIVERSAL_CORE_KEYS_JSON={"tenant-a":"server-side-key-a","tenant-b":"server-side-key-b"}
SUITE_CONTROL_PLANE_URL=https://skinharmony-suite-control.onrender.com
SUITE_CONTROL_PLANE_KEYS_JSON={"tenant-a":"server-side-suite-key-a","tenant-b":"server-side-suite-key-b"}
SUITE_CONTROL_PLANE_TIMEOUT_MS=8000
SUITE_CONTROL_PLANE_CACHE_TTL_MS=5000
MCP_CHATGPT_TENANT_ID=tenant-a
CORE_MCP_KEY=<server-side scoped Core key for MCP_CHATGPT_TENANT_ID>
# Four independent values, each at least 32 UTF-8 bytes. Never reuse them.
CORE_MCP_TENANT_GATEWAY_KEY=<tenant-gateway bearer shared with Universal Core>
CORE_MCP_TENANT_CONTEXT_SIGNING_SECRET=<x-sh-tenant-context HMAC shared with Universal Core>
CORE_OWNER_CONTEXT_SIGNING_SECRET=<OAuth-owner assertion HMAC shared with Universal Core>
DTT_AGENT_IDENTITY_SIGNING_SECRET=<DTT, assignment and closure HMAC shared with Universal Core>
MCP_DEFAULT_TENANT_ID=owner-private
MCP_TENANT_CLAIM=https://skinharmony.it/tenant_id
AUTH0_OWNER_CONFIRMATION_MAX_AGE_SECONDS=300
SHARED_WORK_MEMORY_ROOT=/app/shared-work-memory
AGENT_WORKSPACE_ROOT=/var/data/skinharmony-core-mcp
# Roll out v1 first, drain bounded tickets/leases, then promote to v2.
AGENT_PRESENCE_SIGNATURE_VERSION=v1
NYRA_GOVERNED_CONTINUE_ENABLED=false
NYRA_GOVERNED_CONTINUE_SIGNING_SECRET=<independent random secret, at least 32 bytes>
# Deploy the staging receiver first; enable the production sender only after
# v3 exact request/session binding, durable nonce replay denial and owner
# confirmation delegation are verified.
MCP_ENVIRONMENT_DELEGATION_RECEIVER_ENABLED=false
MCP_ENVIRONMENT_ROUTING_REQUIRED=false
MCP_STAGING_MCP_URL=https://staging-mcp.example.com
MCP_ENVIRONMENT_DELEGATION_KEY=<shared production-to-staging HMAC, at least 32 bytes>
MEMORY_FABRIC_ROOT=/var/data/skinharmony-core-mcp
MEMORY_RETENTION_DAYS=365
MEMORY_PERSONAL_RETENTION_DAYS=90
RESEARCH_CORTEX_ROOT=/var/data/skinharmony-core-mcp
RESEARCH_RETENTION_DAYS=365
DATABASE_URL=<canonical managed PostgreSQL 16 connection>
DATABASE_SSL=true
# Universal Core only: Render fromService reference to MCP DATABASE_URL.
GOVERNED_AGENT_DATABASE_URL=<same canonical PostgreSQL 16 connection>
# CI only; do not configure as a second production connection.
WORK_CONTINUITY_DATABASE_URL=<isolated PostgreSQL 16 CI connection>
WORK_CONTINUITY_AUTO_CAPTURE_ENABLED=false
HOST_NATIVE_AGENT_PROTOCOL_ENABLED=false
# Universal Core only; use an independent random value of at least 32 bytes.
CORE_HOST_NATIVE_GOVERNANCE_ENABLED=false
CORE_HOST_NATIVE_SIGNING_SECRET=<dedicated server-side signing secret>
# Universal Core only. Registry JSON contains bindings, never a credential.
CORE_HOST_NATIVE_GITHUB_CREDENTIAL_REGISTRY_JSON=<optional exact private tenant/repository bindings>
CORE_HOST_NATIVE_GITHUB_TOKEN_<BINDING>=<server-only GitHub credential>
CORE_HOST_NATIVE_RENDER_ORIGIN_REGISTRY_JSON=<optional exact tenant/repository/service origins>
CORE_HOST_NATIVE_REQUIRED_CHECKS_REGISTRY_JSON=<exact per-tenant repository/branch CI provenance bindings>
NYRA_GOD_MODE_ENABLED=false
NYRA_GOD_MODE_TENANT_IDS=owner-private,codexai
NYRA_GOD_MODE_SUBJECTS=<comma-separated Auth0 subject ids>
NYRA_GOD_MODE_CODEX_ENABLED=false
NYRA_GOD_MODE_EMERGENCY_STOP=false
```

`CORE_BASE_URL` is also accepted as a compatibility fallback when
`UNIVERSAL_CORE_URL` is not set.

Configure the Auth0 application as a public OAuth client for ChatGPT, allow only approved callback URLs, enable authorization code with PKCE, and disable password/implicit grants. Do not commit secrets. Auth0 must issue RS256 access tokens containing `scope` or `permissions`. The MCP merges both claims when Auth0 emits requested OAuth scopes in `scope` and RBAC API permissions in `permissions`; duplicate values are removed before per-tool authorization.

## Retired provider paths

The historical `/connect/openai`, `/agents` and `/mobile/agents` routes are
deliberately retained only as terminal compatibility responses. They uniformly
return `410 Gone`, with no redirect, setup form, OAuth browser flow, credential
write or model execution. The MCP does not provision any replacement portal.
Use the authenticated native ChatGPT/Codex session and the governed
host-native protocol for specialist work.

## WordPress Suite Cockpit adapter

Version `0.11.0` adds a tool-only adapter for the tenant-scoped Suite Control
Plane. It exposes `suite_status`, `suite_cockpit_360`,
`suite_branch_catalog`, `suite_branch_read`, `suite_decision_preview`,
`suite_runbook_catalog` and `suite_runbook_preview`. No Suite dispatch,
request, write or execution tool is registered.

The adapter never accepts `tenant_id`, provider URLs or credentials in tool
input. It derives the tenant from the authenticated MCP identity and selects a
server-side key from `SUITE_CONTROL_PLANE_KEYS_JSON`. The compatibility pair
`SUITE_CONTROL_PLANE_API_KEY` plus `SUITE_CONTROL_PLANE_TENANT_ID` may be used
for one tenant only; configuring the key without its tenant fails startup.
When the Auth0 tenant id and Suite tenant id intentionally differ, bind them
explicitly, for example
`{"codexai":{"tenant_id":"skinharmony-suite","secret":"server-side-key"}}`.

Read tools retain the existing `core:read` OAuth scope. The two computational
previews use the existing `core:govern` scope even though their MCP annotation
remains read-only and they cannot execute: this avoids changing the deployed
Auth0 consent surface while keeping preview access more restrictive. The
server-to-server Suite key independently requires `suite:read` or
`suite:preview` at the Control Plane.

`search` and `fetch` keep the exact Company Knowledge input signatures
`{query}` and `{id}`. Agent presence is derived from the MCP transport and is
not added to those two public schemas.

## Nyra God Mode (`owner_root`)

God Mode is a server-side owner profile, not a client-provided flag. It activates
only when all of these checks pass: the feature is enabled, the emergency stop is
off, the signed token belongs to the explicit `NYRA_GOD_MODE_TENANT_IDS` allowlist, and the verified
Auth0 subject/OAuth client (or the separately enabled Codex delegate) is on the
server allowlist. A matching identity receives `owner:root` plus the configured
server scopes and sends a verified `owner_context` to Universal Core.

The profile automatically satisfies ordinary owner-confirmation fields for MCP
work, while Core hard blocks, tenant isolation, secret redaction and audit remain
enforced. Setting `NYRA_GOD_MODE_EMERGENCY_STOP=true` removes `owner_root` on the
next request without rotating every credential. God Mode grants every capability
implemented and advertised by this gateway; it does not fabricate access to an
external system that has no configured connector or server-side credential.

## Local verification

```bash
npm test --prefix services/skinharmony-core-mcp
MCP_PUBLIC_URL=http://localhost:8790 CODEX_BEARER_KEYS=local-test-key npm start --prefix services/skinharmony-core-mcp
```

The CI deployment-parity path uses the repository root, matching the Render
Blueprint commands:

```bash
npm ci
npm run core:service:test
npm run core:mcp:test
```

Root `npm ci` runs the governed Rust extractor build through `postinstall`; do
not invoke the same build script a second time in the parity job.

The CI-only PostgreSQL 16 job sets `WORK_CONTINUITY_DATABASE_URL` to its
ephemeral database and runs
`test/work-continuity-postgres16.test.js`. It verifies PostgreSQL 16 itself,
schema initialization, immutable Intent persistence, recursive Atlas depth,
cross-work node/edge provenance, distinct persisted builder/verifier sessions,
append-only event-chain provenance and evidence-backed closure evaluation.
Production does not use that override; it uses the shared
`DATABASE_URL`/`GOVERNED_AGENT_DATABASE_URL` binding described above.

For MCP Inspector, connect to `http://localhost:8790/mcp` and set `Authorization: Bearer local-test-key`. OAuth discovery can be validated without Auth0 credentials; an end-to-end ChatGPT login requires a separately configured Auth0 development tenant.

## Tenant agent workspace

Agent collaboration is fail-closed and opt-in. The collaboration tools are not
advertised until `AGENT_WORKSPACE_ROOT` is configured. In production this path
must point to persistent storage; do not point it at the deploy filesystem.

Available collaboration capabilities:

- logical shared folders and versioned documents;
- optimistic task creation, claim and status updates;
- registered agent heartbeats and tenant-scoped discovery;
- direct or broadcast agent messages with acknowledgements;
- atomic state updates, idempotency keys and a bounded audit trail.

All collaboration state is stored below
`AGENT_WORKSPACE_ROOT/tenants/<tenant_id>/agent-workspace`. The tenant is always
derived from the verified identity. Agent identifiers are additionally bound to
the Auth0 subject that registered them, preventing intra-tenant impersonation.

Collaboration reads require `core:read`; workspace, task and agent writes require
`core:govern`. This matches the scopes issued by the production OAuth client and
avoids reauthorization loops for unsupported granular scopes. Before changing
state, every write calls Universal Core's action evaluator. Tenant isolation,
audit, expected versions and fail-closed hard-block verdicts remain enforced.

## Tenant AI memory fabric

The memory fabric is fail-closed and is advertised only when
`MEMORY_FABRIC_ROOT` (or the fallback `AGENT_WORKSPACE_ROOT`) is configured.
Each tenant gets an isolated journal, durable memories, checkpoints and AI
handoffs under `tenants/<tenant_id>/memory-fabric`.

`memory_context` and `memory_search` require `core:read`. Explicit writes through
`memory_append`, `memory_checkpoint`, `memory_handoff` and acknowledgement require
`core:govern` and pass through Universal Core. Nyra context and interpretation
automatically read this memory. Successful and failed MCP tool calls append only
redacted operational metadata; raw prompts and raw tool arguments are never
automatically persisted.

Restricted records are rejected. `customer_personal` records require a consent
reference and use the shorter personal retention ceiling. Known credentials,
tokens and email addresses are redacted before the atomic write.

## Governed realtime research

`nyra_research_plan` asks Universal Core for source, freshness, citation and
safety constraints. ChatGPT or Codex then uses its host-managed web capability
and submits short evidence through `nyra_research_ingest`. Evidence remains a
tenant candidate or quarantine record until `nyra_research_feedback` confirms an
eligible record. Only validated evidence enters `search`/`fetch` and the Tenant
Memory Fabric.

The MCP keeps the issued plan for 24 hours and rejects fabricated, expired,
cross-tenant or policy-modified plan IDs. A repeated confirmation can safely
retry an interrupted memory promotion through the existing idempotency key.

Tool input never accepts a tenant override. Allowed domains, HTTPS, private-host
rejection, secret/PII handling, prompt-injection quarantine, idempotency and
freshness retention are enforced server-side. Evidence collection is performed
through the host-managed browser; the MCP makes no server-side model or web
search call. See `../../docs/NYRA_RESEARCH_CORTEX.md`.

## Mandatory memory-first work preflight

`work_preflight` is the mandatory entry point before a connected AI starts a
work request. It recalls the authenticated tenant memory, asks Nyra to interpret
and propose branches, lets Universal Core open and join the authorized branches,
assigns roles, emits a dependency-aware task graph and selects the least-privilege
connected capability. When continuity auto-capture is enabled, the first full
request also creates or resumes its redacted Intent Anchor and returns the
canonical `work_id`. Preflight never authorizes execution.

The MCP initialization instructions identify `work_preflight` as the first tool
for generic work. For work tools that do not natively call a Core routing
endpoint, the server runs the preflight automatically before the tool handler
and returns the preflight with the result. Failure is closed. Health and
capability discovery/routing are exempt because they have their own
authenticated, fail-closed governance path; retired provider URLs never enter a
workflow.

Completion is a separate operation from preflight and from individual tool
success. Closure requires the original criteria, verified worker evidence,
independent quality review, resolved blockers, exact release evidence where
applicable, rollback readiness, a persisted signed Core Join and a fresh
server-side GitHub/Render readback receipt. The final capability accepts only
the work, plan, one-shot action-ticket and idempotency identifiers; it rejects
caller-provided health booleans, commit claims, policy flags and readback
digests. A failed or interrupted attempt leaves a checkpoint and bounded
`next_action` for resume.

### Automatic shared-memory bootstrap

Every authenticated `work_preflight` loads these canonical tenant documents by
exact `source_path`: `SHARED_MEMORY/STATE.json`, `TASKS.json`, `LOCKS.json`,
`ARTIFACTS.json` and `HANDOFF.md`. The compact result is returned as
`work_preflight.shared_memory_bootstrap` with counts plus at most five recent
tasks and five recent artifacts. Full artifact details remain available through
tenant knowledge tools.

Parsed content is cached per tenant for at most 300 seconds and invalidated when
a canonical checksum or update timestamp changes. Missing or invalid documents
return `loaded=false`, list `missing_files` and force preflight governance
closed. Tenant identity always comes from the authenticated MCP identity.

Routing is connector-first. For GitHub work, the connected GitHub app is the
preferred route; GitHub CLI and manual browser authentication are prohibited
while that connector is available. CLI is only a verified fallback when the
connector is unavailable and the CLI is already installed and authenticated.
Merge and deploy require a Core `ALLOW` verdict and host approval. The owner
explicitly confirms the exact bounded delegation; a matching one-shot action
ticket does not ask the owner to reinterpret every connector command.

Universal Core performs its own read-only closure verification. Public GitHub
repositories can be checked anonymously. A private repository needs an exact
server-side `tenant_id + owner/repository` registry binding whose JSON points
to a separately provisioned `CORE_HOST_NATIVE_GITHUB_TOKEN_*` secret. Render
origins are resolved from exact tenant/repository/service/environment bindings
and must be HTTPS `*.onrender.com`; the current `codexai` production services
are provisioned in the Blueprint. Invalid registry configuration disables
host-native governance and readiness rather than falling back to caller data.

This enforcement covers AI clients that enter through SkinHarmony Core or this
MCP. A client that directly invokes an unrelated external connector and bypasses
SkinHarmony entirely cannot be technically intercepted by this gateway and is
therefore forbidden by the published protocol.

## Nyra + Core Full Intelligence

La versione `0.5.0-full-intelligence` espone a ChatGPT un ciclo analitico completo,
tenant-bound e memory-first. Non riduce Nyra e Core a conferme binarie: costruisce
scenari, aggiorna probabilita con evidenze, confronta ipotesi, valuta eventi e
controfattuali, seleziona opzioni per valore/rischio/reversibilita e misura la
calibrazione sulle previsioni concluse.

Tool disponibili:

- `intelligence_workflow`: pipeline completa in una chiamata;
- `scenario_analysis`: scenari favorevole, base e avverso o scenari forniti;
- `hypothesis_rank`: ranking probabilistico trasparente delle ipotesi;
- `event_probability`: probabilita, impatto, esposizione e priorita degli eventi;
- `counterfactual_analysis`: differenza fra baseline e alternative;
- `decision_select`: selezione advisory per utilita attesa e rischio;
- `outcome_verify`: Brier score, errore di calibrazione e sorpresa;
- `outcome_record`: memorizzazione idempotente dell'esito verificato;
- `calibration_status`: qualita aggregata delle previsioni del tenant.

Le probabilita sono stime decisionali, non certezze. Ogni risultato include
assunzioni, qualita dati, range di incertezza e traccia dei fattori. Nessun tool
esegue autonomamente pubblicazioni, deploy o modifiche esterne.

Da `0.11.3`, `outcome_record` usa sul collegamento MCP → Universal Core il solo
scope interno `write:intelligence_outcome`; la prova owner usa separatamente
`owner:assertion`. Core richiede un esito verificato,
tenant identico a quello autenticato e conferma owner firmata; registra il
verdetto ma non modifica mai automaticamente i pesi live. `write:snapshot`
rimane accettato temporaneamente solo per chiavi legacy che dispongono gia di
una prova owner attendibile (`owner:assertion` o automazione controllata); non
deve essere aggiunto a una nuova chiave MCP.

## Production boundary

The MCP service calls Universal Core server-to-server with a tenant-scoped key; it never forwards the ChatGPT OAuth token to Core. Explicit memory and collaboration writes affect only the authenticated tenant's internal server-side state and require Core governance. They do not merge, deploy, publish, modify customer systems, or grant cross-tenant access.

## Multi-tenant boundary

OAuth identities must contain the namespaced custom claim configured by `MCP_TENANT_CLAIM`. Requests without it are rejected. Tool inputs never accept a tenant override: the MCP derives `tenant_id` only from the verified identity and forwards it to Core. `UNIVERSAL_CORE_KEYS_JSON` maps each tenant to a separate server-side scoped Core key; an unmapped tenant is rejected. Legacy Codex bearer access is pinned to `MCP_DEFAULT_TENANT_ID` and may use `UNIVERSAL_CORE_KEY` as its compatibility key.

For a single ChatGPT tenant, `MCP_CHATGPT_TENANT_ID` can associate the existing `CORE_MCP_KEY` secret with that exact tenant. An explicit entry in `UNIVERSAL_CORE_KEYS_JSON` always takes precedence.

## Intelligence consolidation 0.5.1

The full intelligence workflow now performs a Core analysis and then invokes the tenant-scoped Nyra bridge for interpretation. The response exposes an `intelligence_path` object showing whether Core analyzed and Nyra interpreted the result. Nyra interpretation never authorizes execution and degrades safely if the interpretation route is unavailable.

Outcome tools accept optional `domain` and `horizon` fields so calibration can be compared by operating context.
