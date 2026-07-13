# Nyra + Universal Core: runtime orizzontale

## Contratto architetturale

- Universal Core e Nyra sono runtime generici e multi-tenant.
- La specializzazione business entra solo tramite un `domain_pack` risolto dalla chiave del tenant.
- Il client puo dichiarare il pack atteso, ma non puo sostituire quello assegnato dal Core.
- `generic` e il fallback orizzontale; `skinharmony` resta un pack di compatibilita, non il motore.
- I rami verticali SkinHarmony non entrano nei package di un tenant generico.

## Rete neurale a rami di Nyra

Nyra usa una rete dichiarativa di rami cognitivi. Ogni ramo contiene da 1 a 20 sotto-rami; il limite di 20 e validato all'avvio e nei test.

Rami orizzontali:

1. `context_intelligence`
2. `decision_reasoning`
3. `risk_governance`
4. `execution_planning`
5. `learning_memory`
6. `communication_explanation`

Il pack SkinHarmony aggiunge `skinharmony_domain` con i propri sotto-rami verticali.

## Autorita di routing

Nyra interpreta la richiesta e propone i rami. Universal Core:

1. risolve il domain pack dalla chiave autenticata;
2. filtra i rami disponibili per quel pack;
3. apre i rami ammessi;
4. restituisce i rami negati o sconosciuti;
5. mantiene l'esecuzione disabilitata finche policy, scope e conferma non la consentono in un flusso separato.

Nyra non apre autonomamente i rami e l'endpoint di interpretazione non esegue scritture.

## Continuita tra AI

Quando il Tenant Memory Fabric e configurato, il MCP carica automaticamente
checkpoint, memorie rilevanti, attivita recente e handoff prima di chiamare gli
endpoint di contesto/interpretazione. Nyra riceve questa continuita e propone i
rami; Universal Core convalida nuovamente il tenant, vede revisione e handoff,
quindi apre soltanto i rami autorizzati. Al termine il MCP registra un evento
operativo redatto, senza salvare automaticamente il prompt originale.

## Endpoint

- `GET /v1/domain-packs`
- `GET /v1/domain-packs/current`
- `GET /v1/nira/branches`
- `POST /v1/nira/core-bridge`
- `GET /api/nyra/runtime/contract`
- `POST /api/nyra/runtime/interpret`

Gli endpoint Core richiedono `read:decision`; gli endpoint Nyra sotto `/api/` usano l'autenticazione Nyra e rate limiting esistenti.

## Variabili opzionali

- `CORE_SERVICE_NAME`: identita interna del servizio Core; default `universal-core-service`.
- `NYRA_SERVICE_NAME`: identita interna di Nyra; default `nyra-horizontal-runtime`.
- `NYRA_SERVICE_VERSION`: override della versione runtime.
- `NYRA_DOMAIN_PACK_ID`: pack atteso da Nyra. Se assente, il Core lo risolve dal tenant; se presente, il Core deve convalidarlo.

Il nome del servizio Render puo restare quello storico: identifica un'istanza/deployment, non il tipo del motore.
