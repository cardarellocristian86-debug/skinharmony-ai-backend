# SUITE_INCI_TO_PAGE_GOVERNED_WORKFLOW_2026-05-20

## Obiettivo
Fissare il flusso corretto per trasformare:
- `INCI prodotto`
- `pagina madre da clonare`
- `target`

in una nuova pagina commerciale pronta, governata, coerente e sicura.

Questo documento serve come:
- regola architetturale
- regola operativa per Codex/CodexAI
- fallback manuale per Suite senza Codex

## Verita di base
Il flusso e corretto, ma va raccontato senza promesse false.

### Corretto
- Suite puo essere la cabina operativa del flusso
- Universal Core puo guidare scelta, claim, readiness e governance
- Nyra puo scrivere il copy premium
- Codex puo clonare layout e iniettare contenuti
- SkinHarmony Core puo governare traduzione, tono e claim
- Smart Desk puo ricevere il segnale pulito finale

### Da non promettere ancora in modo assoluto
- `pagina pronta in meno di 5 minuti` per ogni caso
- `ricerca scientifica sempre completa` se mancano basi dati, mapping o prove interne
- `pubblicazione full auto` in ogni nodo senza readiness gia preconfigurata

Formula onesta:
- con nodo pronto e flusso preconfigurato: `pochi minuti / poche decine di minuti`
- con produzione assistita seria: `ore o pochi giorni`
- contro la produzione tradizionale: `molto meno dei mesi classici`

## Ruoli corretti
### Suite
- raccoglie input
- conserva stato
- governa i blocchi
- verifica readiness
- pubblica o manda in review

### Universal Core
- decide il ramo corretto
- giudica rischio, claim, readiness, pricing alignment, pubblicabilita
- blocca o abbassa tono quando le prove non bastano

### Nyra
- converte chimica, razionale formulativo e target in copy premium
- costruisce hook, benefici, FAQ, struttura narrativa
- non decide da sola claim o prove

### SkinHarmony Core
- controlla claim
- controlla tono
- controlla coerenza marketing
- localizza senza traduzione letterale

### Codex / CodexAI
- legge la pagina madre
- smonta il layout
- replica la struttura
- inietta copy, CTA, form, tracking, bridge
- prepara pubblicazione tecnica

### Smart Desk
- riceve il segnale finale pulito
- sa che la pagina e attiva
- puo usarla come nuovo nodo commerciale/lead source

## Modalita supportate
### Modalita 1 - Suite manuale
Usabile anche senza Codex.

Flusso:
1. l operatore inserisce INCI, target, pagina madre
2. Suite raccoglie i dati
3. Core giudica
4. Nyra propone copy
5. Claim Guard corregge
6. operatore conferma
7. Suite salva bozza o pagina

### Modalita 2 - Suite + CodexAI
Flusso assistito e semi-industriale.

1. Suite raccoglie input
2. Core sceglie il ramo e il livello di rischio
3. Nyra produce i contenuti
4. Codex clona la pagina madre e inserisce i contenuti
5. Suite controlla readiness e pubblicabilita
6. Smart Desk riceve il segnale finale

### Modalita 3 - Suite + CodexAI + automazione guidata
Questa e la direzione target.

Serve per portare il lavoro ripetibile da giorni a ore, ma solo se:
- nodo gia configurato
- CTA e moduli gia mappati
- pricing gia presente
- claim guard attivo
- template madre gia approvato
- ruleset del connector gia fissato

## Flusso consigliato definitivo
### STEP 0 - Intake governato
Input minimi:
- INCI
- target
- URL pagina madre
- lingua target
- famiglia prodotto
- fascia prezzo/posizionamento

Se manca qualcosa di importante:
- no blocco totale obbligatorio
- ma stato `review_required` o `conservative_mode`

### STEP 1 - Analisi formulativa
Ramo Core: `formulation_intelligence`

Funzioni:
- estrazione attivo di punta
- lettura della posizione INCI
- stima conservativa della forza formulativa
- mapping preliminare benefici reali

Regola onesta:
- se non c e evidenza sufficiente, il sistema non deve inventare meccanismi o percentuali
- deve ridurre il linguaggio e passare in `evidence_limited_mode`

### STEP 2 - Angolo marketing
Ramo Core: `marketing_angle_extraction`

Funzioni:
- collega attivo, target e posizionamento
- genera uno o piu hook coerenti
- sceglie il gancio compatibile con pricing e target
- scarta angoli troppo medici, troppo deboli o troppo mass market

### STEP 3 - Copy premium
Layer: `Nyra`

Output attesi:
- hero title
- subtitle
- benefit blocks
- ingredient story
- target story
- FAQ
- CTA
- microcopy form

### STEP 4 - Claim Guard e adattamento lingua
Layer: `SkinHarmony Core`

Funzioni:
- rimuove claim non conformi
- abbassa promesse troppo forti
- protegge tono premium
- adatta il testo alle lingue estere senza perdere forza commerciale

### STEP 5 - Clonazione strutturale
Layer: `Codex / CodexAI`

Funzioni:
- reverse engineering della pagina madre
- replicazione struttura
- iniezione contenuti puliti
- inserimento CTA, tracking, form, bridge CRM

### STEP 6 - Readiness e publish
Layer: `Suite`

Checklist minima:
- pricing presente
- gateway pronto se serve
- privacy/consensi pronti
- form collegato
- CTA coerente
- traduzione coerente
- claim puliti
- nodo stabile

Esiti possibili:
- `publish`
- `draft`
- `review_required`
- `blocked`

### STEP 7 - Segnale ecosistema
Layer: `Suite -> Smart Desk`

Funzioni:
- segnala nuova pagina attiva
- registra nuova origine lead
- rende disponibile il nodo al sistema commerciale

## Regola operativa del connector
Il connector non deve scegliere il testo migliore in modo cieco.

Deve forzare questo schema:
- Codex genera varianti
- Core seleziona la vincente o richiede review
- Nyra organizza e raffina il copy
- Suite verifica readiness
- publish solo sulla variante approvata

## Regola pratica derivata dal test reale
Nel test della pagina Suite il flusso corretto usato e stato:
1. fissare il focus prodotto
2. scegliere lo scenario vincente
3. derivare la grammatica visuale dalla pagina madre
4. costruire una mappa pagina corposa
5. scrivere il copy per blocchi
6. pubblicare
7. verificare slug, stato e URL

Questa va registrata come regola riusabile:
- `prima architettura`
- `poi mappa contenuti`
- `poi copy`
- `poi clonazione`
- `poi publish`
- `poi evidenza`

## Cosa manca ancora per industrializzarlo davvero
1. catalogo interno attivi/benefici con livello prova
2. ramo Core dedicato `formulation_intelligence`
3. regole connector per variante vincente obbligatoria
4. template pagina madre approvati e classificati
5. publish pipeline Suite `draft/review/publish`
6. feedback loop sui risultati pagina

## Verdetto
Il modello e giusto.

Non va raccontato come semplice generazione testo.
Va raccontato come produzione governata:
- chimica letta
- marketing estratto
- copy scritto
- claim protetti
- layout clonato
- readiness verificata
- nodo pubblicato

Questo e il modo corretto per farlo funzionare sia:
- in manuale dentro Suite
- con CodexAI assistivo
- con automazione piu forte in una fase successiva
