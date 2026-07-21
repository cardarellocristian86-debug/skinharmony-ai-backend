# Universal Core Service

Servizio centrale Render-ready per esporre Universal Core come decision engine multi-tenant.

## Contratto orizzontale

Universal Core e Nyra sono runtime agnostici: nomi di tenant, brand o prodotto non attivano mai un verticale. Senza metadati espliciti della chiave Core il runtime usa sempre il pack `generic`.

I verticali sono pack prodotto separati e allowlist-based:

- `suite` abilita soltanto i rami Suite;
- `smartdesk` abilita soltanto i rami SmartDesk;
- `analyzer` abilita soltanto i rami Analyzer e beauty advisory;
- `regulated_demo` resta un pack di riferimento senza rami prodotto.

Un pack non può essere scelto nel payload della richiesta: viene risolto esclusivamente da `metadata.domain_pack_id` della chiave Core autenticata. Il vecchio pack ombrello `skinharmony` non esiste.

Ruoli:
- WordPress/Suite raccolgono dati e renderizzano UI.
- Smart Desk esegue operazioni nel proprio perimetro.
- Universal Core decide priorita, rischio, review e guardrail.
- Nyra spiega le priorita in modo operativo.

## Endpoint principali

- `GET /healthz`
- `GET /v1/keys/presets`
- `POST /v1/keys/generate` con admin key
- `POST /v1/keys/revoke` con admin key
- `GET /v1/tenant/status`
- `POST /v1/snapshot`
- `GET /v1/snapshot`
- `POST /v1/decision`
- `POST /v1/action-evaluator`
- `POST /v1/work/preflight`
- `POST /v1/codex/context`
- `POST /v1/codex/guard`
- `POST /v1/flowcore/decision`
- `GET /v1/branches`
- `POST /v1/branches/:branch/analyze`
- `GET /v1/ecosystem-pulse`
- `GET /v1/calibration/status`
- `POST /v1/calibration/evaluate`
- `POST /v1/policy/check`
- `POST /v1/claim-guard/check`
- `GET /v1/compliance/claim-shield/status`
- `POST /v1/compliance/claim-shield/check`
- `POST /v1/pricing-guard/check`
- `POST /v1/sync/suite`
- `POST /v1/sync/wordpress`
- `GET /v1/review/pending`
- `POST /v1/review/action`
- `POST /v1/intelligence/workflow`
- `POST /v1/intelligence/scenarios`
- `POST /v1/intelligence/hypotheses/rank`
- `POST /v1/intelligence/events/evaluate`
- `POST /v1/intelligence/counterfactuals/evaluate`
- `POST /v1/intelligence/decisions/select`
- `POST /v1/intelligence/outcomes/verify`
- `POST /v1/intelligence/outcomes/record`
- `GET /v1/intelligence/calibration`

## Intelligence Contract v1

Il runtime `0.8.0-full-intelligence` completa il flusso Nyra + Core con nove
funzioni analitiche componibili. Il motore usa log-odds esplicite per combinare
prior ed evidenze, conserva un intervallo di probabilita legato alla qualita dei
dati e rende visibili tutti i contributi. Per le decisioni calcola valore atteso,
utilita, rischio, costo e reversibilita; per gli esiti calcola Brier score, errore
di calibrazione e sorpresa informativa.

Il workflow completo segue questa sequenza:

`memoria tenant -> ipotesi -> scenari -> eventi -> controfattuali -> decisione -> verifica -> calibrazione`

Proprieta invarianti:

- isolamento tenant e chiave Core dedicata;
- memoria richiamata prima dell'analisi;
- probabilita sempre accompagnata da assunzioni e incertezza;
- esiti persistiti in modo idempotente con evidenza firmata;
- calibrazione separata per tenant e nessuna auto-modifica opaca dei pesi;
- `execution_allowed: false`: l'analisi consiglia, la governance autorizza.

Esempio minimo:

```json
{
  "request": "Valuta il lancio controllato",
  "hypotheses": [
    { "id": "growth", "prior_probability": 0.55, "evidence": [{ "direction": "supports", "strength": 0.8, "reliability": 0.9 }] },
    { "id": "flat", "prior_probability": 0.45 }
  ],
  "options": [
    { "id": "controlled", "probability": 0.72, "value": 88, "cost": 30, "risk": 24, "reversibility": 90 },
    { "id": "full", "probability": 0.61, "value": 100, "cost": 48, "risk": 65, "reversibility": 30 }
  ],
  "generate_scenarios": true
}
```

## Chiavi

Le chiavi sono scoped, revocabili e tenant-bound. La chiave in chiaro viene mostrata solo alla creazione.

Tipi:
- `connector`: WordPress/Suite/Smart Desk verso Core.
- `automation`: Codex/automazioni controllate, con scope limitato.
- `user_session`: riservato a sessioni prodotto future.

Preset pronti:
- `suite_connector`: collega Site Suite al Core.
- `smartdesk_connector`: collega Smart Desk al Core.
- `wordpress_connector`: collega un WordPress/nodo al Core.
- `codex_automation`: chiave scoped per automazioni controllate Codex.
- `readonly_monitor`: sola lettura/monitoraggio.

## Decision contract v1

Ogni client che deve pubblicare, approvare, cambiare stato, proporre pricing, validare claim, decidere workflow o attivare Codex deve leggere il contratto decisionale del Core prima di agire.

Forma stabile:

```json
{
  "state": "observe | attention | blocked | ready",
  "confidence": 0,
  "risk_band": "low | medium | high",
  "control_level": "observe | confirm | blocked",
  "publish_safe": false,
  "recommended_actions": [],
  "blocked_reasons": []
}
```

Regola architetturale:

`OpenAI genera. Universal Core decide. Nyra spiega. I client eseguono solo entro i limiti del Core.`

## Provider OpenAI: link monouso e binding Core

Una chiave OpenAI esistente entra esclusivamente nella pagina protetta raggiunta dal flusso proprietario. Il link fisso del MCP apre un login OAuth; soltanto dopo aver verificato il tenant e il soggetto owner autorizzato, il Core emette un link monouso a vita breve. Il token nel percorso e la prova nel frammento URL sono entrambi necessari, il frammento non viene inviato al server e il consumo del link con il salvataggio cifrato avvengono nella stessa transazione PostgreSQL. Un errore o una revoca non lasciano una chiave modificata né un link consumato a metà. Il Core non accetta chiavi provider tramite normali bearer key: le route legacy `PUT` e `DELETE /v1/generic-agents/providers/openai` rispondono `410 provider_setup_link_required`.

Il primo percorso live e volutamente piccolo e separato dalle code generiche: un owner OAuth puo confermare una sola esecuzione firmata e legata alla richiesta, che produce al massimo tre chiamate **Researcher → Reviewer → Nyra Synthesizer**. Il task e limitato a 300 caratteri, ogni risposta a 200 token, non sono disponibili browser, tool, scritture, retry o apprendimento. `POST /v1/generic-agents/providers/openai/multi-agent-runs` restituisce subito un `run_id`; il kill signal annulla la chiamata in corso e blocca gli stage successivi. Gli output restano solo in memoria fino alla lettura dell'owner OAuth; checkpoint e audit conservano soltanto metadati e digest redatti. Una conferma firmata e monouso e viene registrata nel database del vault come hash, quindi non puo essere riutilizzata dopo un riavvio. `execution_enabled` del vault resta `false`: non esiste un interruttore globale; la sola disponibilita e il workflow fisso richiedono ogni volta tenant configurato e conferma owner.

Questa prima implementazione e volutamente a **una sola istanza Core**: lo stato attivo e la cancellazione vivono nel processo per evitare che una richiesta venga instradata a un worker diverso. Il Blueprint Render dichiara quindi `numInstances: 1`; prima di scalare va introdotto un lease condiviso per i run attivi.

La regola `reversible_owner_confirmed_provider_setup_link_blueprint_binding` consente solo il binding Render interno da `skinharmony-core-mcp` a `skinharmony-universal-core`, sul Blueprint `exs-d99edqgki2s73e29nug`, ramo `main`, tenant `codexai`, e solo per `CORE_PROVIDER_SETUP_LINK_BOOTSTRAP_KEY` e `CORE_PROVIDER_SETUP_LINK_TENANT_ID`. Vieta esecuzione provider, modifiche Auth0, deploy, merge, rotazioni, cancellazioni, target alternativi e campi non previsti.

Quando MCP e Core sono entrambi gestiti dai rispettivi Blueprint Render, `CORE_OWNER_CONTEXT_SIGNING_SECRET` viene generato una sola volta sul MCP e passato al Core con un riferimento `fromService`: non viene visualizzato, copiato o salvato nel repository. Il segreto firma una conferma OAuth owner con scadenza breve e legata crittograficamente all’envelope esatto; non è una chiave OpenAI né una chiave bearer Core. Finché un Core esistente non viene associato a `render-universal-core.yaml`, il controllo resta fail-closed e non memorizza alcuna chiave provider. Questo gate autorizza e registra il binding: non e un esecutore Render. Un Blueprint Render può sincronizzare il proprio `fromService` senza consumare un verdict Core, quindi non va presentato come un blocco fisico del deploy finché non verrà aggiunto un executor CI/Render che verifichi un'approvazione firmata. L'enforcement dell'infrastruttura rimane nei controlli Render/GitHub e `provider_execution` resta `false` finché non viene autorizzato separatamente.

## Work preflight obbligatorio

Ogni AI collegata tramite Core/MCP deve passare la richiesta a
`POST /v1/work/preflight` prima del lavoro. Il contratto e memory-first e produce:

- memoria tenant richiamata, checkpoint e handoff rilevanti;
- ruoli espliciti per owner, Nyra, Core, AI executor, verifica e apprendimento;
- rami Core e rami/sotto-rami Nyra, massimo 20 sotto-rami per ramo;
- task graph orizzontale con massimo sei corsie per ondata e join del Core;
- selezione connector-first dello strumento e fallback condizionati;
- criteri di verifica, audit, rollback e apprendimento verificato.

Il preflight non autorizza mai l'esecuzione. Le API Nyra, Codex, Action Evaluator
e AI Gateway includono automaticamente il contratto nelle risposte. Se il
provider non ha fornito la memoria tenant, lo stato e `memory_recall_required` e
il lavoro resta bloccato. Per GitHub la rotta preferita e l'app collegata; la CLI
e vietata quando il connettore e disponibile. Merge e deploy richiedono verdict
Core `ALLOW` e conferma owner.

Endpoint:

- `POST /v1/decision`: decisione generale con `decision_contract`.
- `POST /v1/action-evaluator`: gate per azioni sensibili.
- `POST /v1/codex/guard`: guardiano Codex dedicato.
- `POST /v1/ai-gateway/evaluate`: AI Gateway centrale per Codex, Suite, Smart Desk e altri client.

## AI Gateway 0.3.6 - Action Mediation

Dal runtime `0.3.6-action-mediation` il verdict non e piu solo allow/block/review.

Il Gateway restituisce anche:

```json
{
  "action_mediation": {
    "state": "allow | rewrite | confirm | defer | sandbox | block | rollback_required",
    "execution_allowed": false,
    "owner_confirmation_required": true,
    "sandbox_required": false,
    "rollback_required": false,
    "rewrite_allowed": false,
    "blocked": false,
    "next_step": "request_owner_confirmation"
  },
  "explainability": {
    "audience": "business_and_operator",
    "summary": "Azione sensibile: serve conferma owner prima di procedere.",
    "why": "Core ha visto rischio medio su questa azione.",
    "safe_alternative": "Passare da staging/review e poi confermare manualmente.",
    "owner_message": "Cristian o owner autorizzato deve confermare l'audit prima dell'esecuzione."
  },
  "commercial_explanation": "Azione sensibile: serve conferma owner prima di procedere."
}
```

Significato operativo:

- `allow`: procedere con audit.
- `rewrite`: riscrivere/correggere prima di pubblicare o usare.
- `confirm`: serve conferma owner.
- `defer`: mancano dati o contesto.
- `sandbox`: prima test isolato, poi nuova conferma.
- `block`: stop reale.
- `rollback_required`: serve piano di rollback prima di procedere.

Questi stati servono a non appiattire tutto in un blocco duro: Core puo fermare davvero solo cio che e pericoloso, mentre le azioni sensibili diventano confermabili e spiegabili.

## Codex come executor controllato

Codex non deve essere arbitro finale. Il flusso corretto e:

1. Codex/client invia task, contesto e rami richiesti a `/v1/codex/guard`.
2. Core valuta il task.
3. Se la chiave abilita rami, il Core li compone nel contesto.
4. Se la chiave non abilita rami, il Core lavora comunque come guardiano generico.
5. Codex usa `decision_contract` come fonte primaria.

Esempio con rami:

```bash
curl -X POST "$CORE_URL/v1/codex/guard" \
  -H "Authorization: Bearer $SH_CODEX_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"skinharmony","task":"Genera testo marketing controllato","branches":["marketing_copy","ramo_testo"],"user_input":"Hero pagina WaaS senza claim medici"}'
```

Esempio senza rami:

```bash
curl -X POST "$CORE_URL/v1/codex/guard" \
  -H "Authorization: Bearer $SH_CODEX_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"skinharmony","task":"Controlla errori e proponi patch","user_input":"Non pubblicare nulla senza conferma"}'
```

## Rami Core attivi

Questi rami permettono di usare Universal Core come giudice centrale, non solo come endpoint generico:

- `beauty_market`: postura mercato beauty/wellness per canale, prezzo e priorita.
- `marketing_copy`: brief copywriting controllato da Claim Guard, sempre con review owner.
- `cosmetic_chemistry`: posizionamento prudente degli attivi cosmetici, senza claim medici.
- `technology_market`: lettura domanda/maturita per tecnologie beauty/wellness.
- `business_strategy`: priorita commerciali, CRM, churn, pipeline e readiness.
- `translation_governance`: payload stringhe strutturate per traduzione governata dal Core.
- `nyra_finance_beauty_test`: ramo separato test-only per segnali mercato/finanza beauty. Non e collegato alla produzione.

Esempio:

```bash
curl -X POST "$CORE_URL/v1/branches/marketing_copy/analyze" \
  -H "Authorization: Bearer $SH_CORE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tenant_id":"skinharmony","data":{"offer":"WaaS Network","target":"Brand cosmetico professionale"}}'
```

Scope utili:
- `read:snapshot`
- `write:snapshot`
- `read:decision`
- `write:decision`
- `read:review`
- `write:review`
- `write:sync_suite`
- `write:sync_wordpress`
- `claim:check`
- `pricing:check`
- `policy:check`
- `automation:codex`
- `admin:tenant`
- `admin:keys`

## Sicurezza

- Nessuna automazione distruttiva.
- Publish e azioni operative richiedono conferma owner.
- Tenant isolation su ogni richiesta.
- Audit JSONL locale o su disco persistente Render.
- Claim/Pricing Guard sono advisory/supporto governance, non sostituiscono verifiche legali o fiscali.
- Nyra Finance resta test-only se non viene esplicitamente promossa con nuova policy owner.

## Utility locale

Generare una key:

```bash
npm run core:client -- generate-key --url http://127.0.0.1:8787 --admin-key "$CORE_SERVICE_ADMIN_KEY" --tenant skinharmony --brand skinharmony --preset suite_connector
```

Generare una key Codex controllata:

```bash
npm run core:client -- generate-key --url http://127.0.0.1:8787 --admin-key "$CORE_SERVICE_ADMIN_KEY" --tenant skinharmony --brand skinharmony --preset codex_automation
```

Verificarla:

```bash
npm run core:client -- verify-key --url http://127.0.0.1:8787 --key "$SH_CORE_KEY"
```

Provare una decisione:

```bash
npm run core:client -- decision --url http://127.0.0.1:8787 --key "$SH_CORE_KEY" --tenant skinharmony
```

## Intelligence consolidation 0.8.1

- Validated tenant memory is normalized before analysis and its provenance is exposed in every probability estimate.
- Only verified directional memory can move probability; other verified memories can reduce uncertainty without being treated as favorable evidence.
- Calibration now reports probability buckets, expected calibration error, domain and horizon cohorts.
- Verified outcomes use atomic per-record tenant storage, preserve legacy reads and reject conflicting reuse of an outcome ID.
- Live weight mutation remains disabled and every execution still requires the existing Core governance boundary.
