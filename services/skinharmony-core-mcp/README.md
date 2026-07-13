# Universal Core MCP Gateway

Remote MCP endpoint compatible with existing scoped Codex bearer tokens and ChatGPT OAuth 2.1 clients backed by Auth0. Authentication never accepts an owner-confirmation field and never derives tenant access from client input.

The repository path and package name retain the historical SkinHarmony name for deployment compatibility, but the gateway contract is horizontal. MCP tools do not expose a `domain_pack` selector and never forward one supplied out of schema. Suite, SmartDesk and Analyzer packs are resolved only from the authenticated server-side Core key metadata.

## Authentication

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
MCP_CHATGPT_TENANT_ID=tenant-a
CORE_MCP_KEY=<server-side scoped Core key for MCP_CHATGPT_TENANT_ID>
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
NYRA_GOD_MODE_CLIENT_IDS=<comma-separated dedicated OAuth client ids>
NYRA_GOD_MODE_CODEX_ENABLED=false
NYRA_GOD_MODE_EMERGENCY_STOP=false
```

`CORE_BASE_URL` is also accepted as a compatibility fallback when
`UNIVERSAL_CORE_URL` is not set.

Configure the Auth0 application as a public OAuth client for ChatGPT, allow only approved callback URLs, enable authorization code with PKCE, and disable password/implicit grants. Do not commit secrets. Auth0 must issue RS256 access tokens containing `scope` or `permissions`. The MCP merges both claims when Auth0 emits requested OAuth scopes in `scope` and RBAC API permissions in `permissions`; duplicate values are removed before per-tool authorization.

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
tool handler and returns the preflight with the result. Failure is closed. Core
health and tenant-memory recall/search are exempt because they are prerequisites
of the preflight itself. Nyra interpretation, Codex context and the action gate
embed their own mandatory Core preflight.

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

## Production boundary

The MCP service calls Universal Core server-to-server with a tenant-scoped key; it never forwards the ChatGPT OAuth token to Core. Explicit memory and collaboration writes affect only the authenticated tenant's internal server-side state and require Core governance. They do not merge, deploy, publish, modify customer systems, or grant cross-tenant access.

## Multi-tenant boundary

OAuth identities must contain the namespaced custom claim configured by `MCP_TENANT_CLAIM`. Requests without it are rejected. Tool inputs never accept a tenant override: the MCP derives `tenant_id` only from the verified identity and forwards it to Core. `UNIVERSAL_CORE_KEYS_JSON` maps each tenant to a separate server-side scoped Core key; an unmapped tenant is rejected. Legacy Codex bearer access is pinned to `MCP_DEFAULT_TENANT_ID` and may use `UNIVERSAL_CORE_KEY` as its compatibility key.

For a single ChatGPT tenant, `MCP_CHATGPT_TENANT_ID` can associate the existing `CORE_MCP_KEY` secret with that exact tenant. An explicit entry in `UNIVERSAL_CORE_KEYS_JSON` always takes precedence.

## Intelligence consolidation 0.5.1

The full intelligence workflow now performs a Core analysis and then invokes the tenant-scoped Nyra bridge for interpretation. The response exposes an `intelligence_path` object showing whether Core analyzed and Nyra interpreted the result. Nyra interpretation never authorizes execution and degrades safely if the interpretation route is unavailable.

Outcome tools accept optional `domain` and `horizon` fields so calibration can be compared by operating context.
