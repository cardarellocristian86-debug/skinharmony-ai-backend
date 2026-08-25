# Nyra Persistent Operating Dialogue v1

Nyra is the persistent operational mind for a Work. The owner states the
outcome, Nyra maintains the plan and continuity, connected AIs perform bounded
steps, and Universal Core remains the authority for policy and consequential
actions.

## Cognitive engine contract

Nyra determines the governed operational reasoning and the decision path from
its persistent state. The connected AI is an interchangeable cognitive and
linguistic engine: it interprets, explains and performs bounded work, but does
not become the source of truth or final authority. This keeps the Work
continuous when the AI model or host changes.

## What Nyra knows automatically

For every bound Work, Core MCP materializes one `nyra_control_context_v1`.
It carries only compact, verifiable references:

- Work identity, revision and next action;
- immutable Intent digest;
- latest checkpoint capsule id and digest;
- Gallery availability and project Work count;
- Software Cognition Atlas revision/source hash, without graph nodes;
- current bounded assignment;
- self-diagnosis state and the persistent dialogue id.

The raw Intent, objective, checkpoint evidence, Gallery records and Atlas graph
remain in their authoritative stores. A new chat receives the compact context
automatically; it does not need to reconstruct history or remember a special
Nyra tool.

## Software Architecture Atlas

Persistent memory alone is not enough for autonomous orchestration. Nyra needs
a current, queryable Software Architecture Atlas of components, files,
dependencies, services, APIs, events, databases, changes and impacts. The
bound Work dialogue reports its live `software_state` and `atlas_revision`:
when it is not indexed, Nyra uses the governed repository bootstrap. The server
accepts only an exact server-owned project/repository/branch binding. It resolves
any private-repository credential only on the server, reads one bounded,
commit-and-tree-pinned snapshot batch, derives the graph and persists only
metadata and digests—never source text. Each response contains a cursor plus the
immutable snapshot checkpoint for the next batch instead of re-scanning the
repository from chat. A partial bootstrap is marked `indexing`, not available;
the first page tombstones the previous snapshot so removed nodes cannot silently
survive a refresh. Repository trees are walked incrementally, with the bounded
directory frontier persisted in the same checkpoint, so a large repository does
not require one oversized recursive GitHub response.
Once present, the Atlas lets Nyra compare
an agent's proposed activity with the software that actually exists and its
known impact surface.

## Dialogue and orchestration

The `nyra_dialogue` section is a Work-scoped continuation, not a temporary chat
prompt. It is refreshed when Nyra binds a Work or a material change occurs:
creation, architecture change, checkpoint, resume, assignment reconciliation,
incident or Atlas update. Normal preflight reuses the persisted context when
the Work revision and next action still match.

The dialogue tells a connected AI to take the recorded next step, use the
attached evidence references first, return bounded evidence, and let Nyra move
the Work forward. The AI does not decide whether a different Work, policy or
release scope is valid.

`nyra_converse` remains available for a direct owner-to-Nyra conversation. If
the caller supplies the exact Work/project pair and the durable context is
current, it responds from that context without a second preflight or Core
interpretation call. If the snapshot is absent or stale, it follows the normal
authenticated fallback and rebuilds the context.

### Conversational orchestration contract v2

For an unregistered or read-only ChatGPT client, `nyra_converse` is the single
advertised conversational front door. A registered conversational application
with `governed_continue` additionally receives the narrow direct
`nyra_governed_continue` tool. Nyra must speak to the owner and connected AI
instead of exposing raw catalog or preflight mechanics. Every turn returns a
server-issued directive that:

- states the current problem, what is missing and why it matters;
- assigns ordered, bounded next actions to Nyra, Codex, Universal Core or the
  owner;
- distinguishes safe local progress from an external side effect;
- binds any ticket request candidate to the exact tenant, Work Identity,
  project, Work revision, Intent digest and bounded Work-context digest;
- never claims that a ticket was issued or that execution occurred.

Only an exact pure-resume request may reuse the current persisted dialogue. A
new technical request always obtains a fresh Work preflight and Core
interpretation. This prevents a semantically relevant but stale checkpoint from
repeating its old next action while the owner is reporting a new problem.

Nyra can direct the authenticated connected AI to continue local inspection,
tests, documentation and evidence collection under `PREPARE_BOUNDED_WORK`.
That disposition is progress, not authority. Universal Core independently
verifies any consequential action; host policy still applies. Merge is always
handed to the owner as `MANUAL_ONLY`, even if the request omits the word
"manuale".

### Registered multi-host continuity

ChatGPT, Codex and future AI applications are identified by a strict
server-side application registry. Application identity is never inferred from
caller-supplied `client_type` or `host_type`. Subject/tenant authority, app
capabilities, Work ACL and Universal Core authority are intersected; none can
substitute for another.

Nyra always searches the tenant Gallery first. An exact Work is resumed under
its persistent identity, ambiguity produces `HOLD`, and absence produces a
governed bootstrap requirement rather than a duplicate. Canonical V2 creation
uses a signed two-phase review/create protocol with a fresh owner confirmation,
independent Core verification and project-scoped transactional duplicate
revalidation.

The complete contract and activation requirements are defined in
[`nyra-governed-multi-host-work-v1.md`](./nyra-governed-multi-host-work-v1.md).

The directive reads Work Continuity V2 through the authenticated tenant ACL and
projects only bounded counts, deterministic digests, verified-closure state and
the next pending required task. It never returns raw task/evidence bodies. An
ambiguous Work, revision drift, tenant mismatch or malformed authority claim
fails closed with a structured need rather than a fabricated answer.

Verified closure is a V2-store derivation, not a syntax check performed by
Nyra. The store correlates the terminal Work state with completed required
tasks, independently verified required evidence, the signed Core Join, the
closure receipt, the canonical final-report digest and the hash-bound terminal
event. Nyra accepts only the exact self-consistent bounded projection. Existing
terminal records without that event require a governed, non-destructive forward
projection before Nyra can report `COMPLETE`. An authorized idempotent replay of
the existing closure performs that projection transactionally: it canonicalizes
the derived report digest, appends the missing V2 terminal event and accepts the
result only after re-verifying every closure binding. It never rewrites raw
report or evidence content, and a failed check rolls the projection back.

## Local self-analysis and learning

Nyra diagnoses from local, persistent facts before asking an AI to search:

1. connector state and exact recovery action;
2. incident fingerprint and verification status;
3. checkpoint/Intent consistency;
4. Gallery identity and Work revision;
5. Software Cognition Atlas availability and revision.

The automatic local correction is to preserve and refresh this context. Proven
outcomes, independently verified incident runbooks and verified software
evidence enrich local Work knowledge for later Work. This is evidence learning,
not model-weight training and not a hidden provider-model call.

## Software Cognition use

Nyra includes the current Atlas revision and source hash in the dialogue. A
bounded graph selection is created only by a real software event with verified
seed nodes. Starting a new chat never scans the whole repository or Atlas just
to compose context. The connected AI can therefore ask for the exact bounded
software capability only when the Work needs it.

## Persistent manual and change control

This manual is versioned as `nyra_operating_manual_v1` and its digest is
included in every dialogue context. Its canonical machine-readable source is
`services/skinharmony-core-mcp/src/nyra-operating-manual.js`; the Markdown is
the detailed reviewed guide and tests verify the runtime manual version and
all canonical sections. The implementation is in:

- `services/skinharmony-core-mcp/src/nyra-operational-dialogue.js`
- `services/skinharmony-core-mcp/src/nyra-control-context.js`
- `services/skinharmony-core-mcp/src/work-continuity-runtime.js`

Recovery procedures and limits are deliberately separate in
`docs/runbooks/nyra-core-recovery-registry-v1.md`, so ordinary work is guided
by the operating manual rather than a wall of exception rules.
