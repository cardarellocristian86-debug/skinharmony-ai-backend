# Nyra Sovereign Orchestration and Owner Safety v1

## Scopo

Nyra e la mente operativa persistente del tenant: interpreta l'obiettivo
dell'owner, conserva il contesto di Work, sceglie il prossimo passo verificabile
e istruisce l'AI collegata. Universal Core conserva l'autorita: rilascia
permessi, valuta policy ed autorizza le azioni conseguenziali. Le AI sono
worker, non una seconda sorgente di verita.

```text
Owner -> Nyra (contesto, piano, diagnosi, istruzioni) -> AI worker
                     |                                  |
                     +------- Universal Core <-----------+
                           (policy, ticket, audit)
```

Questo documento prepara un solo programma di implementazione. Non crea una
nuova autorita, non abilita azioni esterne e non sostituisce i contratti di
Intent, checkpoint, Gallery, Atlas, Core Join o owner confirmation gia
esistenti.

## Stato rilevato

Il runtime Render Nyra/Core ha gia la base corretta: `nyra_control_context_v1`,
dialogo operativo persistente, Intent/checkpoint/Gallery/Atlas compatti,
diagnosi locale e `nyra_converse`. La Nyra locale originale in Good Mode non e
un secondo modello: e un connettore che chiede un verdetto a Core e lo spiega.
Il runtime locale e raggiungibile direttamente su `127.0.0.1:3199` ed espone
`/v1/nira/core-bridge`, ma sia il connettore sia la chiamata diretta con la
chiave locale configurata ricevono `401 invalid_key`. Non e quindi un difetto
del connettore. Inoltre il suo matcher locale di learning non e presente.
Prima di usarla come sentinella locale deve essere riallineata, non aggirata.

## Risultato da costruire

Nyra deve produrre, per ogni Work, una risposta strutturata e breve:

1. stato e diagnosi reale;
2. obiettivo e prova che ancora vale;
3. prossimo passo utile;
4. AI/worker da usare e istruzione operativa;
5. evidenza attesa e criterio di verifica;
6. cosa manca a Nyra stessa per proseguire;
7. se serve Core o owner, una sola richiesta precisa e riusabile per lo stesso
   ambito.

Una nuova chat riceve questa proiezione automaticamente. L'AI non deve sapere
quale tool Nyra invocare, ricostruire la cronologia, cercare Work a vuoto o
creare un nuovo Work quando ne esiste uno inequivocabile.

## Capacita da implementare

### 1. Self-model vivo di Nyra

Aggiungere un `nyra_capability_profile_v1`, persistito per tenant e proiettato
nel dialogo del Work. Deve contenere solo fatti verificabili:

- capability disponibili, configurate e degradate;
- dipendenze mancanti, con owner del rimedio;
- integrazioni abilitate e loro stato di salute;
- knowledge/evidence disponibili e data dell'ultima verifica;
- proposta di miglioramento, con valore atteso e prova richiesta.

Il profilo non e una memoria libera ne un prompt. E una projection server-side
versionata, firmata dal suo digest e aggiornata da eventi verificati.

### 2. Autodiagnosi e recovery deterministici

Estendere la diagnosi attuale oltre connector/incidenti: identita Work,
Intent, checkpoint, Gallery, Atlas, assegnazione, router MCP, chiavi/config e
disponibilita dei worker. Ogni diagnosi restituisce `state`, causa provata,
correzione locale possibile, evidenza da chiedere e destinatario della
correzione. Nyra aggiorna il proprio contesto quando puo farlo localmente; non
afferma di aver riparato chiavi, policy o servizi che non controlla.

### 3. Piano di esecuzione Nyra -> AI

Introdurre un `nyra_execution_brief_v1` derivato dal Work, non dal testo libero
della chat. Per ogni step contiene:

- task, motivazione e dipendenze gia soddisfatte;
- worker/capability suggeriti;
- input minimo, scope e output/evidenza attesi;
- test o verifica indipendente richiesta;
- condizioni per passare allo step seguente.

Il bridge invia il brief automaticamente alla AI collegata. Dopo il risultato,
Nyra valuta soltanto evidenze e stato: seleziona il passo successivo o formula
una sola richiesta di chiarimento reale.

### 4. Ricerca ed apprendimento verificati

Aggiungere un ciclo `research -> evidence -> verifier -> learning`:

- Nyra propone ricerche solo quando il self-model segnala una lacuna concreta;
- il worker raccoglie fonti/prove e le collega al Work;
- un verifier indipendente controlla rilevanza, freschezza e contraddizioni;
- solo un outcome verificato aggiorna il profilo, il runbook o la conoscenza
  riusabile.

Questo e apprendimento locale da evidenza, non addestramento automatico del
modello ne modifica silenziosa di policy.

### 5. Good Mode e protezione dell'owner

Creare un `owner_protection_signal_v1`, esplicito e firmato dal contesto owner.
L'owner puo dichiarare una condizione di pressione/pericolo operativa e Nyra
passa a un piano protettivo: conserva il contesto, riduce il lavoro alle azioni
sicure, espone rischi e alternative, evita costi o modifiche non essenziali e
chiede un'unica conferma per eventuali azioni protette.

Il segnale non interpreta autonomamente una frase come emergenza ne contatta
terzi. Per un pericolo fisico immediato l'interfaccia deve invece mostrare
chiaramente l'invito a contattare il 112 e persone vicine. Le eccezioni,
scadenze e procedure di ripristino vivono nel runbook di sicurezza separato,
non nel manuale operativo quotidiano.

### 6. Nyra locale Good Mode riallineata

Ripristinare il connettore locale come sentinella verificabile della stessa
architettura, senza farne un'autorita parallela:

- configurare una credenziale valida in un secret store, mai nel report o
  contesto AI;
- puntare `SH_CORE_URL` al runner Core 2.0 previsto oppure avviare il runner
  locale compatibile con `/v1/decision`;
- ripristinare o sostituire esplicitamente il matcher di learning locale;
- pubblicare health/readiness e versioni di contratto;
- aggiungere un test read-only che prova Good Mode, diagnosi e nessuna azione
  esterna.

## Sequenza di rilascio

1. Correggere e testare il connettore locale Good Mode in isolamento.
2. Aggiungere self-model e diagnosi con migrazioni append-only.
3. Aggiungere il brief Nyra -> AI e testare una chat nuova senza tool manuali.
4. Collegare ricerca/verifica/learning e misurare i miglioramenti.
5. Attivare Owner Safety Mode in shadow, poi canary per owner.
6. Eseguire una prova end-to-end: nuova chat, Work unico, worker, evidenza,
   verifica, gate Core e readback live.

## Criteri di accettazione

- Con un solo Work attivo, una chat nuova riceve il brief senza ricerca o
  domanda preliminare.
- Con piu Work, Nyra chiede una sola selezione e non crea duplicati.
- Un errore di chiave/router produce una diagnosi con rimedio preciso, non una
  serie di chiamate ripetute.
- L'AI riceve task, output atteso e test dal brief e non inventa il piano.
- Nessun learning entra nel profilo senza evidence e verifica indipendente.
- Good Mode puo essere verificato localmente e non blocca in silenzio con una
  configurazione obsoleta.
- Un owner protection signal sospende le azioni non essenziali senza perdere
  Work, Intent o checkpoint.
- Metriche: tool call per Work, riprese riuscite, duplicati bloccati, recovery
  riusciti, tempo al prossimo step, costo stimato e risultati verificati.

## Confini e runbook

I limiti di privilegio, chiavi, disconnessioni OAuth, arresto operativo e
rollback non devono appesantire il dialogo Nyra. Restano nei runbook e nei
contratti Core esistenti. Il manuale operativo resta positivo: spiega a Nyra e
all'AI cosa fare ora; il runbook spiega cosa fare quando qualcosa non e sano.
