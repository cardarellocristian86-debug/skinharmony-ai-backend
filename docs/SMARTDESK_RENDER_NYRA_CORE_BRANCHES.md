# Smart Desk - Rami Render Nyra/Core

## Obiettivo
Separare i due rami operativi senza duplicare AI Gold dentro Smart Desk:

- **Core su Render**: giudice/gate. Legge richiesta, rischio, policy, tenant e decide se un azione e permessa, da rivedere o bloccata.
- **Nyra su Render**: assistente/continuita. Organizza linguaggio, memoria operativa, dialogo e suggerimenti, ma non scavalca Core.
- **Smart Desk**: resta il gestionale e fonte dei dati. Calcola numeri, mostra moduli, fa eseguire azioni solo dopo conferma operatore.

Formula stabile: il gestionale dice cosa succede, Core decide il perimetro, Nyra aiuta a guidare l operatore.

## Config gia presenti

### Core
File Render: `render-universal-core.yaml`

Servizio previsto: `skinharmony-universal-core`

Start command: `npm run core:service`

Env principali:
- `CORE_SERVICE_STORAGE_ROOT=/var/data/universal-core-service`
- `CORE_SERVICE_ADMIN_KEY` segreta Render

Ruolo:
- action mediation
- gate azioni sensibili
- audit decisionale
- selezione variante vincente
- blocco se rischio alto o policy non rispettata

### Nyra
File Render: `render-nyra.yaml`

Servizio previsto: `skinharmony-nyra-core`

Start command: `npm run nyra:render`

Env principali:
- `NYRA_STORAGE_ROOT=/var/data`
- eventuali chiavi basic auth se non disattivate

Ruolo:
- ramo dialogo/continuita
- memoria operativa controllata
- risposta assistente
- traduzione operativa delle priorita in linguaggio chiaro

## Collegamento Smart Desk
Smart Desk non deve incorporare questi rami come logica duplicata. Deve chiamarli tramite endpoint/config:

- `UNIVERSAL_CORE_URL=https://skinharmony-universal-core.onrender.com`
- `UNIVERSAL_CORE_KEY=<scoped key>`
- `NYRA_RENDER_URL=https://skinharmony-nyra-core.onrender.com`
- `NYRA_RENDER_KEY=<scoped key se attiva>`

Regola:
- Base/Silver: Nyra resta assistente tecnico/guida, non operativa.
- Gold: Nyra puo guidare piu a fondo, ma ogni azione sensibile passa dal Core e resta confermata dall operatore.

## Cosa non fare
- Non far calcolare numeri economici a Nyra.
- Non far correggere dati a Core o Nyra.
- Non far eseguire azioni automatiche senza conferma operatore.
- Non creare rami Render duplicati se questi due servizi sono gia collegabili.

## Prossimo passo sicuro
1. Verificare health `/healthz` di entrambi i servizi Render.
2. Configurare env scoped su Smart Desk solo dopo conferma owner.
3. Aggiungere endpoint Smart Desk di bridge con timeout basso e fallback locale.
4. Testare su tenant Gold demo, non su tutti i tenant.
5. Solo dopo test, abilitare progressivamente su Gold live.
