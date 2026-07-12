# SkinHarmony Core 1.0 Commercial Freeze

Data freeze: 2026-05-19
Stato: vendibile come base commerciale governata.

## Cosa e congelato

SkinHarmony Core e congelato come layer operativo vendibile per:

- collegamento a Universal Core su Render;
- generazione e uso API key;
- bridge WordPress/plugin -> Universal Core;
- content governance;
- traduzione governata;
- Claim Guard con correzione puntuale;
- review owner;
- audit Core;
- report esito;
- integrazione con rami/policy Core.

Il comportamento stabile da mantenere e:

1. Il plugin rileva il contenuto rischioso.
2. Il plugin propone una correzione.
3. Il plugin non blocca brutalmente tutta la pagina se il rischio e correggibile.
4. Il plugin invia payload strutturato a Universal Core.
5. Universal Core restituisce verdict, rischio, mediazione, audit e prossima azione.
6. L'utente/owner conferma le azioni sensibili.

## Formula commerciale stabile

SkinHarmony Core e vendibile come AI Governance Layer per contenuti, traduzioni e claim.

Serve a creare, correggere e revisionare testi marketing con guardrail, audit e controllo owner, collegato a Universal Core su Render.

Non va venduto come garanzia legale automatica o sostituto di consulenza regolatoria.

## Cosa non promettere

Non promettere:

- garanzia legale assoluta;
- blocco perfetto di ogni claim in ogni lingua;
- sostituzione di revisione legale, fiscale o regolatoria;
- automazione completa senza controllo umano;
- verticalizzazione completa per ogni settore senza setup;
- decisioni AI autonome senza Core, policy e audit.

Promettere invece:

- supporto governance;
- revisione assistita;
- correzioni suggerite;
- audit;
- rami/policy aggiornabili;
- verticalizzazioni modulari su progetto.

## Regola di modifica da oggi

Da questo freeze in avanti SkinHarmony Core si modifica solo se si verifica almeno una delle seguenti condizioni:

1. Bug reale riproducibile.
2. Regressione confermata da test.
3. Errore di sicurezza o esposizione dati.
4. Errore di compliance o claim non gestito.
5. Incompatibilita con WordPress, Render, API o browser.
6. Richiesta cliente pagante collegata a contratto/setup.
7. Nuova verticalizzazione modulare approvata.
8. Nuova policy/ramo Core che non rompe il comportamento stabile.
9. Miglioramento UI/UX che non cambia il contratto funzionale.
10. Ottimizzazione performance misurabile.

Qualunque modifica fuori da queste condizioni resta backlog, non patch immediata.

## Flusso obbligatorio prima di modificare

Ogni uso reale deve generare un report.

Ogni proposta di modifica deve seguire questo flusso:

1. Salvare report uso/test in `SHARED_MEMORY/reports/core-commercial-freeze/`.
2. Indicare:
   - contesto;
   - input;
   - output plugin;
   - verdict Core;
   - audit id;
   - problema rilevato;
   - impatto commerciale;
   - impatto tecnico;
   - rischio se non si interviene.
3. Passare il report a Universal Core.
4. Core valuta peso e classifica:
   - `no_change`
   - `monitor`
   - `minor_patch`
   - `hotfix`
   - `security_fix`
   - `verticalization_request`
   - `new_branch_required`
5. Si modifica solo se Core restituisce almeno `minor_patch` oppure se l'owner conferma una verticalizzazione.

## Peso decisionale

La priorita di modifica si calcola su:

- gravita bug;
- frequenza;
- impatto cliente;
- rischio claim/compliance;
- rischio sicurezza;
- rischio reputazionale;
- valore commerciale;
- compatibilita con freeze;
- reversibilita;
- necessita di deploy.

Scala:

- `0-20`: nessuna modifica, solo nota.
- `21-40`: monitorare.
- `41-60`: patch minore pianificata.
- `61-80`: hotfix o modifica prioritaria.
- `81-100`: security/compliance fix immediato.

## Regola per altri Codex

Ogni Codex che lavora su SkinHarmony Core deve leggere questo file prima di modificare il plugin o Universal Core collegato.

Prima di aprire una patch deve:

1. creare o aggiornare un report in `SHARED_MEMORY/reports/core-commercial-freeze/`;
2. passare dal Core;
3. indicare quale condizione di modifica e stata attivata;
4. non cambiare il comportamento congelato senza nuova approvazione owner.

## Stato vendibilita

Vendibile: si.

Categoria consigliata:

- pilot professionale;
- setup assistito;
- governance AI per contenuti e traduzioni;
- claim review assistita;
- verticalizzazioni su progetto.

Non e ancora da vendere come:

- compliance legale garantita;
- AI autonoma senza review;
- piattaforma enterprise completa senza setup.
