# Runbook: Nyra Governed Research & Distillation Layer

## Shadow enable

Impostare:

- `NYRA_RESEARCH_DISTILLATION_ENABLED=true`
- `NYRA_RESEARCH_DISTILLATION_MODE=shadow`

Lasciare vuote le variabili segrete. Il layer deve restare senza side effect lato utente.

## Verifiche

- `npm test` nel servizio `services/skinharmony-core-mcp`
- `nyra_research_status`
- `nyra_research_plan`
- `nyra_research_ingest`
- `nyra_research_feedback`

## Cleanup

Il workspace si chiude automaticamente alla conferma o alla scadenza TTL.

Se un tenant non è allowlisted, il layer deve restare fuori dal percorso governato.

## Rollback

Per disattivare il layer:

- `NYRA_RESEARCH_DISTILLATION_MODE=off`

Se serve, anche:

- `NYRA_RESEARCH_DISTILLATION_ENABLED=false`

Non tocca la modalità V2 o il DTT.
