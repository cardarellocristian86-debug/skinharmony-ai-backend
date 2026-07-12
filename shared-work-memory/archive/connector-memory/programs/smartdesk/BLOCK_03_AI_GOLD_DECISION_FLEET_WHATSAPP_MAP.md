# Smart Desk - Blocco 03

## Area Coperta

Questo blocco mappa il livello intelligente:

- AI Gold;
- Corelia;
- Universal Core bridge;
- Gold Decision Engine;
- Progressive Intelligence Activation Layer;
- Gold onboarding/import;
- WhatsApp Gold;
- Fleet Intelligence / God Mode.

File verificati:

- `render-smartdesk-live/src/AssistantService.js`
- `render-smartdesk-live/src/DesktopMirrorService.js`
- `render-smartdesk-live/src/ProgressiveIntelligenceActivationLayer.js`
- `render-smartdesk-live/src/GoldOnboardingEngine.js`
- `render-smartdesk-live/src/WhatsappService.js`
- `render-smartdesk-live/src/fleet_intelligence_layer.js`
- `render-smartdesk-live/src/UniversalCoreBridge.js`

## AI Gold

Route principali:

- `GET /api/ai-gold/marketing`
- `GET /api/ai-gold/profitability`
- `GET /api/business-snapshot`
- `GET /api/ai-gold/decision-center`
- `GET /api/ai-gold/capabilities`
- `GET /api/ai-gold/progressive-intelligence`
- `GET /api/ai-gold/decision-context`
- `GET /api/ai-gold/change-impact-contract`
- `GET /api/ai-gold/state`
- `GET /api/ai-gold/state/snapshots`
- `GET /api/ai-gold/state/signals`
- `GET /api/ai-gold/state/decision`
- `POST /api/ai-gold/ask`
- `POST /api/ai-gold/command`

Regola:

- AI Gold non e chatbot generico;
- legge dati reali;
- suggerisce priorita;
- non esegue senza conferma;
- se Gold segnala `canExecute=false`, rischio alto o confidence bassa, l'assistente deve fermarsi.

## Decisione Gold

Funzioni/concetti verificati:

- `computeGoldDecisionScore`
- `computeGoldDecisionControlMetrics`
- `applyGoldDecisionMatrixV1`
- `primaryAction`
- `secondaryActions`
- `blockedActions`
- `risk`
- `confidence`
- `EV`
- `NEU`
- `RAP_2`
- `trend`

Regola:

- `Silver = vedo e uso`;
- `Gold = il sistema mi dice cosa fare`;
- AI Gold prepara lavoro, ma operatore conferma.

## Universal Core Bridge

Classe:

- `UniversalCoreBridge`

Env:

- `UNIVERSAL_CORE_URL`
- `UNIVERSAL_CORE_KEY`
- `UNIVERSAL_CORE_TENANT_ID`

Route chiamate:

- `GET /v1/tenant/status`
- `GET /v1/ecosystem-pulse`
- `POST /v1/decision`
- `POST /v1/branches/:branch/analyze`

Mode:

- `read_only_decision_bridge`

Regola:

- Universal Core e gate primario quando configurato;
- Silver richiede branch `front_desk_base`, `operations_silver`, `smartdesk_operations_guard` e resta read-only/manuale;
- Gold richiede branch `front_desk_base`, `operations_silver`, `executive_gold`, `smartdesk_operations_guard`, `customer_360_guard`, `consent_ledger_guard`, `beauty_protocol_guard`;
- Nyra riceve `core_branch_learning` dal bridge esterno e deve usare quei rami per tono, priorita, dati mancanti e prossima azione;
- Corelia/local Gold e fallback;
- nessuna azione sensibile deve ignorare blockedActions/risk/confirmation.

## Corelia / Assistant

Classe:

- `AssistantService`

Ruolo:

- risponde a domande operative;
- apre viste;
- prepara azioni confermabili;
- legge Gold capabilities e decision context;
- se OpenAI non e disponibile usa fallback locale;
- se Universal Core e disponibile normalizza il verdetto.

Regole:

- non duplicare logiche Gold;
- non inventare dati mancanti;
- non eseguire se Gold/Core bloccano;
- proporre fallback manuale se API esterne non configurate.

## Progressive Intelligence Activation Layer

Classe:

- `ProgressiveIntelligenceActivationLayer`

Ruolo:

- attiva progressivamente livelli intelligenti in base a qualita dati;
- evita Gold troppo aggressivo con dati poveri;
- produce readiness/maturity.

Flusso dichiarato:

- `raw_data -> state_layer -> maturity_layer -> decision_layer -> oracle_layer`

Feature tipiche:

- marketing intelligente;
- decision layer;
- oracle/readiness;
- livelli con requisiti minimi su storico, CRM, data volume, affidabilita economica.

## Gold Onboarding / Import

Classe:

- `GoldOnboardingEngine`

Route:

- `GET /api/ai-gold/onboarding/imports`
- `POST /api/ai-gold/onboarding/analyze`
- `POST /api/ai-gold/onboarding/confirm`

Supporta:

- CSV;
- XLSX;
- mapping colonne;
- clienti;
- appuntamenti;
- pagamenti;
- snapshot import;
- stati `READY` e `REVIEW`.

Regola:

- l'AI suggerisce mapping e collegamenti;
- i record dubbi restano `REVIEW` fino a conferma utente.

## Marketing Autopilot

Route:

- `GET /api/ai-gold/marketing/autopilot`
- `POST /api/ai-gold/marketing/autopilot/generate`
- `POST /api/ai-gold/marketing/autopilot/:id/status`

Stati:

- `to_approve`
- `approved`
- `copied`
- `done`
- `archived`

Regola:

- genera coda azioni marketing;
- l'utente approva;
- OpenAI rifinisce se disponibile;
- nessun invio automatico senza conferma/consenso.

## WhatsApp Gold

Classe:

- `WhatsappService`

Route:

- `GET /api/ai-gold/whatsapp/status`
- `POST /api/ai-gold/whatsapp/test-twilio`
- `POST /api/ai-gold/whatsapp/preview`
- `POST /api/ai-gold/whatsapp/send`
- `POST /api/ai-gold/whatsapp/bulk-send`
- `POST /api/integrations/twilio/whatsapp-webhook`

Env:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`
- opzionale `TWILIO_WEBHOOK_TOKEN`

Configurazione per centro:

- `whatsappProvider = twilio_own_account` quando il centro collega il proprio Twilio;
- `whatsappTwilioAccountSid`;
- `whatsappTwilioAuthToken` salvato lato server e mascherato nelle API settings;
- `whatsappTwilioFrom` in formato `whatsapp:+...`;
- `whatsappTwilioLastTestStatus` e `whatsappTwilioLastTestMessage`.

Provider effettivi:

- `twilio_own_account` se il centro ha credenziali valide;
- `twilio_platform` se usa le env SkinHarmony/Render;
- `manual_copy` se nessun provider e pronto o Twilio rifiuta.

Regole:

- Gold only;
- invio approvato dall'operatore;
- fallback copia se Twilio non configurato o rifiuta l'invio;
- consenso telefono/marketing richiesto;
- quota mensile;
- tracking in `whatsapp_messages`.

## Fleet Intelligence / God Mode

Route UI:

- `/fleet-intelligence`

API:

- `GET /api/fleet/overview`
- `GET /api/fleet/maturity`
- `GET /api/fleet/outliers`
- `GET /api/fleet/alerts`
- `GET /api/fleet/performance`
- `GET /api/fleet/oracle`

Accesso:

- solo superadmin;
- non in support mode.

Regola:

- Fleet e read-only;
- non modifica Base/Silver/Gold;
- non modifica pricing;
- non modifica Decision Engine;
- non scrive dati operativi.

## Cosa E Gia Operativo

- AI Gold API.
- Decision context/capabilities.
- Progressive Intelligence.
- Gold onboarding import.
- Marketing autopilot.
- WhatsApp Gold con fallback.
- Universal Core bridge read-only decision.
- Fleet Intelligence superadmin read-only.

## Cosa Resta Da Validare Live

- Che AI Gold non bypassi mai Gold Decision/Universal Core.
- Che WhatsApp non invii senza consenso e conferma.
- Che Fleet resti read-only.
- Che import Gold non inserisca record dubbi senza review.
- Che Gold non prometta piu di quanto i dati reali permettono.
