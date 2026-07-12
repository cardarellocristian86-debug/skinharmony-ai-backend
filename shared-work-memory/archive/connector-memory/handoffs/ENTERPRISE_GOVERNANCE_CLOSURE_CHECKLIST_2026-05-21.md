# Enterprise Governance Closure Checklist - 2026-05-21

Scope: chiudere il livello enterprise SkinHarmony end-to-end, senza deploy e senza produzione.

Core usato:
- Gate Core 2.0 locale: `ADVISORY_ONLY`, rischio `low`, report `reports/codex-core/codex_core_gate_latest.json`.
- Tentativo `decide` Core 2.0 su 10 varianti: non ha restituito una selezione esplicita; il connettore ha prodotto fallback `runtime_first`, quindi non va registrato come decisione Core ufficiale.

Regola di lavoro:
- non si spunta `[x]` se manca prova locale;
- se una voce esiste solo come documento o parziale, resta `[/]`;
- se Core non seleziona o non risponde, va scritto come gap, non trasformato in approvazione;
- nessun publish, deploy, update live, chiave, tenant o dato cliente reale dentro questa checklist.

Legenda:
- `[ ]` aperto
- `[/]` parziale/in corso
- `[x]` chiuso con prova minima
- `[!]` bloccato

## 1. Industrializzazione

[x] 0. Regola operativa massiva Codex -> Core -> Suite/Smart Desk

Regola chiusa:
- Codex ricerca e genera massivamente.
- Core riceve segnali compressi e decide.
- Suite e Smart Desk eseguono solo flussi governati.

Criterio di chiusura:
- contratto macchina-leggibile;
- test locale;
- validator governance aggiornato;
- manifest validi aggiornati;
- nessun payload massivo raw al Core.

Prova:
- `runtime/enterprise-governance/massive_research_core_compression_contract_v1.json`;
- `npm run enterprise:massive-core-contract:test` -> OK;
- `npm run suite:governance:test` -> OK `18/18`;
- report `SHARED_MEMORY/reports/ENTERPRISE_GOVERNANCE_MICROBLOCK_5_MASSIVE_RESEARCH_CORE_COMPRESSION_RULE_2026-05-21.md`.

[/] 1.1 Standardizzare flussi principali

Stato reale:
- esistono contratti Suite/Core/Codex/WordPress;
- esiste regola template madre -> clone -> Core check -> verifica -> publish;
- esistono workflow INCI, Page Factory, Site Clone Engine e Smart Desk bridge;
- manca ancora un manuale unico enterprise che renda questi flussi uguali per ogni brand/cliente.

Criterio di chiusura:
- manuale operativo unico;
- flussi replicabili per pagina, lead, CRM, claim, pricing, Smart Desk, release;
- comandi/test di preflight dichiarati;
- output standard per ogni flusso.

Prova minima richiesta:
- documento operativo unico;
- test locale che valida la presenza dei contratti richiesti.

[/] 1.2 Ridurre dipendenze implicite

Stato reale:
- molte regole vivono in snapshot, report, prompt, memoria condivisa e codice;
- il drift del binario installato del connettore e stato trovato e corretto: ora il runtime Desktop espone `session-start`, `lock`, `checkpoint`, `finalize`, `orchestrator-status`, `doctor`.

Criterio di chiusura:
- lista autoritativa delle fonti;
- regola su quale fonte vince in caso di conflitto;
- connettore installato allineato alla versione locale.

Prova minima richiesta:
- SSOT registry valido;
- report drift con azione correttiva.

Prova parziale chiusa:
- report `SHARED_MEMORY/reports/ENTERPRISE_GOVERNANCE_MICROBLOCK_1_SSOT_CONNECTOR_DRIFT_2026-05-21.md`;
- `npm run enterprise:governance:ssot:test` OK;
- connettore Desktop aggiornato a `0.2.18`;
- `SH_CORE_LAB_2_0=1 SH_CORE_API_KEY=local-test sh-core-codex doctor` OK.

[/] 1.3 Rendere flussi replicabili multi-brand

Stato reale:
- il Site Clone Engine ha campi per famiglia prodotto, sorgente, operatore, posizionamento, competitor, sito madre e scheda tecnica;
- i contratti sono in larga parte tenant-agnostic;
- manca ancora una suite di scenari multi-brand standard.

Criterio di chiusura:
- scenari minimi: SkinHarmony, brand esterno, distributore, fabbrica, franchising, centro operativo;
- ogni scenario deve produrre readiness, risk band, contratti richiesti e output atteso.

## 2. Governance tecnica forte

[/] 2.1 Queue vere

Stato reale:
- esistono code leggere in Suite e queue write in Smart Desk;
- non esiste ancora un queue layer unico enterprise per Codex/Suite/Smart Desk/Core.
- contratto job enterprise locale creato, con stati e idempotency obbligatoria.

Criterio di chiusura:
- schema job standard;
- stati `queued`, `running`, `blocked`, `review_required`, `done`, `failed`, `rolled_back`;
- retry policy e idempotency key.

Prova parziale:
- `runtime/enterprise-governance/enterprise_runtime_contracts_v1.json`;
- `npm run enterprise:runtime-contracts:test` -> OK.
- Suite Control Plane blocca `action-mediation` sensibile se manca `runtime_contract`.

[/] 2.2 Lock e concurrency control

Stato reale:
- il connettore locale nel repo supporta lock/checkpoint;
- il binario runtime installato sul Desktop non risulta allineato;
- i lock sono file-based, utili localmente ma non ancora distributed lock enterprise.
- contratto lock enterprise locale creato, con scope, timeout e force unlock con owner/audit.

Criterio di chiusura:
- comando lock disponibile nel binario installato;
- lock richiesto prima di mutazioni;
- lock ownership e timeout;
- conflitti rilevati e bloccati.

Prova parziale:
- binario Desktop allineato ed espone `lock`;
- lock `enterprise-governance` acquisito con owner `codex_enterprise_governance`;
- contratto lock validato da `enterprise:runtime-contracts:test`.
- Suite Control Plane richiede lock nel `runtime_contract` per azioni sensibili.

[/] 2.3 Audit forte e append-only

Stato reale:
- esistono eventi `EVENTS.jsonl`, report Core, audit Suite e manifest WordPress;
- non esiste ancora un audit append-only unico con correlazione end-to-end obbligatoria.
- contratto audit append-only locale creato, con `correlation_id` e link a job/session/lock/test.

Criterio di chiusura:
- ogni azione significativa ha `correlation_id`;
- ogni publish/update/release ha `core_audit_id`, manifest, rollback e test;
- eventi non sovrascrivibili.

Prova parziale:
- contratto audit validato da `enterprise:runtime-contracts:test`.
- Suite Control Plane richiede audit con `core_audit_id` nel `runtime_contract`.

[/] 2.4 Rollback

Stato reale:
- contratti e manifest chiedono backup/diff/rollback;
- WordPress page preflight lo richiede per write sensibili;
- manca una procedura rollback unica per plugin, pagina, Suite, Smart Desk e Core config.
- contratto rollback locale creato per publish, update, release, migration, write production, tenant scope e pricing.

Criterio di chiusura:
- rollback contract per ogni famiglia azione;
- prova locale o dry-run;
- owners e limiti dichiarati.

Prova parziale:
- contratto rollback validato da `enterprise:runtime-contracts:test`.
- Suite Control Plane richiede rollback plan, backup e verification step nel `runtime_contract`.

[/] 2.5 Distributed state e conflict resolution

Stato reale:
- Shared Memory contiene sessioni, lock, checkpoint ed eventi;
- Suite, WordPress, Core e Smart Desk hanno stati propri;
- non esiste ancora un resolver unico dei conflitti tra queste fonti.
- contratto conflict resolution locale creato, con priorita fonti e stop condition.

Criterio di chiusura:
- gerarchia delle fonti;
- conflict policy;
- regola di stop quando due fonti discordano.

Prova parziale:
- contratto conflict resolution validato da `enterprise:runtime-contracts:test`.
- non ancora agganciato a lettura stati reali multi-sorgente.

## 3. Single Source of Truth

[x] 3.1 Gerarchia autoritativa

Regola target:
- Core Render: decisioni prodotto, policy, rischio, branch, tenant, chiavi e audit produzione.
- Core frozen/v0: baseline stabile e confronto regressioni.
- Core 2.0 locale: laboratorio Codex, varianti, worker e metodo.
- Suite Control Plane: flussi commerciali, readiness, manifest, CRM B2B, pagine e orchestrazione.
- WordPress: superficie pubblicata e contenuto live.
- Smart Desk: dati operativi centro e azioni confermate.
- SkinHarmony Core plugin: adattatore WordPress per traduzione, claim/content governance e bridge.
- Core Admin: gestione owner di chiavi, clienti, pacchetti e setup.
- Connector Codex: esecutore vincolato, non fonte della verita.
- Shared Memory: memoria di lavoro e audit locale, non autorita finale di prodotto.

Criterio di chiusura:
- questa gerarchia deve essere registrata in un registry macchina-leggibile;
- ogni modulo deve dichiarare owner, input, output, fonte, blocchi vietati.

Prova:
- registry locale: `runtime/enterprise-governance/enterprise_governance_ssot_registry_v1.json`;
- test: `npm run enterprise:governance:ssot:test` -> `Enterprise governance SSOT registry OK`;
- JSON valido: `package.json` e registry parsati correttamente.

[x] 3.2 Drift/versioni

Stato reale:
- riscontrato e corretto drift tra connettore repo e binario installato;
- riscontrato e corretto drift Site Suite tra header `5.1.89` e costante `SHSS_VERSION 5.1.88`;
- rigenerati zip locali Suite `5.1.89`, `latest` e generico con stesso hash.

Criterio di chiusura:
- check versione per connettore e Suite;
- report drift obbligatorio;
- blocco release se versione header/costante/package non coincidono.

Prova:
- report `SHARED_MEMORY/reports/ENTERPRISE_GOVERNANCE_MICROBLOCK_2_VERSION_DRIFT_2026-05-21.md`;
- `npm run enterprise:version-drift:test` -> `Enterprise version drift OK | connector=0.2.18 | suite=5.1.89`;
- `SHSS_EXPECTED_VERSION=5.1.89 node scripts/test_skinharmony_site_suite_plugin.js` -> OK;
- `/opt/homebrew/bin/php -l wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php` -> no syntax errors.

## 4. Contratti tra moduli

[/] 4.1 Contratto input/output/schema

Stato reale:
- esistono contratti Suite/Core/Codex per ruoli, clone visuale, rami, CTA, validator, storyline, write safety ed enforcement;
- manca un registry unico che li leghi a tutti i moduli enterprise, inclusi Smart Desk, Core Admin, SkinHarmony Core, CRM, Claim Guard, Pricing Guard.

Criterio di chiusura:
- ogni modulo ha input/output/schema/risk/readiness/publish contract;
- ogni flusso dichiara moduli attraversati e blocchi.

[/] 4.2 Readiness e risk band

Stato reale:
- Suite e Core producono readiness/risk in vari punti;
- manca standard unico cross-modulo.

Criterio di chiusura:
- risk band condivisa `low`, `medium`, `high`, `blocked`;
- readiness condivisa `draft`, `ready`, `review_required`, `blocked`, `published`;
- nessun publish se readiness non e coerente.

[/] 4.3 Publish, branch e rollback contracts

Stato reale:
- Page Factory e WordPress preflight bloccano molte condizioni errate;
- branch matrix esiste;
- manca collegamento esplicito per tutti i flussi non-pagina.

Criterio di chiusura:
- publish contract per pagine, plugin, Smart Desk, Core config, Suite package;
- branch contract per marketing, site creation, claim, pricing, translator, Smart Desk, release;
- rollback contract per ogni azione sensibile.

## Gap Core 2.0 da non nascondere

[!] 5.1 Decisione opzioni non esplicita

Fatto:
- il Core 2.0 locale ha risposto `401` sul flusso `decide`;
- il connettore ha generato fallback `runtime_first`;
- questo non e una selezione Core ufficiale.

Criterio di chiusura:
- Core 2.0 deve restituire `selected_option_id` esplicito oppure il connettore deve degradare il lavoro a `review_required`, non a raccomandazione operativa.

## Prossimo micro-blocco obbligatorio

1. Implementare queue reale e lock timeout.
2. Collegare audit/correlation id end-to-end anche su Shared Memory e Connector exec.
3. Implementare conflict resolver reale multi-sorgente.
4. Definire rollback runner per famiglie azione.
