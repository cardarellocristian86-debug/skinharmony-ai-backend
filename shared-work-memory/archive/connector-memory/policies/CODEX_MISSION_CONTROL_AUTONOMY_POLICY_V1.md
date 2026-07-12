# Codex Mission Control Autonomy Policy V1

Stato: attivo
Data: 2026-06-02

## Scopo

Ridurre l'intervento manuale di Cristian nei lavori multi-Codex.

La regola stabile diventa:

`Owner conferma solo quando Core/Nyra classificano il caso come realmente sensibile, irreversibile, commerciale o produttivo. Tutto il resto procede in automatico dentro contratti, lock, scope, audit e test.`

Questa policy non autorizza deploy, produzione, chiavi, pagamenti, dati clienti o
azioni irreversibili senza gate. Serve a evitare che ogni micro-passaggio locale
richieda conferma owner.

## Livelli decisionali

### allow_auto

Codex procede senza chiedere conferma owner.

Usare per:

- lettura locale;
- ricerca;
- test;
- report;
- fixture;
- documentazione;
- checklist;
- messaggi `SHARED_WORK`;
- analisi;
- verifiche;
- patch locali non sensibili dentro scope libero;
- correzioni piccole su file non lockati e non produttivi.

Obbligo:

- scrivere audit/pulse se il lavoro fa parte di task condiviso;
- eseguire test se cambia codice;
- non toccare produzione.

### allow_with_audit

Codex procede automaticamente, ma deve lasciare evidenza forte.

Usare per:

- modifiche codice locali normali;
- patch plugin locale non installata live;
- template locale;
- extractor/validator/test suite;
- shared memory;
- runbook;
- report governati;
- aggiornamenti policy;
- correzioni su scope libero dopo finding.

Obbligo:

- Core gate se l'azione e classificata sensibile dal connector;
- messaggio `SHARED_WORK`;
- finding/decisione se rilevante;
- test o motivo scritto.

### review_required

Non serve subito Cristian. Prima passa da seconda lettura Core/Nyra o
`codex-supporto`/`codex-correttore-codici`.

Usare per:

- scelte architetturali;
- cambio contratti tra moduli;
- cambio workflow multi-Codex;
- modifica gating;
- cambio ranking/policy;
- claim commerciali non pubblicati;
- traduzioni importanti non live;
- ambiguita tra worker e ricercatore;
- conflitto tra findings.

Obbligo:

- produrre almeno due opzioni o una matrice rischio/beneficio;
- chiedere decisione Core esplicita;
- procedere solo se Core/Nyra selezionano una strada o se il supporto chiude come rischio basso.

### owner_required

Chiedere Cristian solo qui.

Usare per:

- deploy;
- publish WordPress/live;
- tenant/clienti reali;
- chiavi/admin/API key;
- pagamenti/settlement;
- prezzi ufficiali;
- contratti/offerte commerciali vincolanti;
- cancellazioni;
- rollback distruttivi;
- cross-tenant;
- invii WhatsApp/email reali;
- attivazione Gold commerciale;
- claim medico/terapeutico o rischio legale.

### blocked

Fermarsi.

Usare quando:

- Core blocca;
- lock non disponibile;
- scope non coerente;
- produzione richiesta senza conferma;
- dati/chiavi non autorizzati;
- lavoro non verificabile;
- Codex sta ignorando contratto, finding critico o test falliti.

## Eventi decisionali Core

Core non deve essere usato solo come semaforo `allowed/blocked`.

Ogni evento importante deve essere passato come segnale decisionale:

- `owner_request`: cosa ha chiesto Cristian;
- `role_declaration`: ruolo Codex e scope;
- `research_signal`: evidenza/fonte/misura;
- `variant_set`: opzioni concrete;
- `risk_finding`: bug, regressione, rumore, test fallito;
- `lock_event`: lock preso/rilasciato/scaduto;
- `patch_plan`: file, rischio, test;
- `test_result`: comando, esito, limite;
- `handoff`: cosa resta e chi puo prenderlo;
- `final_evidence`: prove di chiusura.

Core deve produrre, quando possibile:

- decision level: `allow_auto`, `allow_with_audit`, `review_required`, `owner_required`, `blocked`;
- opzione selezionata;
- rischio;
- motivo;
- prossimo micro-step;
- cosa non fare;
- se serve Nyra/supporto/owner.

## Nyra guidance

Nyra non sostituisce Core e non scrive codice al posto di Codex.

Nyra deve:

- leggere eventi, findings, handoff e memoria;
- richiamare errori gia avvenuti;
- avvisare se Codex sta ripetendo uno schema sbagliato;
- suggerire prossimo micro-step;
- tradurre il verdetto Core in istruzione operativa chiara;
- chiedere owner solo quando la policy lo richiede.

Formato minimo di indirizzo Nyra:

```json
{
  "to": "codex-worker|codex-ricercatore|codex-correttore-codici|codex-supporto",
  "level": "allow_auto|allow_with_audit|review_required|owner_required|blocked",
  "reason": "perche",
  "next_step": "micro-step",
  "avoid": ["cosa non fare"],
  "evidence_needed": ["test/report/finding richiesto"]
}
```

## Ruoli e responsabilita

### Codex ricercatore

- cerca e misura;
- genera scenari;
- produce eventi `research_signal` e `variant_set`;
- non implementa se Core/Nyra non selezionano.

### Codex worker

- implementa la variante selezionata;
- rispetta lock;
- testa;
- lascia report.

### Codex correttore codici

- legge worker + ricercatore;
- corregge errori reali;
- verifica;
- chiude buchi tecnici.

### Codex supporto

- giudica end-to-end;
- ferma derive;
- controlla se servono owner/Core/Nyra;
- non prende lock altrui.

## Chiusura end-to-end minima

Un task condiviso non e chiuso finche non esistono:

1. richiesta owner o task contract;
2. ruolo dichiarato;
3. lock/scope chiari;
4. Core/Nyra level o motivo per cui non serve;
5. evidenze/finding;
6. test o motivo non applicabile;
7. handoff o finalize;
8. nessun finding critico aperto senza next step.

## Formula stabile

`Ricercatore trova. Core decide sugli eventi. Nyra indirizza. Worker implementa. Correttore corregge. Supporto giudica. Connector obbliga. Owner conferma solo dove serve davvero.`

