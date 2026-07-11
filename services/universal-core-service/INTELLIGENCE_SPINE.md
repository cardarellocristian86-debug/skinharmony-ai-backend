# SkinHarmony Intelligence Spine - Phase 1

This phase adds a passive, fail-open experience ledger around Universal Core.

## Guarantees

- Shadow mode only: no decision, policy, score, action, or response is changed.
- CloudEvents 1.0-compatible event envelopes.
- No raw request/response body, credentials, images, email, or customer data is written.
- Tenant identifiers are pseudonymized before storage.
- Append-only JSONL ledger with a chained integrity hash.
- Optional HMAC signing through `CORE_EXPERIENCE_SIGNING_SECRET`.
- Existing Core audit/evidence remains authoritative.

## Environment

- `SKINHARMONY_INTELLIGENCE_SPINE_ENABLED=false` disables collection.
- `CORE_EXPERIENCE_SIGNING_SECRET` signs the hash chain in production.
- `CORE_EXPERIENCE_REF_SECRET` pseudonymizes tenant references.

In production, configure both secrets in the platform secret store. Never commit them.

## Stored fields

The ledger stores route, method, status, duration, pseudonymous tenant reference, trace/request IDs, and a minimal decision summary. It deliberately excludes raw bodies and credentials.

## Next phases

1. Add explicit, authenticated outcome and owner-feedback contracts.
2. Instrument Nyra, Site Suite, Smart Desk, and Analyzer with the same schema.
3. Build governed datasets from the ledger.
4. Add MLflow and PyTorch training in a separate service.
5. Export approved challenger models to ONNX and keep Universal Core as final judge.
