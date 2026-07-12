# SkinHarmony Workspace Memory Index

Ultimo aggiornamento: 2026-05-20T00:00:00+02:00

## File da leggere all'avvio
- `README_FOR_CODEX.md`
- `snapshots/MAP_SNAPSHOT.md`
- `snapshots/STATE_SNAPSHOT.md`
- `snapshots/WORK_SNAPSHOT.md`
- `handoffs/ECOSYSTEM_GAP_CHECKLIST.md`
- `handoffs/ENTERPRISE_GOVERNANCE_CLOSURE_CHECKLIST_2026-05-21.md` quando lavori su industrializzazione, governance tecnica forte, single source of truth, contratti tra moduli o multi-Codex
- `../docs/INDUSTRIALIZZAZIONE_MACCHINARI_ESTETICA_CORE.md` per la linea Core embedded/edge dentro macchinari estetici: safety supervisor, limitatore parametri, manutenzione, audit e Core Machine Guard
- `handoffs/SMARTDESK_WEB_DESKTOP_ALIGNMENT_SPEC.md`
- `handoffs/SMARTDESK_GOLD_CORE_SPEC.md`
- `handoffs/SMARTDESK_WEB_ALIGNMENT_EXECUTION_ROADMAP.md`
- `handoffs/SMARTDESK_WEB_ARCHITECTURE_MAP_2026-05-18.md`
- `handoffs/SMARTDESK_LIVE_WEB_SOURCE_MAP.md`
- `handoffs/SMARTDESK_FUNCTIONAL_VALIDATION_CHECKLIST.md`
- `handoffs/CORE_2_0_LOCALIZE_UI_AUDIT_SPEC_2026-05-19.md` quando progetti il primo comando del connector di localizzazione governata
- `handoffs/CORE_2_0_LOCALIZATION_WORKFLOW_MANUAL_2026-05-19.md` per usare audit/proposal/future patch senza confondere Core 2.0 locale e Core Render
- `reports/CORE_2_0_LOCALIZE_UI_APPLY_RUN_2026-05-19.md` per vedere il primo run reale `audit -> proposal -> apply -> build` e il verdetto operativo del laboratorio Core 2.0
- `reports/CORE_2_0_LOCALIZATION_WORKER_TEST_2026-05-19.md` per vedere il test reale dopo l’estrazione del worker localization dal CLI
- `packages/core-codex-connector/src/localization-worker.mjs` come sede corretta della logica operativa di localizzazione; non mettere questa logica nel Core 2.0
- `scripts/run_smartdesk_local_validation.sh` per collaudo tecnico locale Smart Desk
- `reports/CORE_2_0_FAILURE_READ_REPORT.md` quando tocchi Core/connector/gate locale
- `reports/CORE_2_0_GOVERNED_LOCALIZATION_MULTIVERSE_2026-05-19.md` quando devi progettare plugin/connector Codex per traduzione software, pulizia UI, claim guard e separazione ruoli Core/Codex/worker
- `reports/SMARTDESK_RENDER_GOLD_UNIFIED_ENGINE_ASSESSMENT_2026-05-19.md` quando devi capire cosa esiste davvero oggi su Render per crescita centro, forecast prudenziale, lettura Gold e cosa non va reinventato
- `reports/SMARTDESK_GOLD_WHY_IT_WORKS_2026-05-19.md` quando devi spiegare cosa c e dietro Smart Desk Gold, perche non e solo chatbot e come va chiuso il prodotto
- `reports/SITE_SUITE_DETAILED_OPERATING_ARCHITECTURE_2026-05-19.md` quando devi leggere Suite in modo completo: livelli, moduli, monolite residuo, Core locale, control plane, automazioni, Smart Desk bridge e runtime remoto
- `reports/SUITE_VISUAL_ENGINE_MODULAR_ENTERPRISE_CONTRACT_2026-05-23.md` quando lavori su Visual Engine o moduli nuovi collegabili: fissa la regola moduli autonomi ma integrati tramite contratti con Suite, Core, Nyra, traduttore, Codex e audit
- `reports/SITE_SUITE_FREEZE_CORE_2_0_ATTEMPT_2026-05-19.md` quando devi sapere cosa ha davvero risposto Core 2.0 sul freeze di Suite, cosa non ha risposto e perche il fallback connector non va confuso con una decisione ufficiale
- `reports/SITE_SUITE_DEMO_CLOSURE_CONTROL_ROOM_2026-05-19.md` quando devi capire cosa e gia stato chiuso davvero per fare di Suite la cabina unica della demo sito SkinHarmony e come leggere i blocchi `page/content/CRM/offerta/rete/Smart Desk bridge`
- `reports/codex-core/CORE_2_0_CODEX_USAGE_REPORT.md` quando usi Core 2.0/Core Codex e devi registrare benefici, errori, latenza e verdetto
- `reports/CORE_CODEXAI_ORCHESTRATOR_CONNECTOR_RESEARCH_2026-05-20.md` quando devi configurare o migliorare il connettore CodexAI, orchestratore multi-Codex, shared memory, locks, hooks, MCP e report vincolanti
- `policies/CODEX_MISSION_CONTROL_AUTONOMY_POLICY_V1.md` quando lavori con piu Codex: livelli `allow_auto`, `allow_with_audit`, `review_required`, `owner_required`, `blocked`; owner solo quando Core/Nyra lo richiedono davvero
- `policies/CODEX_RESEARCHER_COMMAND_RUST_EXTRACTOR.md` come prompt/comando pronto per avviare il Codex ricercatore sul task estrattore/traduttore
- `policies/CODEX_CODE_CORRECTOR_SHARED_WORK_MODE_V1.md` quando questo agente entra in un lavoro condiviso come `codex-correttore-codici`: legge lavoro degli altri Codex, usa risultati del ricercatore analista, corregge errori di codice, verifica e chiude
- `policies/CODEX_SUPPORT_SHARED_WORK_MODE_V1.md` come compatibilita storica per `codex-supporto`: Core come giudice, controllo del worker/ricercatore, lock rispettati, findings e verifica end-to-end
- `reports/codex-orchestrator/CONNECTOR_0_2_17_RELEASE_REPORT.md` per usare e installare il connettore Core Codex con sessioni, lock, checkpoint, finalize e doctor
- `reports/codex-orchestrator/CONNECTOR_0_2_18_CORE_SEPARATION_FIX.md` per ricordare che Core 2.0 resta locale/condiviso per Codex e Render/Core v0 resta il percorso prodotto per Suite, Smart Desk, plugin e tenant
- `reports/codex-orchestrator/CONNECTOR_0_2_19_LIVE_SUPERVISION.md` per usare intent-start, pulse e core2-watch: Core 2.0 richiama Codex durante il lavoro se sta andando fuori direzione o resta superficiale
- `reports/codex-orchestrator/CONNECTOR_0_2_20_E2E_SUPERVISION_REPORT.md` per usare supervise persistente: controlla pulse, file modificati dopo il pulse, evidenze, test e deriva dal comando owner
- `reports/codex-orchestrator/CONNECTOR_0_2_21_CONTROL_ROOM_DASHBOARD.md` per aprire la dashboard locale eventi/decisioni/sessioni/lock/verdict in tempo quasi reale
- `reports/codex-orchestrator/CONNECTOR_0_2_22_HUMAN_CONTROL_ROOM_UI.md` per usare la dashboard leggibile owner: cosa guardare adesso, Codex attivi, flag tradotti e principi mission-control/AI governance
- `README_FOR_CODEX.md` se devi aprire un nuovo Codex collegato al connettore: usare `./scripts/start-codex-agent.sh <agent_id> <scope>`, che crea sessione, intent, pulse iniziale, `core2-watch --once` e poi apre Codex
- `reports/codex-orchestrator/CONNECTOR_0_2_19_DECIDE_EXPLICIT_SELECTION_FIX.md` per ricordare che `decide` richiede `selected_option_id` esplicito dal Core e non usa piu fallback come decisione
- `reports/codex-orchestrator/CONNECTOR_CODEXAI_GOVERNED_SETUP_TEST_2026-05-21.md` per verificare setup CodexAI con connettore, sessione e lock obbligatori; test `npm run connector:guarded-setup:test`
- `runtime/enterprise-governance/enterprise_governance_ssot_registry_v1.json` come registry locale della gerarchia autoritativa enterprise; validare con `npm run enterprise:governance:ssot:test`
- `reports/ENTERPRISE_GOVERNANCE_MICROBLOCK_1_SSOT_CONNECTOR_DRIFT_2026-05-21.md` per vedere cosa e stato chiuso su SSOT locale e drift connettore Desktop
- `reports/ENTERPRISE_GOVERNANCE_MICROBLOCK_2_VERSION_DRIFT_2026-05-21.md` per vedere la chiusura drift versione connettore/Suite e il test `enterprise:version-drift:test`
- `reports/ENTERPRISE_GOVERNANCE_MICROBLOCK_3_RUNTIME_CONTRACTS_2026-05-21.md` per vedere job/lock/audit/rollback/conflict contracts e il test `enterprise:runtime-contracts:test`
- `reports/ENTERPRISE_GOVERNANCE_MICROBLOCK_4_CONTROL_PLANE_RUNTIME_ENFORCEMENT_2026-05-21.md` per vedere l enforcement locale runtime contract nel Suite Control Plane
- `runtime/enterprise-governance/enterprise_runtime_contracts_v1.json` come contratto locale job/lock/audit/rollback/conflitti; validare con `npm run enterprise:runtime-contracts:test`
- `runtime/enterprise-governance/massive_research_core_compression_contract_v1.json` come regola stabile: Codex ricerca/genera massivamente, Core decide su segnali compressi, Suite/Smart Desk eseguono flussi governati; validare con `npm run enterprise:massive-core-contract:test`
- `reports/ENTERPRISE_GOVERNANCE_MICROBLOCK_5_MASSIVE_RESEARCH_CORE_COMPRESSION_RULE_2026-05-21.md` per vedere l enforcement della regola massiva dentro validator governance e fixture
- `freeze/SKINHARMONY_CORE_1_0_COMMERCIAL_FREEZE.md` prima di modificare SkinHarmony Core, Universal Core collegato al plugin, Claim Guard, traduzione governata o bridge WordPress/Core
- `policies/WORDPRESS_PLUGIN_HORIZONTAL_RULE.md` prima di modificare plugin WordPress Core/Site Suite: i plugin restano orizzontali, i dati SkinHarmony e le traduzioni specifiche stanno fuori dal codice
- `policies/HORIZONTAL_CORE_NYRA_SOFTWARE_LANGUAGE_GATE_V1.md` prima di modificare traduttore, Smart Desk, AI Gold, Suite o qualsiasi software che chiama Core/Nyra: radar lingua orizzontali + filtro V2/V1/V0 sono obbligatori, non decorativi
- `reports/core-commercial-freeze/README.md` per generare report uso/test prima di aprire modifiche dopo il freeze commerciale
- `reports/SMARTDESK_FAILURE_READ_REPORT.md` quando tocchi Smart Desk
- `reports/SITE_SUITE_FAILURE_READ_REPORT.md` quando tocchi Site Suite
- `reports/WORDPRESS_PLUGIN_RELEASE_FAILURE_READ_REPORT.md` quando tocchi zip/release/plugin
- `reports/SKIN_ANALYZER_PRO_LOCAL_APPS_STATUS_2026-06-15.md` quando lavori su Skin Analyzer Pro locale iPad/Android: stato installazioni, APK, selector locale, confini e prossimo test
- `events/EVENTS.jsonl` solo ultime righe rilevanti
- `decisions/DECISIONS.jsonl` solo ultime decisioni rilevanti

## Aree attive
- Site Suite / WaaS / Operating Ecosystem
- Universal Core su Render
- Core Traduttore / Claim Guard / marketing copy
- Smart Desk / AI Gold / Fleet
- Codex connector / Core gate
- SkinHarmony Visual Engine / bridge visuale / asset automation governata

## Regola stabile
Prima di modificare pagine/nodi SkinHarmony: template madre -> clone -> Core check -> verifica rendering -> publish/update.
- `2026-05-19` [WORDPRESS_500_GLOBAL_HTACCESS_INCIDENT_2026-05-19.md](./reports/WORDPRESS_500_GLOBAL_HTACCESS_INCIDENT_2026-05-19.md)
