# Suite CRM Multiutente Commercial Closure Checklist

Data: `2026-06-06`

## Obiettivo

Chiudere il `CRM B2B` come strumento commerciale multiutente per reti vendita reali:
- piu agenti operativi
- nessun accesso amministrativo non necessario
- clienti, ordini assistiti, follow-up e documenti gestiti dal CRM
- ruoli chiari e isolamento coerente

## Stato reale oggi

Gia presente:
- [x] ruoli Suite distinti `owner`, `agent`, `finance`, `support`
- [x] capability CRM separate per lettura, scrittura, ordini assistiti e documenti
- [x] agenti abilitati a creare/modificare clienti e creare ordini assistiti
- [x] blocco gia presente su registry sensibili, Core admin e perimetri non commerciali

Non ancora chiuso:
- [x] matrice completa di visibilita dedicata per `finance` e `support` chiusa in `5.3.49`
- [x] eccezioni governate per account non assegnati o condivisi chiuse in `5.3.50`
- [ ] manca test di accettazione completo per scenario `azienda con 15 agenti`

## Fonti attuali

- ruoli e capability: `wordpress/plugins/skinharmony-site-suite/modules/crm-b2b/class-module.php`
- installazione ruoli: `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- azioni CRM protette da capability: `wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php`
- stato/documentazione CRM multiutente: `wordpress/plugins/skinharmony-site-suite/README.md`

## Checklist di chiusura

### 1. Modello ruoli

- [x] confermare matrice ruoli base:
  - `shss_owner`
  - `shss_agent`
  - `shss_finance`
  - `shss_support`
- [x] fissare contratto operativo per ciascun ruolo in modo esplicito dentro Suite:
  - `agent` = clienti, follow-up, preventivi, ordini assistiti, email CRM
  - `finance` = documenti economici, lettura finance, export dedicati
  - `support` = lettura CRM/licenze/follow-up supporto
  - `owner` = governance completa

### 2. Assegnazione agente vera

- [x] sostituire o affiancare `assigned_agent` testo libero con un campo strutturato:
  - `assigned_user_id`
  - eventuale `assigned_user_label`
- [x] mantenere compatibilita con il dato storico testuale senza rompere l archivio esistente
- [x] mostrare sempre chi segue il cliente in modo leggibile nel CRM

### 3. Visibilita per portafoglio

- [ ] chiudere la matrice completa di visibilita:
  - [x] `owner/admin` vedono tutto
  - [x] `finance` vede solo cio che serve al finance
  - [x] `support` vede solo cio che serve a support/licenze/follow-up
  - [x] `agent` vede per default solo il proprio portafoglio strutturato o storico compatibile
- [ ] definire eccezioni governate:
  - [x] account non assegnati
  - [x] account condivisi
  - support mode owner
- [ ] chiudere tutto il perimetro commerciale con lo stesso filtro:
  - [x] tabella contatti CRM
  - [x] cockpit azienda
  - [x] ordini assistiti
  - [x] email thread
  - [x] documenti CRM
  - [x] export CSV

### 4. Cockpit agente

- [x] ridurre il menu Suite per `shss_agent` al solo perimetro commerciale utile
- [x] togliere agli agenti accessi non necessari a:
  - `Core Admin`
  - registry prodotti/tecnologie
  - `Payment Settlements`
  - update/configurazioni
  - automazioni sensibili
- [ ] lasciare all agente un percorso netto:
  - `CRM B2B`
  - eventuali viste commerciali collegate
  - azioni ordini/preventivi/follow-up

### 5. Ordini assistiti multiagente

- [x] l agente puo gia creare ordini assistiti dal CRM
- [ ] ogni ordine assistito deve riportare con chiarezza:
  - [x] chi l ha creato
  - [x] per quale account
  - [x] da quale agente proviene
- [ ] il cockpit deve far capire subito:
  - ordini del mio portafoglio
  - ordini in attesa owner
  - ordini bloccati
  - ordini chiusi o archiviati

### 6. Limiti amministrativi

- [x] gli agenti non hanno capability sui registry sensibili
- [x] verificare che nessun percorso UI lasci agli agenti scorciatoie verso pagine non coerenti col ruolo
- [ ] verificare che REST e UI siano allineati: non basta bloccare la UI se l endpoint resta troppo largo

### 7. Audit e tracciabilita

- [ ] tracciare sempre:
  - `created_by`
  - `updated_by`
  - `assigned_user_id`
  - `archived_by`
  - `owner_confirmed_by` se applicabile
- [ ] rendere leggibile l audit minimo in CRM senza aprire strumenti tecnici

### 8. Onboarding rete vendita

- [ ] definire procedura standard per cliente con `15 agenti`:
  - creazione utenti WordPress/Suite
  - assegnazione ruolo `shss_agent`
  - assegnazione portafoglio iniziale
  - verifica accessi reali
- [ ] prevedere import rapido o assegnazione massiva account/agente

### 9. Test di accettazione

- [ ] test `owner`:
  - vede tutto
  - assegna portafogli
  - controlla ordini e conferme
- [ ] test `agent A`:
  - vede solo i propri clienti
  - aggiunge cliente
  - modifica cliente
  - crea ordine assistito
  - non vede moduli amministrativi
- [ ] test `agent B`:
  - non vede i clienti di `agent A`
  - non modifica ordini fuori portafoglio
- [ ] test `finance`:
  - vede documenti/export finance
  - non modifica portafoglio commerciale
- [ ] test `support`:
  - vede follow-up/licenze/supporto
  - non crea ordini o modifiche commerciali sensibili

## Definizione di chiusura

Questa parte si considera chiusa solo quando sono vere tutte queste condizioni:
- i ruoli esistono
- la UI riflette davvero i ruoli
- l agente lavora solo nel proprio perimetro
- l ordine assistito resta commerciale e tracciato
- nessun agente entra per errore in aree amministrative
- il test scenario `15 agenti` passa senza comportamenti ambigui

## Prossimo blocco tecnico corretto

1. decidere policy su account `non assegnati` e `condivisi`
2. completare isolamento ordini assistiti sul perimetro portafoglio
3. chiudere il test di accettazione multiutente
4. rifinire eventuali viste `finance/support` emerse dal test reale browser
