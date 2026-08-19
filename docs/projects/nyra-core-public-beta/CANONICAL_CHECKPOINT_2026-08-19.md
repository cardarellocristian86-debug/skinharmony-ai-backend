# Nyra Core Public Beta — Canonical Project Checkpoint

Updated: **2026-08-19**  
Status: **planning checkpoint; no implementation, merge, deploy, DNS or OpenAI submission performed by this checkpoint**

## 1. Canonical Work identity

```text
Work name: Nyra Core Public Beta + Provider-Neutral Work Fabric + Hybrid Vault
Project: nyra-core
Phase: readiness audit pending
Public release mode: advisory
Multi-provider routing mode: OFF
```

## 2. Immutable intent

Make Nyra Core available as a free public beta, initially through an OpenAI-reviewed MCP plugin/app, while preserving the internal Core authority, tenant isolation, user ownership of Work data, provider neutrality, evidence-based closure and future portability across AI platforms.

The beta must demonstrate the real Nyra intelligence without exposing unrestricted administrative or external execution capabilities.

## 3. Required end-to-end user journey

```text
login
→ create governed Work
→ establish Genesis/Intent
→ establish ICF
→ provide authorized software or other bounded context
→ analyze reality against Intent and ICF
→ identify impact, dependencies, missing obligations and challenges
→ remediate
→ re-evaluate through Nyra and Universal Core
→ checkpoint/resume
→ governed closure
→ Report Archive / Hybrid Vault
```

## 4. Product positioning

Nyra Core is not positioned as only:

- a ChatGPT plugin;
- a JavaScript/TypeScript analyzer;
- a task manager;
- a chat archive;
- a GitHub automation wrapper.

Canonical positioning:

> A provider-independent control plane that preserves Work identity, Intent, ICF, evidence, continuity and responsibility while humans and multiple AI systems execute and review bounded parts of the same Work.

Software Intelligence is the strongest initial use case, not the boundary of the product.

## 5. Public beta authority boundary

The public beta remains advisory:

```text
execution_authorized = false
host_action_authorized = false
```

The public surface must not automatically:

- commit, push, merge or deploy;
- publish content;
- send emails or external messages;
- execute arbitrary shell commands;
- browse arbitrary sources outside governed Research Airlock paths;
- elevate to owner-root/God Mode;
- cross tenant boundaries;
- use a Nyra pre-Core decision as an execution credential.

Universal Core remains the only final closure authority.

## 6. Intelligence that must remain available

The beta must orchestrate, behind a simplified public surface:

- Work Continuity;
- Genesis and Intent revisions;
- ICF constraints and anti-goals;
- DTT/task structure;
- Causal Continuity;
- Research Airlock;
- Software Cognition / NSCT;
- Work Atlas / Software Reality Graph;
- impact and blast-radius analysis;
- requirement and evidence traceability;
- challenge detection;
- provisional Nyra decisions;
- Universal Core advisory verdicts;
- human-readable block explanations;
- resume and handoff context.

## 7. Proposed public tool surface

### Universal Work

```text
create_governed_work
analyze_governed_work
resume_governed_work
explain_core_decision
```

### Software Work

```text
ingest_authorized_software
analyze_software_architecture
evaluate_software_change
evaluate_software_readiness
```

These tools may orchestrate multiple internal capabilities. The internal tool catalogue must not be exposed wholesale to public reviewers or users.

## 8. Work ownership and tenant model

Canonical rule:

```text
User/organization: rights and control over Work content
Nyra Core: canonical Work state and continuity authority
AI platforms: temporary executor/reviewer roles
GitHub: software source and evidence when relevant
Render or other hosting: replaceable infrastructure
Universal Core: verification and closure authority
```

The current Work model separates `owner_user_id`, assigned/supervising users and `agent_ids`. A provider session does not become the owner of a Work.

Every public Work must be tenant-scoped from server-verified OAuth identity. The caller must never select another tenant through tool arguments.

## 9. Report Archive and privacy

A successfully closed Work:

```text
operational Gallery
→ COMPLETED
→ closed_at and final evidence digest
→ closure receipt and final report
→ logical Report Archive
```

Closed Work remains persisted and audit-searchable but is hidden from the operational Gallery by default. Current architecture does not treat archive as hard deletion.

Public privacy language must remain precise:

> Work is tenant-isolated, private by default and not shared with other users or AI providers except through explicit bounded authorization.

Do not claim “total privacy” before verifying:

- database and backup encryption;
- backup retention and deletion;
- production logs and redaction;
- administrator access;
- subprocessors;
- data residency;
- export and deletion paths;
- copies produced by debugging or analysis.

Nyra should retain structured continuity, not automatically persist complete raw conversations.

## 10. Hybrid Vault decision

Approved architectural direction: **Nyra Hybrid Vault**.

```text
NYRA CLOUD
- active Work
- current Intent/ICF
- coordination, task leases and checkpoints
- minimized archive index
- digests, receipts and storage location metadata

NYRA LOCAL VAULT
- complete closed Work archive
- files and documents
- full reports and evidence
- timeline and decisions
- continuity capsules
- local full-text index
```

User-selectable archive modes:

```text
LOCAL ONLY
LOCAL + ENCRYPTED BACKUP
CLOUD PRIVATE
```

A closed Work may be exported as a verifiable encrypted package:

```text
NYRA-YYYY-NNN.nyrawork
```

Expected logical package:

```text
manifest.json
work.json
intent/
icf/
tasks/
files/
evidence/
decisions/
timeline/
reports/
receipts/
```

A closed Work should remain immutable. Continued activity creates a successor Work linked to the archived predecessor.

## 11. Human retrieval problem and search decision

The current resolver is useful for operational Work and duplicate prevention, but it is not yet a complete historical search system for archived Work.

Create a **Nyra Work Retrieval Engine** with three layers:

1. Exact/filter search by Work ID, code, title, project, state, date, owner, provider, repository, branch, commit, tag, file, technology and Core verdict.
2. Tenant-scoped full-text search over authorized summaries of objective, Intent, ICF, decisions, evidence descriptions, final report and filenames.
3. Natural-language search with explained ranking, confidence and ambiguity handling.

Hybrid retrieval flow:

```text
user query
→ minimized cloud index
→ optional local full-text index
→ merge and rank
→ explained results
```

The Local Vault must not upload full local content automatically. It may return bounded match metadata and a safe authorized excerpt.

## 12. Nyra Work Explorer UI

Create an independent horizontal UI, not tied to the SmartDesk vertical.

Primary views:

```text
ACTIVE
ARCHIVED
SHARED
LOCAL
OFFLINE / PENDING SYNC
```

Work detail sections:

```text
OVERVIEW
INTENT AND ICF
TASKS / DTT
FILES
TIMELINE
DECISIONS
EVIDENCE
AI SESSIONS
FINAL REPORT
```

The existing SmartDesk control UI is a reusable starting point because it already contains Gallery, work detail, filters, timeline, checkpoint, dependencies, Core verdict and linked-artifact fields. It is not yet a complete Work file browser.

## 13. Work File Registry

Add a provider-neutral registry for files and artifacts linked to each Work.

Suggested entity:

```text
tenant_work_file
```

Minimum fields:

```text
tenant_id
work_id
file_id
logical_path
filename
mime_type
size_bytes
sha256
version
artifact_kind
source_type
source_provider
source_reference
storage_class
storage_locator
encryption_state
retention_policy
created_by_actor
created_at
```

Storage classes:

```text
CLOUD_PRIVATE
LOCAL_VAULT
EXTERNAL_REFERENCE
EPHEMERAL
DELETED
```

For source repositories, prefer repository/commit/branch/path/digest and Software Reality Graph references. Do not duplicate a full repository by default.

## 14. Provider-neutral and multi-AI roadmap

Initial beta schema must use neutral names such as:

```text
provider_id
provider_client
provider_session_id
provider_capabilities
work_id
task_id
assignment_role
assignment_mode
lease_id
allowed_scope
forbidden_actions
input_capsule_digest
baseline_revision
checkpoint_digest
result_receipt_digest
evidence_refs
review_state
usage_units
```

Rollout modes:

```text
OFF
MANUAL
ADVISORY
BOUNDED_AUTO
```

Sequence:

```text
single-provider end-to-end beta
→ provider-neutral schema
→ MANUAL Codex/Gemini CLI pilot
→ task splitting and leases
→ cross-provider review
→ conflict mediation
→ advisory routing
→ bounded automatic routing under user policy
```

No provider can close the complete Work. Providers return task results and evidence; Universal Core evaluates closure.

## 15. Quotas and telemetry

Build the technical quota/rate-limit engine before public launch, while keeping commercial values configurable.

Required controls:

- per-subject and secondary per-IP rate limits;
- heavy-operation concurrency;
- tenant usage budget;
- queue limits;
- request and artifact size limits;
- timeout and circuit breaker;
- idempotency and replay protection.

Do not use raw MCP tool-call count as the primary product metric. Track minimized first-party events for:

- connected users;
- activated users;
- weekly/monthly active users;
- governed Work completed;
- software analyses completed;
- conflicts/gaps detected;
- gaps subsequently resolved;
- 7/30-day retention;
- average cost per analysis/Work;
- successful cross-provider handoffs;
- zero cross-tenant incidents.

Telemetry must not contain raw prompts, source code, tokens, secrets or unneeded personal data.

## 16. OpenAI publication requirements

Before submission, prepare and verify:

- separate public MCP gateway/facade;
- verified publisher identity;
- global-data-residency OpenAI project if required by current submission rules;
- public website;
- privacy policy;
- terms of use;
- support page;
- data retention/deletion policy;
- OAuth reviewer account without MFA blockers;
- domain challenge endpoint;
- accurate tool annotations and output schemas;
- five positive review tests;
- three negative review tests;
- starter prompts;
- `chatgpt-app-submission.json`;
- tool scan and manual review readiness.

The submission must be a complete bounded product, not an incomplete demo.

## 17. Security issue requiring audit

The public repository contains historical paths under `shared-work-memory`, including names such as `owner-private`. A public repository path is public regardless of its name.

Before beta launch:

1. inventory `shared-work-memory`;
2. distinguish public fixtures from real operational memory;
3. remove operational/private material from the public repository;
4. update ignore rules;
5. inspect Git history where necessary;
6. verify whether secrets or personal data ever existed;
7. move real memory to private storage or Local Vault.

## 18. Required implementation order

```text
1. Readiness Audit
2. public beta gateway and provider-neutral schema
3. end-to-end user journey
4. quotas and rate limits
5. minimized telemetry
6. essential Work Explorer and File Registry
7. private testers
8. privacy/terms/support/submission package
9. OpenAI review
10. public beta
11. automated Local Vault
12. MANUAL multi-provider
13. advisory and bounded-auto routing
```

## 19. Immediate next mission

Run only:

```text
NYRA CORE PUBLIC BETA READINESS AUDIT
```

The audit must distinguish:

```text
READY
PARTIAL
MISSING
NOT_REQUIRED_FOR_BETA
BLOCKED
```

It must distinguish source presence, tests, merge state, deployment and verified live use. No implementation, branch, commit, PR, merge, deploy, DNS or submission should occur during the audit.

Audit areas must include:

- Core/MCP/OAuth/tenant isolation;
- Genesis/Intent/ICF;
- Work Continuity and closure;
- Software Cognition/NSCT;
- public gateway readiness;
- quotas and telemetry;
- OpenAI submission readiness;
- Archive/privacy/data lifecycle;
- historical Work search;
- Work Explorer UI;
- Work File Registry;
- Hybrid Local Vault;
- public-repository memory exposure;
- provider coupling and neutral schema.

## 20. Resume instruction

When resuming this project in a new session, read this checkpoint first and request a fresh read-only verification of `main` and live production. Never assume that a capability is live merely because it appears in source or an old report.

Private continuity archive created outside the public repository on 2026-08-19:

```text
Nyra_Core_Beta_Project_2026-08-19.zip
SHA-256: 87c13e51da99eea048c67f84d8286535d82ed75411f97b0a79eb213087b93115
```

The private archive contains the visible conversation and expanded working notes. It must not be committed to the public repository.