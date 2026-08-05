# Nyra Reliability Layer v1

Nyra/Core now treats every model response as a proposal that must pass explicit evidence, authorization and completion gates. The layer is available through Universal Core HTTP endpoints and the SkinHarmony MCP chat tools.

## Contract

1. External chat, web, email, PDF, document, MCP and browser content is `UNTRUSTED_DATA`. It is digestable evidence only; embedded instructions cannot route, authorize or mutate a tool.
2. Claims use a ledger with `verified`, `unverified` and `contradicted` states. Verification requires source references, evidence references and a verifier distinct from the producer. Contradictions block completion.
3. A tool action requires a signed, tenant/project/work/session-bound envelope containing the exact tool digest, parameter hash, destination, expiry and nonce. Envelopes are single-use and Core performs no side effect.
4. Completion requires explicit postconditions, observed evidence and an independent verifier. A caller-provided `done`, `success` or supervisor flag is never sufficient.
5. Continuity checkpoints are digest-linked and idempotent. Replay only prepares revalidation and blocks duplicate side effects.
6. Handoffs are signed, expiring, receiver-bound and single-use. A receiver cannot inherit authority from the producer.
7. Budget reservations are enforced at tenant, work, agent and tool scopes. Exhaustion is deterministic and stops the run.
8. Browser execution is host-controlled. Core issues the contract and verifies host-supplied DOM and screenshot digests before and after an action, with origin, injection and postcondition checks. MCP/Core never claims to own the browser.

## Chat path

Use `nyra_reliability_chat_evaluate` before answering a chat that contains external or user-supplied material. The response contains only provenance digests, injection flags and gate states; raw message text is not returned or persisted by this layer. A response may be presented as verified only when the claim gate is verified and the completion gate has an independent receipt.

## Core endpoints

The `/v1/reliability/*` endpoints are authenticated and tenant-scoped. Read operations use `read:decision`; state-changing ledger operations use `write:decision`. Production readiness requires the reliability state store to be PostgreSQL-backed, restart-durable and distributed. No reliability endpoint enables provider execution.

## Gate states

The safe outcomes are `verified`, `unverified`, `contradicted`, `blocked`, `rejected`, `budget_exhausted`, `ready_for_revalidation` and `abstain`. Any missing evidence, signature, scope, nonce, pre-observation, postcondition or independent verifier fails closed.

