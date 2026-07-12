# Horizontal Core/Nyra Software Language Gate V1

## Stato
Policy obbligatoria attiva dal 2026-06-01.

## Principio
Core, Nyra e i radar lingua non sono elementi decorativi. Ogni software SkinHarmony che espone testi, comandi, decisioni AI o traduzioni deve passare da un controllo orizzontale prima di essere dichiarato pronto.

La regola vale per:
- SkinHarmony Core / traduttore software;
- Smart Desk;
- AI Gold;
- Site Suite;
- traduttore pubblico o admin;
- futuri moduli che chiamano Core, Nyra, OpenAI o un catalogo lingua.

## Formula operativa
`Software produce testo -> radar orizzontali -> filtro V2/V1/V0 -> Core/Nyra governance -> catalogo/dizionario -> verifica runtime`.

## Cosa deve intercettare
Il controllo non deve essere verticale per singola app. Deve leggere il software per tipo di scrittura:
- CTA e comandi;
- navigazione;
- errori e blocchi;
- onboarding, trial e login;
- AI Gold / decisioni operative;
- qualità dati;
- stato sistema;
- privacy, consenso e WhatsApp;
- prezzi, pagamenti, costi e margini;
- admin, supporto e tenant.

## Pipeline anti-rumore obbligatoria
- `V2`: filtro semantico. Elimina dizionari sorgente, mappe tecniche, regex, repair rules e frammenti codice non visibili.
- `V1`: filtro policy di scrittura. Elimina testo generico a basso segnale e rumore non operativo.
- `V0`: gate finale. Tiene solo residui visibili, rischiosi o commercialmente rilevanti.

Se il radar produce una lista enorme senza compressione V2/V1/V0, il report non e valido per release o vendita.

## Regola di blocco
Una lingua o una UI non puo essere marcata `pronta` se restano finding `high` su:
- CTA;
- errori;
- onboarding/trial/login;
- AI Gold / decisioni;
- privacy/consenso;
- prezzi/pagamenti.

I finding `medium` possono restare solo con report esplicito e motivo operativo.

## Separazione responsabilità
- Smart Desk, Suite e altri software non devono incorporare Nyra/Core come logica duplicata.
- I software devono chiamare il runtime/bridge governato e leggere cataloghi/dizionari applicabili.
- SkinHarmony Core/traduttore governa cataloghi, memoria, review e qualità linguistica.
- Universal Core/Nyra selezionano, spiegano, filtrano rischio e riducono rumore.
- Codex implementa e verifica, ma non scavalca radar/Core/Nyra.

## Comando locale di riferimento
Per Smart Desk:

```bash
npm run language:software-radar -- --target /Users/cristiancardarello/skinharmony-ai-backend/smartdesk-live --app smartdesk --target-lang de --limit 260
```

Report atteso:
- `reports/core-translator/software_language_radar_latest.json`
- `reports/core-translator/SOFTWARE_LANGUAGE_RADAR_LATEST.md`
- copia in `SHARED_MEMORY/reports/core-translator/`

## Gate Render obbligatorio
Il passaggio server vive su Universal Core Render:

- schema pubblico: `GET https://skinharmony-universal-core.onrender.com/v1/software-language-gate/schema`
- valutazione autenticata: `POST https://skinharmony-universal-core.onrender.com/v1/software-language-gate/evaluate`
- alias API: `/api/v1/software-language-gate/schema` e `/api/v1/software-language-gate/evaluate`

La risposta `language_ready=false`, `decision=blocked` o `action_mediation.execution_allowed=false` blocca release/demo/ready della lingua o della UI.

La rotta e obbligatoria per client Core/Nyra/translator/Smart Desk/Suite prima di:
- pubblicare o dichiarare una lingua pronta;
- generare cataloghi software ufficiali;
- usare AI Gold copy in runtime;
- rilasciare modifiche UI multi-lingua;
- collegare nuovi moduli al runtime Core/Nyra.

Deploy iniziale Render:
- servizio: `skinharmony-universal-core`
- versione: `0.3.17-software-language-gate`
- commit: `51128414081410fddcd5a8ace976d4290794f812`
- deploy: `dep-d8euhqpkh4rs73eme0h0`

## Quando e obbligatorio
Prima di:
- deploy o release;
- dichiarare una lingua pronta;
- vendere un software in una lingua;
- collegare un nuovo modulo a Core/Nyra;
- modificare AI Gold, Smart Desk, Suite o traduttore;
- importare o rigenerare cataloghi lingua;
- presentare demo commerciali multi-lingua.

## Regola finale
Nessuna traduzione software e nessuna lettura AI deve essere considerata affidabile solo perche “sembra tradotta”. Deve superare il passaggio orizzontale: radar, V2/V1/V0, Core/Nyra e verifica runtime.
