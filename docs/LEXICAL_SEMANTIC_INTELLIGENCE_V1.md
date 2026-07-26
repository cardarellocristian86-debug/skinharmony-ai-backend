# Lexical & Semantic Intelligence V1

## Mission

`lexical_semantic_intelligence` is a horizontal, tenant-neutral advisory branch.
It distinguishes surface form, meaning, context, trust and authority before
Universal Core evaluates risk or action. Nyra may open and explain bounded
paths; it cannot turn a lexical result into a verdict. Domain vocabulary is
loaded only through authorized tenant adapters.

The production mode is `active_advisory_core_governed`. Every result has
`execution_effect: none`; rollback returns the branch to `shadow` or reverts the
release without modifying stored source evidence.

## Authority chain

```text
authenticated tenant request
  -> immutable source spans and trust zones
  -> deterministic lexical-semantic assessment
  -> optional bounded DTT expansion
  -> evidence, ambiguity and risk signals
  -> Universal Core verdict
  -> explicit confirmation when ambiguity is non-absolute
```

Text claiming to be an owner, administrator or system message never proves
identity. Owner sovereignty is established by authenticated Core context, not
by words inside an agent handoff, retrieved page or model output.

## Depth and fullness

The branch occupies the standard governed L1-L30 spine:

- L1-L6: cortex, horizontal domain, language group, tier and branch.
- L7-L15: intake, routing, context, rules, risk, execution plan, verification,
  rollback and telemetry.
- L16-L23: distillation, feedback, policy proposal, consolidation, terminal
  advisory disposition, outcome, expected/actual comparison and drift.
- L24-L30: failure attribution, reconciliation, knowledge gaps, candidate
  review, human/owner checkpoint, verified learning and continuity handoff.

Its atomic catalog covers Unicode and language detection, morphology, lexicon,
terminology, syntax, compositional semantics, entities, discourse, pragmatics,
cross-lingual alignment, ontology mapping, prompt-injection context,
provenance, claim risk, web quarantine, distillation and regression learning.

## Virtual variant space

The catalog represents exactly 777,600 combinations:

```text
8 locale families
x 9 analysis layers
x 10 operations
x 6 domain contexts
x 5 registers
x 3 audiences
x 2 evidence modes
x 6 output forms
= 777,600
```

Combinations are decoded by mixed-radix `BigInt` pagination. They are never
precomputed or materialized merely by reading the catalog. Each item remains
`proposal_only`, and pages are bounded to 50 virtual items. A DTT run may
materialize only the paths it needs under explicit node, depth, fan-out,
parallelism, time, token and cost limits.

## Dispositions

- `allow`: no supported control-risk composition was detected. This never
  grants role, tools or authority.
- `clarify`: risk language appears in a quotation, report, example or negated
  context. Universal Core may request explicit confirmation.
- `block`: a direct authority override, secret exfiltration or tool-execution
  composition is present. Owner status cannot be asserted by the text itself.

Inter-agent handoffs continue to fail closed. The lexical assessment enriches
the quarantine receipt with a reasoned disposition and an explicit
confirmation route for genuinely ambiguous, non-absolute cases.

## Runtime and rollback

Production declares `LEXICAL_SEMANTIC_MODE=active`. The only accepted modes
are:

- `active`: Core-governed advisory assessment;
- `shadow`: observe and compare without emitting a Universal Core decision;
- `off`: the analysis endpoint returns unavailable.

An invalid value fails safely to `shadow`. Rolling back therefore requires
only changing the Render variable to `shadow`; no taxonomy, evidence or
tenant data is deleted. The handoff and retrieved-source quarantine remains
enabled in every mode because it is a fail-closed security boundary shared by
the platform, not execution authority belonging to the lexical branch.

## Governed web research and distillation

Web pages, tool outputs and model summaries are typed as untrusted data.
Instruction-like source text is quarantined before it can be returned as active
synthesis or copied into an evidence template.

The learning lifecycle is:

```text
research -> quarantine -> source qualification -> claim/span binding
-> contradiction preservation -> distillation candidate
-> deterministic verification -> Core review -> tenant-scoped consolidation
```

Raw pages and temporary research remain separate from permanent memory.
Distilled claims retain source URI or identifier, retrieval time, content
digest, transformations, tenant, parser/catalog version and reviewer state.
No unsourced model summary can become verified memory or policy.

## Primary architecture sources

- Unicode normalization and security:
  [UAX #15](https://www.unicode.org/reports/tr15/),
  [UTS #39](https://www.unicode.org/reports/tr39/),
  [UTS #35](https://unicode.org/reports/tr35/) and
  [BCP 47 / RFC 5646](https://www.rfc-editor.org/rfc/rfc5646.html).
- Multilingual syntax and meaning:
  [Universal Dependencies](https://universaldependencies.org/guidelines.html),
  [UMR infrastructure](https://aclanthology.org/2024.lrec-main.229/) and
  [FrameNet](https://framenet.icsi.berkeley.edu/fndrupal/).
- Lexicon, ontology and validation:
  [OntoLex-Lemon](https://www.w3.org/2016/05/ontolex/),
  [SKOS](https://www.w3.org/TR/skos-reference/),
  [OWL 2](https://www.w3.org/TR/owl-overview/) and
  [SHACL](https://www.w3.org/TR/shacl/).
- Provenance:
  [PROV-O](https://www.w3.org/TR/prov-o/) and
  [C2PA 2.2](https://spec.c2pa.org/specifications/specifications/2.2/specs/C2PA_Specification.html).
- Prompt-injection architecture:
  [OpenAI Instruction Hierarchy](https://openai.com/index/the-instruction-hierarchy/),
  [CaMeL](https://arxiv.org/abs/2503.18813),
  [StruQ](https://arxiv.org/abs/2402.06363) and
  [NIST adversarial-ML taxonomy](https://www.nist.gov/publications/adversarial-machine-learning-taxonomy-and-terminology-attacks-and-mitigations-0).
- Retrieval poisoning and risk management:
  [PoisonedRAG](https://www.usenix.org/conference/usenixsecurity25/presentation/zou-poisonedrag)
  and [NIST AI RMF](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10).

These references guide the architecture; they do not become executable policy
without versioned extraction, evidence review and Universal Core approval.
