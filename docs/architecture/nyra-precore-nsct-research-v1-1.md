# Nyra pre-Core decisions and NSCT research V1.1

## Outcome

NSCT V1.1 extends the existing Software Reality Graph, Native Plan receipts, Causal Continuity, ICF and Research Airlock. It does not create another graph, evidence store, web client or closure authority.

Nyra may issue `nyra_precore_decision_v1` while Core is pending. The record extends `core_continuity_native_receipts`; it is purpose-signed with the existing Nyra Ed25519 signer, chained by sequence/parent/record digest, append-only and non-authorizing:

- disposition is one of `PROPOSE`, `CHALLENGE`, `ABSTAIN`, `RECOMMEND_BLOCK`
- `execution_authorized=false`
- `authority_scope=ADVISORY_NON_EXECUTABLE`
- final execution, release and publication still require the existing Core closure and Core Join paths.

Every receipt binds the authoritative Genesis/Intent revision, ICF seal and ledger head, security challenge state, Atlas revision/digest, Native Plan digest and authority snapshot digest. Missing Intent or ICF forces a challenge. An open critical security challenge forces `RECOMMEND_BLOCK`. Missing required technical research forces `ABSTAIN`, or `RECOMMEND_BLOCK` for security-critical work.

## Governed research flow

1. `software_cognition_research_plan` reads the exact Work Atlas revision and detects technologies from repository evidence. Caller hints are hypotheses only and are restricted to the versioned profile registry.
2. The existing Research Cortex creates a bounded, minimized-query plan. Its digest is bound into the Airlock public plan; NSCT never browses directly.
3. NSCT selects exact HTTPS sources from technology profiles. Normal research requires at least two independent lineages; high/security risk requires at least three. A primary reference is mandatory; security work also requires a vendor advisory and an independent security database.
4. Universal Core opens a standard Research Airlock plan for those exact URLs and the authenticated DTT session. The capability nonce is returned once and is never persisted in an NSCT receipt.
5. Existing Airlock tools fetch, sanitize, quarantine prompt injection and seal evidence. Binding re-reads the sealed evidence server-side; a caller-provided capsule alone is insufficient.
6. The evidence bundle exposes authorized titles/URLs, publisher, class, lineage, version scope, retrieval/freshness and content digests. Exact-version coverage requires an Airlock-fetched server-derived versioned official or registry URL; unversioned `latest` documentation cannot be relabelled as legacy-version proof. Atomic claims remain `DOCUMENTED_BEHAVIOR` until toolchain evidence confirms them.
7. `nyra_precore_decision_generate` locks the Project, Work, Atlas head, Native Plan, ICF and repository binding, then re-reads Genesis/Intent, Change, security and research evidence in the same database transaction used for signing, receipt insertion and continuity event append. `read`, `list` and `verify` reject stale, superseded, cross-scope or invalid chains.

The initial technology registry covers Rust, JavaScript, TypeScript, Python, Go, Java, Kotlin, .NET, Ruby, PHP, Swift and C/C++. Each `technology_profile_v1` contains runtime/version detectors, manifest and lockfile types, framework detectors, parser or semantic adapter, compiler/type checker, lint/static analysis, test adapters, dependency inventory and vulnerability adapters, official/package/security sources, freshness limits and minimum evidence coverage. Adapter commands are structured plans for a sandboxed worker; the profile itself cannot execute them.

`software_cognition_technology_verify` accepts the resulting profile records only when an independent, fresh Causal observation attests the exact research plan and complete result set. Compiler/type-checker, tests, lint/static analysis, dependency inventory and manifest receipts are all mandatory. Missing adapter evidence forces Nyra to abstain (or recommend a block for security-critical work) and blocks research-qualified closure.

Unknown technology returns `DISCOVERY_ONLY`, `UNKNOWN_LANGUAGE` and `MISSING_SEMANTIC_ADAPTER`; it cannot produce `PROPOSE`.

## Closure semantics

Research is additive and backwards-compatible. Existing Works without an NSCT research plan keep V1 closure semantics. Once a Work has a `research_required` plan, closure also requires a fresh matching signed research evidence receipt and rejects contradictions. Adding or changing research receipts changes the authority snapshot digest and invalidates stale closure receipts.

## Authority boundaries

- Research Airlock is the only public-web authorization and sanitization boundary.
- Work Atlas remains the Software Reality Graph authority.
- Native Plan receipts remain the immutable software artifact and pre-Core chain store.
- Causal observations remain the independent runtime/evidence authority.
- ICF and Genesis/Intent remain authoritative constraints and purpose.
- Nyra pre-Core decisions never transition Work, release, deployment or Core Join state.
- Host-native and Core Join execution consumers explicitly reject a pre-Core record used as a ticket.

Universal Core independently reloads and verifies the current signed pre-Core record after forming its own Core Join decision. The API response and audit event attach `precore_alignment=AGREES|OVERRIDES|UNAVAILABLE|INVALID`, the signed pre-Core digest and structured reason codes. This metadata never changes the independent Core verdict and is never an execution credential.
