# Universal Core MCP Gateway

Remote MCP endpoint compatible with existing scoped Codex bearer tokens and ChatGPT OAuth 2.1 clients backed by Auth0. Authentication never accepts an owner-confirmation field and never derives tenant access from client input.

The repository path and package name retain the historical SkinHarmony name for deployment compatibility, but the gateway contract is horizontal. MCP tools do not expose a `domain_pack` selector and never forward one supplied out of schema. Suite, SmartDesk and Analyzer packs are resolved only from the authenticated server-side Core key metadata.

## Authentication

## ChatGPT install and tenant API-key onboarding

Users install this connector in ChatGPT and authenticate with their own account; they never need access to Render. On first use, ChatGPT should explain that Nyra plans and coordinates while Universal Core remains the final safety authority.

An API key for an external model provider must **never** be pasted into a ChatGPT message or tool argument. A ChatGPT/Codex subscription is separate from API billing. When tenant-provided model execution is enabled, the connector will return a one-time secure setup link outside the chat. The user enters their own provider API key there; Core stores only encrypted data in the tenant-scoped database, returns a masked status, and supports rotation or removal. Until that flow is available and a provider is explicitly enabled, all agent execution remains dry-run.

### What users need to know

1. **Install and sign in.** Add the connector in ChatGPT and complete OAuth. This binds the session to the correct tenant; Render is never visible to the user.
2. **Describe the job.** State the objective, desired result, constraints, deadline and whether it is research, analysis or planning. Nyra and Core prepare a bounded plan before work begins.
3. **Build agents safely.** An agent is a role in a governed plan, not an autonomous account. Typical roles are supervisor, researcher and critic. The plan has explicit dependencies, limits and a deadline; keep specialist fan-out to three or fewer.
4. **What is automatic.** Core performs tenant isolation, memory recall, preflight, routing, plan persistence, cancellation controls, audit and dry-run simulation.
5. **What is not automatic.** Browser or tool side effects, messages to customers, payments, publishing, deployment and data deletion remain disabled or require a separate Core verdict plus explicit owner confirmation.
6. **First live multi-agent mode.** After an OAuth tenant owner explicitly confirms a test, `tenant_provider_openai_multi_agent_smoke_run` can make up to three sequential billable calls with that tenant's already-encrypted OpenAI key: **Researcher → Reviewer → Nyra Synthesizer**. A completed run makes all three; cancellation or a safety failure prevents every remaining stage. The task is capped at 300 characters; each stage is capped at 200 output tokens; learning is frozen; browser, tools, external actions and retries are disabled. The start returns a run ID immediately; the owner can poll the result or cancel it, which aborts the active request and prevents every remaining stage. All other generic-agent and queue workflows remain `manual_dry_run`.
7. **Provider setup.** ChatGPT Pro/Codex and API billing are separate. Never paste an API key into ChatGPT. Choose **Collega OpenAI** (or ask to create agents): the fixed page asks the administrator of the current tenant to sign in, then creates a short-lived, one-time protected page where the existing key is pasted. The chat never receives the key or the one-time credential. The tenant sees only a masked status and its administrators can rotate or remove it.
8. **Research and privacy.** Research is planned first, then evidence is sourced and reviewed. Do not send secrets, raw customer records or full pages to the connector.

- Codex: `Authorization: Bearer <key>` from `CODEX_BEARER_KEYS`; scopes come only from trusted server configuration.
- ChatGPT: Auth0 RS256 access token verified against JWKS, exact issuer, audience, expiry and optional `nbf`.
- OAuth discovery: `/.well-known/oauth-protected-resource` and the RFC 9728 path-specific `/.well-known/oauth-protected-resource/mcp` advertise the protected resource. The compatibility authorization-server endpoint advertises authorization-code flow with PKCE `S256` only.
- MCP tools expose OAuth `securitySchemes`, minimum per-tool scopes, titles, descriptions and read-only/idempotent impact annotations. Preconfigured Codex bearer tokens remain supported at the transport layer without advertising an unsupported tool-level scheme.

Required configuration:

```text
MCP_PUBLIC_URL=https://mcp.example.com
AUTH0_ISSUER=https://YOUR_TENANT.auth0.com
AUTH0_AUDIENCE=https://mcp.example.com/mcp
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
CORE_OWNER_CONTEXT_SIGNING_SECRET=<same random secret, at least 32 characters, configured on Universal Core>
MCP_DEFAULT_TENANT_ID=owner-private
MCP_TENANT_CLAIM=https://skinharmony.it/tenant_id
SHARED_WORK_MEMORY_ROOT=/app/shared-work-memory
AGENT_WORKSPACE_ROOT=/var/data/skinharmony-core-mcp
MEMORY_FABRIC_ROOT=/var/data/skinharmony-core-mcp
MEMORY_RETENTION_DAYS=365
MEMORY_PERSONAL_RETENTION_DAYS=90
RESEARCH_CORTEX_ROOT=/var/data/skinharmony-core-mcp
RESEARCH_RETENTION_DAYS=365
NYRA_OPENAI_RESEARCH_ENABLED=false
NYRA_OPENAI_RESEARCH_MODEL=gpt-5.6
NYRA_OPENAI_RESEARCH_TIMEOUT_MS=90000
NYRA_OPENAI_RESEARCH_MAX_CALLS_PER_HOUR=10
OPENAI_API_KEY=<optional server-side secret>
NYRA_GOD_MODE_ENABLED=false
NYRA_GOD_MODE_TENANT_IDS=owner-private,codexai
NYRA_GOD_MODE_SUBJECTS=<comma-separated Auth0 subject ids>
NYRA_GOD_MODE_CODEX_ENABLED=false
NYRA_GOD_MODE_EMERGENCY_STOP=false
```

`CORE_BASE_URL` is also accepted as a compatibility fallback when
`UNIVERSAL_CORE_URL` is not set.

Configure the Auth0 application as a public OAuth client for ChatGPT, allow only approved callback URLs, enable authorization code with PKCE, and disable password/implicit grants. Do not commit secrets. Auth0 must issue RS256 access tokens containing `scope` or `permissions`. The MCP merges both claims when Auth0 emits requested OAuth scopes in `scope` and RBAC API permissions in `permissions`; duplicate values are removed before per-tool authorization.

## Multi-tenant OpenAI connection page

The fixed page `https://skinharmony-core-mcp.onrender.com/connect/openai` never accepts a tenant identifier from the browser. It uses Authorization Code + PKCE, verifies the authenticated tenant claim and an administrator role claim, then asks Core to issue the one-time vault page for that same tenant. A Codex bearer token and an OAuth client id alone cannot authorize this credential flow. The setup URL has no tenant or key; its short-lived path token is paired with a separate proof kept only in the URL fragment. Core consumes that proof and persists the encrypted key in one database transaction, so a failed or revoked flow does not partially change the provider configuration. It never enables provider execution.

Every tenant administrator can use the same flow. Auth0 must issue both `MCP_TENANT_CLAIM` (default `https://skinharmony.it/tenant_id`) and `MCP_TENANT_OWNER_ROLE_CLAIM` (default `https://skinharmony.it/role`). Roles accepted for provider setup are configured in `MCP_TENANT_OWNER_ROLES`, whose safe default is `tenant_owner,tenant_admin,owner_root`. Normal members can use Nyra but cannot add, rotate or remove the tenant's provider key.

The MCP resource server and browser owner portal use different Auth0 audiences. `AUTH0_AUDIENCE` remains the MCP API identifier (`https://.../mcp`); `AUTH0_BROWSER_AUDIENCE` must be the identifier of a separately authorized Auth0 API for the Regular Web Application. The portal never sends the MCP resource audience to the browser client.

Configure these Render values only after deploying the code: `AUTH0_BROWSER_CLIENT_ID`, `AUTH0_BROWSER_AUDIENCE`, optional `AUTH0_BROWSER_CLIENT_SECRET` for a confidential Auth0 application, `AUTH0_BROWSER_CALLBACK_URL=https://skinharmony-core-mcp.onrender.com/connect/openai/callback`, and a separate random `AUTH0_BROWSER_STATE_SECRET`. Do not use `OPENAI_API_KEY` for this feature. The Core service must already have its governed provider vault configured; no key is written to Render configuration.

When both services are Blueprint-managed, Render generates `CORE_OWNER_CONTEXT_SIGNING_SECRET` on `skinharmony-core-mcp` and injects the same value into `skinharmony-universal-core` through `fromService`; nobody needs to copy or see it. It signs only the short-lived OAuth-owner confirmation for the exact provider-link binding: it is not an OpenAI key or a Core bearer key and must never be sent in chat, a URL, or the repository. Until an existing Core service is attached to `render-universal-core.yaml`, the flow remains fail-closed rather than accepting a manual fallback. The binding commit is taken from the full Render build SHA (`RENDER_GIT_COMMIT`) of the currently running MCP process, never from the caller; if that identity is unavailable, the gate blocks. This Core gate is an authorization and audit decision, not a Render deployment executor: Blueprint sync is physically enforced by Render/GitHub until a separate CI/Render executor verifies a signed approval.

The one-time-link request uses a separate server-side credential. New multi-tenant deployments use `CORE_PROVIDER_SETUP_LINK_SERVICE_KEY`, generated by Render and restricted to the sole Core scope `write:provider_setup_link`; Core still verifies a fresh signed tenant-administrator context and requires its tenant to match the requested link. It never falls back to `CORE_MCP_KEY`, `UNIVERSAL_CORE_KEY`, or normal tenant keys, and it cannot read credentials, invoke providers or execute agents. `CORE_PROVIDER_SETUP_LINK_KEY` and `UNIVERSAL_CORE_PROVIDER_SETUP_LINK_KEYS_JSON` remain supported only for already-provisioned tenant-specific installations. Direct bearer-key provider write/delete routes are disabled: the consumed one-time page is the only credential-entry channel.

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
freshness retention are enforced server-side. The optional OpenAI Responses web
search fallback is not advertised unless both its key and explicit enable flag
are present. It is disabled by default and every invocation requires a billable
external-read verdict from Core. Provider responses use `store:false` and a
three-call web-search ceiling. See `../../docs/NYRA_RESEARCH_CORTEX.md`.

## Mandatory memory-first work preflight

`work_preflight` is the mandatory entry point before a connected AI starts a
work request. It recalls the authenticated tenant memory, asks Nyra to interpret
and propose branches, lets Universal Core open and join the authorized branches,
assigns roles, emits a dependency-aware task graph and selects the least-privilege
connected capability. It never authorizes execution.

The MCP initialization instructions and every advertised tool identify
`work_preflight` as the first tool. For work tools that do not natively call a
Core routing endpoint, the server runs the preflight automatically before the
tool handler and returns the preflight with the result. Failure is closed.
`work_preflight` itself is the only middleware exemption because it is the
entrypoint; health, memory, Nyra, Codex and action tools all receive the same
automatic preflight before their handler runs.

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
Merge and deploy require a Core `ALLOW` verdict and explicit owner confirmation.

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
