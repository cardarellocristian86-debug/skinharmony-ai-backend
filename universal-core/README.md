# Universal Core

Universal Core e' il progetto centrale per verificare se il motore nato da Gold puo' diventare un cervello riutilizzabile sopra piu' software e domini.

## Roadmap ufficiale

- `docs/OFFICIAL_ROADMAP_STATUS.md`
- `docs/UNIVERSAL_CORE_BOUNDARIES.md`
- `docs/UNIVERSAL_CORE_IN_OUT_FREEZE.md`
- `docs/CONTRACT.md`
- `docs/UNIVERSAL_CORE_BASELINE_V0.md`
- `docs/UNIVERSAL_CORE_DIGEST_V1.md`
- `docs/UNIVERSAL_CORE_DIGEST_RUNTIME_V2.md`

Stato attuale:

- Blocco completato: `BLOCCO 1 - Congelare Universal Core`
- Baseline stabile: `universal_core_v0`
- Contratto congelato: `universal_core_contract_v0`
- Digest canonico: `universal_core_digest_v1`
- Digest runtime fast path: `universal_core_digest_runtime_v2`
- Blocco corrente: `BLOCCO 2 - Disegnare Flow Core`
- Step completato: `BLOCCO 2 - Step 6 - definire i rami reali da orchestrare`
- Prossimo step: `BLOCCO 2 - Step 7 - dependency graph tra i rami`

Principio:

```text
Un solo Core centrale.
Molti branch dominio-specifici.
I branch usano il core, non lo riscrivono.
```

Profilo digest:

```text
V0 = verita' completa
V1 = digest canonico
V2 = runtime fast path di V1 in scope controllato
```

## Componenti core

- State Layer
- Oracle Layer
- Risk Layer
- Control Layer
- Confidence Layer
- Priority Engine
- Execution Profile Engine

## Branch iniziali

- Gold / gestionale
- Assistant
- FlowCore
- Marketing
- CRM

Registro operativo:

- `docs/FLOW_CORE_BRANCH_REGISTRY_V1.md`

## Regola principale

Il core non deve contenere oggetti specifici di dominio.

Esempi vietati dentro il core:

- appuntamento
- cliente
- magazzino
- processo macOS
- campagna email
- post social
- ticket assistenza

Questi vivono nei branch adapter.
