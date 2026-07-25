# Nyra Governed Research & Distillation Layer

Questo documento descrive il layer introdotto nel Core MCP per permettere a Nyra di:

- aprire una ricerca governata per tenant;
- usare un registry di fonti affidabili e versionato;
- mantenere workspace di ricerca temporanei e redatti;
- produrre learning candidate verificabili;
- promuovere memoria permanente solo dopo conferma e governance Core.

## Componenti runtime

- `services/skinharmony-core-mcp/src/research-governed-registry.js`
  - registry sorgenti affidabili;
  - learning pack iniziali per branch stabili;
  - mapping branch -> fonti consentite.
- `services/skinharmony-core-mcp/src/research-governed-layer.js`
  - workspace temporanei tenant-scoped;
  - evidence normalization;
  - candidate distillation;
  - status esteso con registry/workspace/candidate/cache.
- `services/skinharmony-core-mcp/src/config.js`
  - feature flag e limiti bounded;
  - allowlist tenant;
  - modalità shadow/advisory/active.
- `services/skinharmony-core-mcp/src/server.js`
  - innesto del layer sul flusso MCP esistente senza duplicare il research cortex.

## Flusso

1. Nyra prepara la ricerca con una richiesta tenant-scoped.
2. Il layer seleziona i branch rilevanti e le fonti ammesse.
3. Il workspace temporaneo viene aperto con TTL e limiti bounded.
4. Le evidenze vengono normalizzate, redatte e collegate al workspace.
5. Il Core continua a governare il verdict di ricerca e la conferma.
6. Alla conferma viene creato un learning candidate.
7. La memoria permanente viene aggiornata solo dal percorso già verificato dal Core.
8. Il workspace viene chiuso e ripulito.

## Feature flag

Usa le seguenti chiavi, senza segreti:

- `NYRA_RESEARCH_DISTILLATION_ENABLED`
- `NYRA_RESEARCH_DISTILLATION_MODE=off|shadow|advisory|active`
- `NYRA_TRUSTED_SOURCE_REGISTRY_VERSION`
- `NYRA_RESEARCH_MAX_DOCUMENTS`
- `NYRA_RESEARCH_MAX_BYTES`
- `NYRA_RESEARCH_TIMEOUT_MS`
- `NYRA_RESEARCH_CACHE_TTL_SECONDS`
- `NYRA_RESEARCH_TENANT_ALLOWLIST`
- `NYRA_DISTILLATION_REQUIRES_REVIEW=true`

## Nota operativa

Il default production è fail-closed. In locale il layer può essere attivato in `shadow`.
