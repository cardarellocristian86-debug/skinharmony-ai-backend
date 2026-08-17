# Nyra pre-Core decisions and NSCT research V1.1

## Outcome

NSCT V1.1 extends the existing Software Reality Graph, Native Plan receipts, Causal Continuity, ICF and Research Airlock. It does not create another graph, evidence store, web client or closure authority.

Nyra may issue `nyra_precore_decision_v1` while Core is pending. The receipt is always provisional, append-only and non-authorizing:

- `state=NYRA_PROVISIONAL`
- `core_state=CORE_PENDING`
- disposition is one of `PROPOSE`, `CHALLENGE`, `ABSTAIN`, `RECOMMEND_BLOCK`
- `execution_authorized=false`
- `authoritative_transition_performed=false`
- final execution, release and publication still require the existing Core closure and Core Join paths.

Every receipt binds the authoritative Genesis/Intent revision, ICF seal and ledger head, security challenge state, Atlas revision/digest, Native Plan digest and authority snapshot digest. Missing Intent or ICF forces a challenge. An open critical security challenge forces `RECOMMEND_BLOCK`. Missing required technical research forces `ABSTAIN`, or `RECOMMEND_BLOCK` for security-critical work.

## Governed research flow

1. `software_cognition_research_plan` reads the exact Work Atlas revision and detects technologies from repository evidence. Caller hints are hypotheses only and are restricted to the built-in profile registry.
2. NSCT selects exact HTTPS sources from technology profiles. Normal research requires at least two independent sources; high/security risk requires at least three. A primary reference is mandatory, and security work also requires an advisory source.
3. Universal Core opens a standard Research Airlock plan for those exact URLs and the authenticated DTT session. The capability nonce is returned once and is never persisted in an NSCT receipt.
4. Existing Airlock tools fetch, sanitize, quarantine prompt injection, seal evidence and enter the private synthesis phase.
5. The signed evidence capsule includes unique URL and domain digests. `software_cognition_research_bind` verifies its signature, tenant/project/Work, Airlock plan, freshness, unique-source threshold, primary source and security source before writing an append-only Native Plan receipt.
6. `software_cognition_precore_decide` re-reads the complete authoritative snapshot and emits an advisory receipt. Core remains the only final decision authority.

The initial technology registry covers Rust, JavaScript, TypeScript, Python, Go, Java, Kotlin, .NET, Ruby, PHP, Swift and C/C++. Each `technology_profile_v1` contains runtime/version detectors, manifest and lockfile types, framework detectors, parser or semantic adapter, compiler/type checker, lint/static analysis, test adapters, dependency inventory and vulnerability adapters, official/package/security sources, freshness limits and minimum evidence coverage. Adapter commands are structured plans for a sandboxed worker; the profile itself cannot execute them.

`software_cognition_technology_verify` accepts the resulting profile records only when an independent, fresh Causal observation attests the exact research plan and complete result set. Compiler/type-checker, tests, lint/static analysis, dependency inventory and manifest receipts are all mandatory. Missing adapter evidence forces Nyra to abstain (or recommend a block for security-critical work) and blocks research-qualified closure.

Unknown technology produces a knowledge gap and fails closed until an observed profile or an allowed hypothesis is available.

## Closure semantics

Research is additive and backwards-compatible. Existing Works without an NSCT research plan keep V1 closure semantics. Once a Work has a `research_required` plan, closure also requires a fresh matching signed research evidence receipt and rejects contradictions. Adding or changing research receipts changes the authority snapshot digest and invalidates stale closure receipts.

## Authority boundaries

- Research Airlock is the only public-web authorization and sanitization boundary.
- Work Atlas remains the Software Reality Graph authority.
- Native Plan receipts remain the immutable software artifact store.
- Causal observations remain the independent runtime/evidence authority.
- ICF and Genesis/Intent remain authoritative constraints and purpose.
- Nyra pre-Core decisions never transition Work, release, deployment or Core Join state.
