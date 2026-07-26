# Nyra Deep Branch V2 — Supervisor Report, pass 8

## Verdetto finale

**APPROVED — 1.434/1.434 nodi; REJECTED 0.** La candidata immutabile V21 supera all’unanimità i controlli di contratto, funzione, registro, causalità, donor isolation, tenant isolation, Universal Core, V1 e rollback. Questa decisione autorizza esclusivamente la promozione controllata della candidata esatta; non autorizza deploy.

## Identità vincolante

- Candidate SHA-256: `f06aee000c9faac835884a37267a9f6570292b77845ab555ecc08fb4652d22d3`
- Fixture SHA-256: `f1a78b71ca853e66942fb7f251038962c4f781d4c26b7f7f6a050f9aae1eb11a`
- Catalog fingerprint: `1ccf65e819096dc4bf5bac79b2d4ea4a41f1c2a5823b04e21c459be33990f3d5` — **MATCH**
- Function registry hash: `3bccfec5a2c2c34e2b0ec20eade63add9f775ac7ead98ebc13fe6d50ea6e0dc2` — **MATCH**
- Runtime SHA-256: `074550ce7b48cf3948c3aa6a212df88cfa3e1d3d1255529f616d80a1e501d4a3` — **MATCH**
- Generator SHA-256: `8d6aff3431eebd5e7e86cf6f5f072448aa311ba8be41c472e824737f66bc5e60` — **MATCH**
- Rollback checkpoint: `sha256:e5899ed88353d413317b0683f19db7280e7d8d049cf150a927d33cc8265c16bc` — **MATCH ricalcolato**

La candidata sorgente mantiene correttamente `supervisor_status=PENDING`; questo report assegna `APPROVED` a ogni nodo. La promozione dovrà consumare questo verdetto e verificare nuovamente SHA, fingerprint e registry hash.

## Copertura strutturale

- 18 rami live, 239 subbranch L1, 1.434 nodi: 239 L2, 239 L3 e 956 L4.
- L4: 239 method, 239 strategy, 239 verifier e 239 metric.
- Contratti completi e indipendenti: **1.434/1.434**.
- Input/output, activation/non-activation, evidenze, Core policy, rischio/confidence, verifier, metriche, fallback, audit, provenance, rollback e quattro classi di test: **1.434/1.434**.
- Placeholder/TODO/nodi vuoti: **0**.

## Function registry e unicità reale

- Registry immutabile: 1.434 funzioni; root hash ricalcolato e verificato.
- Semantic function hash, execution-plan hash e observation-contract hash unici: **1.434/1.434**.
- Profili semantici unici rimuovendo ID, hash e subject: **1.434/1.434**.
- Profili ancora unici dopo normalizzazione dei token funzione: **1.434/1.434**.
- Un tamper coerentemente rehashato sulla singola funzione viene respinto dal registry root e dal catalog fingerprint.
- Le primitive esecutive condivise sono 85; non costituiscono duplicati perché ogni nodo è vincolato a assertions, execution plan, observation contract e donor behavior indipendenti.

## Test indipendenti

| Controllo | Esito |
|---|---:|
| Fixture normalizzate | 5.736/5.736 |
| Pass 4 mutation matrix | 37.284/37.284 respinte |
| Pass 6 exact/full-rebind matrix | 15.774/15.774 respinte |
| Operation full-rebind | 1.434/1.434 respinte |
| Donor matrix: spec/observation/binding | 4.302/4.302 respinte |
| Semantic observation: lunar/donor/missing/duplicate/polarity/join/failure/boundary | 11.472/11.472 respinte |
| Output causalmente modificato da artifact valido | 1.434/1.434 |
| Authority failure | 0 |

La donor matrix rimappa topologicamente V16→V21 e copre tutti i 282 gruppi duplicati storici, i relativi 1.218 nodi e i 216 singleton, per un donor assegnato a ciascuno dei 1.434 nodi.

## V1, tenant e rollback

- Golden V1: **20/20**.
  - Horizontal runtime: **1/1**, hash `16e1bcb2d788396518edbcb54cb6bf1736009070da9f473c2cad57a7bdc3edff`.
  - Core catalog: **1/1**, hash `dc2fe86473cb66bba14c5d15ac21b09747b3bbae4b1d2a84e6a2961b2f564d4d`.
  - Core route: **18/18**, output e hash invariati.
- Tenant isolation: 1.434 adversarial fixture e 1.434 Core-tenant mismatch respinti.
- Feature flag default, tenant estraneo e branch allowlist vuota: fail closed.
- Universal Core resta autorità finale e `execution_authorized=false` in ogni percorso.
- Rollback V1 e kill switch: PASS.

## Benchmark

- Validazione catalogo: **957,771 ms**, budget 5.000 ms.
- 1.434 valutazioni positive: **1.245,250 ms**, media **0,8684 ms/nodo**.
- Confidence calibration: 7/7 vettori, dataset hash e score attesi MATCH.

## Decisione per ramo

| Ramo | L1 | Nodi | Approved | Rejected |
|---|---:|---:|---:|---:|
| `context_intelligence` | 10 | 60 | 60 | 0 |
| `work_intake` | 14 | 84 | 84 | 0 |
| `research_evidence` | 20 | 120 | 120 | 0 |
| `decision_reasoning` | 10 | 60 | 60 | 0 |
| `planning_prioritization` | 15 | 90 | 90 | 0 |
| `risk_governance` | 12 | 72 | 72 | 0 |
| `delegated_authority` | 14 | 84 | 84 | 0 |
| `decision_provenance` | 14 | 84 | 84 | 0 |
| `execution_planning` | 10 | 60 | 60 | 0 |
| `parallel_coordination` | 15 | 90 | 90 | 0 |
| `quality_verification` | 16 | 96 | 96 | 0 |
| `learning_memory` | 10 | 60 | 60 | 0 |
| `adaptive_learning` | 16 | 96 | 96 | 0 |
| `communication_explanation` | 10 | 60 | 60 | 0 |
| `software_intelligence` | 20 | 120 | 120 | 0 |
| `suite_domain` | 8 | 48 | 48 | 0 |
| `smartdesk_domain` | 8 | 48 | 48 | 0 |
| `analyzer_domain` | 17 | 102 | 102 | 0 |

Il dettaglio machine-readable di ogni nodo è in `reports/nyra-deep-v2/supervisor_decisions.json`.

## Release gate

- Supervisor admission: **ALLOW 1.434/1.434 per la candidata esatta**.
- Prossimo passo: promozione controllata, suite CI completa e apertura PR.
- Merge: **NO**, finché la PR non è revisionata.
- Deploy Render: **FALSE**.
- Qualsiasi deploy futuro richiede Universal Core `ALLOW` e conferma esplicita owner.
