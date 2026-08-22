# Nyra Persistent Operating Dialogue v1

Nyra is the persistent operational mind for a Work. The owner states the
outcome, Nyra maintains the plan and continuity, connected AIs perform bounded
steps, and Universal Core remains the authority for policy and consequential
actions.

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
included in every dialogue context. The implementation is in:

- `services/skinharmony-core-mcp/src/nyra-operational-dialogue.js`
- `services/skinharmony-core-mcp/src/nyra-control-context.js`
- `services/skinharmony-core-mcp/src/work-continuity-runtime.js`

Recovery procedures and limits are deliberately separate in
`docs/runbooks/nyra-core-recovery-registry-v1.md`, so ordinary work is guided
by the operating manual rather than a wall of exception rules.
