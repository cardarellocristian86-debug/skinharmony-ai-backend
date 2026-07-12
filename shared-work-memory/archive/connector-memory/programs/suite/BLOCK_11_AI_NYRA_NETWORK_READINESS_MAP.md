# Suite Block 11 - AI Bridge, Nyra Advisory, Network Dashboard, Enterprise Health, Readiness Gate

Data lettura: 2026-05-25
Versione Suite rilevata: 5.2.37

## Scope Del Blocco

Questo blocco mappa il layer AI/advisory e la vista rete: AI Assistant Bridge, Nyra Commercial Intelligence, Network Map, Network Control Center, AI Control Tower Score, Enterprise Health e V2 Readiness Gate.

File principali letti:

- `wordpress/plugins/skinharmony-site-suite/modules/ai-assistant-bridge/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/client-network-dashboard/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/modules/v2-readiness-gate/class-module.php`
- `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`

## AI Assistant Bridge

Modulo:

- `modules/ai-assistant-bridge/class-module.php`

Shortcode:

- `[sh_ai_assistant]`

Stato reale:

- bridge shortcode esterno;
- usa il valore configurato in `shss_settings.ai_engine_shortcode`;
- default `[mwai_chatbot]`;
- renderizza solo se esiste shortcode `mwai_chatbot`.

Ruolo:

- incapsulare chatbot/AI Engine dentro la UI Suite;
- non è motore decisionale Core;
- non fa governance da solo.

Verità:

È un ponte visuale verso AI Engine, non AI Gold/Core runtime.

## Nyra Commercial Intelligence

Endpoint:

- `GET /wp-json/shss/v1/nyra/commercial-intelligence`

Funzione:

- `build_nyra_commercial_intelligence()`

Stato:

- read-only advisory;
- cache transient 300 secondi;
- aggrega segnali reali Suite.

Input principali:

- Analytics;
- WaaS Manager;
- Commercial status;
- Sellability;
- Dogfood SkinHarmony;
- Plugin sale readiness;
- Payment Settlements;
- Price Guard/Nyra snapshot.

Signals:

- lead totali/aperti;
- visite 30 giorni;
- ordini tecnologia;
- valore ordini;
- claim issues;
- price issues;
- readiness;
- manager blockers;
- pagine commerciali;
- sellability readiness;
- dogfood score;
- plugin sale readiness;
- gateway attivi;
- settlement manual review.

Output:

- `channel_risk`;
- `pricing_coherence`;
- `universal_core_decision`;
- `business_brain`.

Guardrail:

- read-only;
- owner confirmation required;
- no automatic actions;
- no automatic price changes;
- no campaign push automatico;
- no dati personali esposti;
- no claim finanziari/legali.

Regola dichiarata:

`Universal Core giudica; Nyra rende leggibile la priorità business; WordPress esegue solo dopo conferma.`

## Network Dashboard

Modulo:

- `modules/client-network-dashboard/class-module.php`

Stato reale:

- read-only;
- legge registro licenze;
- non fa sync remoto;
- non fa login remoto;
- non fa update remoto;
- non tira dati remoti.

Endpoint dichiarato:

- `/wp-json/shss/v1/waas-manager/dashboard`

Storage:

- option `shss_waas_license_registry`

Summary:

- local site included;
- registry sites;
- remote sites connected = 0;
- remote sites pending connection;
- active licenses;
- expired licenses;
- plans.

Policy:

- network mode `local_registry_preview`;
- remote sync disabled;
- remote login disabled;
- remote update disabled;
- remote data pull disabled;
- serve API key autorizzata per sito.

Verità:

È mappa rete preview da registro licenze, non fleet control remoto completo.

## Visual Network Map

Funzioni monolite:

- `render_waas_visual_network_map()`
- `get_waas_visual_network_status()`
- `get_enterprise_network_map_status()`

Stati nodo:

- `live`;
- `warning`;
- `renewal`;
- `onboarding`;
- `partner`.

Mostra:

- cliente;
- dominio;
- licenza;
- piano;
- lead aperti;
- revenue label se presente.

Regola:

Non crea siti, non blocca licenze e non sincronizza dati remoti.

## Enterprise Network Control Center

Funzioni:

- `render_enterprise_network_control_center()`
- `build_enterprise_network_control_status()`

Ruolo:

- control room enterprise read-only per clienti, partner, licenze, onboarding, update, colli aperti e prossima azione.

Nodi costruiti da:

- dashboard sites;
- license registry.

Tipi nodo:

- internal;
- brand;
- distributor;
- partner;
- customer;
- enterprise.

Summary:

- nodes total;
- live;
- warning;
- critical;
- onboarding;
- renewals 30 days;
- open blockers;
- tracked MRR se presente nei record.

Policy:

- read-only;
- no customer block automatico;
- no update push automatico;
- no Smart Desk sync automatico;
- no payout automatico;
- owner confirmation required.

Verità:

È la vista più vicina al “network operating system”, ma resta governance/preview finché i nodi remoti non hanno bridge autorizzato.

## AI Control Tower Score

Funzione UI:

- `render_suite_ai_control_tower_score_panel()`

Ruolo:

- score enterprise del nodo per governance, osservabilità, sicurezza, policy, audit, connector, freschezza contesto e valore.

Endpoint indicato:

- `/wp-json/shss/v1/waas-manager/ai-control-tower-score`

Serve a decidere:

- manual mode;
- guarded automation;
- runtime dedicato.

Mostra:

- score /100;
- livello;
- dimensioni valutate;
- attenzioni;
- automation posture;
- azioni consigliate.

## Agent Action Observability

Funzione UI:

- `render_suite_agent_action_observability_panel()`

Ruolo:

- timeline read-only del ciclo agentico:
  - proposta;
  - gate Core;
  - conferma;
  - preparazione;
  - esito;
  - rollback;
  - evidence.

Metriche:

- eventi osservati;
- conferme;
- bloccati;
- rollback dichiarati.

Verità:

È osservabilità e audit; non è esecuzione autonoma degli agenti.

## Enterprise Health

Funzione:

- `get_enterprise_health_status()`

Controlli:

- versione plugin ammessa;
- stable manifest allineato;
- `.htaccess` pulito;
- installazione automatica disabilitata;
- Claim Guard pulito;
- Price Guard pulito;
- readiness WaaS;
- bridge safe mode;
- canali social separati;
- WP_DEBUG non pubblico.

Stati:

- healthy;
- attention;
- critical.

Regola:

Enterprise Health decide se il nodo può essere presentato come stabile o se serve chiusura blocker.

## V2 Readiness Gate

Modulo:

- `modules/v2-readiness-gate/class-module.php`

Endpoint:

- `GET /wp-json/shss/v1/waas-manager/v2-readiness`

Stato:

- read-only;
- nessuna major automatica;
- nessuna promozione manifest automatica;
- nessuna estrazione modulo automatica.

Gate:

- wrapper modulari progressivi;
- soft gate licenze;
- registro licenze presente;
- rollback update configurato;
- Smart Desk Bridge in safe mode;
- lead destination configurata;
- compatibilità monolite mantenuta.

Verdict:

- `not_ready`;
- `ready_for_2_0_branch`;
- `staging_required`.

Module extraction:

- conta moduli fisici presenti;
- specifica che `extracted` oggi significa wrapper/sidecar progressivo, non sempre ownership completa.

## Cosa È Operativo

- AI Assistant shortcode bridge.
- Nyra commercial intelligence read-only con segnali reali.
- Network dashboard da registry licenze.
- Visual Network Map.
- Enterprise Network Control Center read-only.
- AI Control Tower Score panel.
- Agent Action Observability panel.
- Enterprise Health checks.
- V2 Readiness Gate.

## Cosa È Parziale

- AI Assistant è ponte a AI Engine, non Core executor.
- Nyra è advisory/read-only.
- Network remote sync non è attivo.
- MRR è tracciato solo se presente nei record.
- V2 extraction non significa ancora monolite dissolto.
- Agent observability dipende da eventi/evidence generati.

## Cosa Non Va Promesso

- AI autonoma che decide senza Core.
- Multi-tenant remote control completo.
- Login remoto automatico sui clienti.
- Update push automatico.
- Payout o blocchi cliente da network map.
- Major upgrade automatico.

## Regola Di Evoluzione

Per rendere questa parte enterprise vendibile:

1. collegare almeno un nodo remoto autorizzato;
2. produrre evidence reali da Core/action gate;
3. misurare AI Control Tower Score;
4. chiudere critical/high in Enterprise Health;
5. mantenere Nyra come interprete e Core come giudice;
6. lasciare ogni azione remota owner-confirmed.

