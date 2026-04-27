# SkinHarmony Control Desk

Dashboard locale personale per controllare il flusso operativo SkinHarmony senza usare la riga di comando.

## Assetto attuale

Il front-end e stato riallineato come `enterprise command room`, non come pagina piena di moduli.

Gerarchia nuova:

- `Command`: una priorita dominante e la prossima mossa
- `Matrix`: executive cards e command queue
- `Channels`: sito, Instagram, Smart Desk, Render, GitHub, contatti
- `Pipeline`: campagne, lead, follow-up
- `Capital`: revenue, margin, inventory
- `Runtime`: integrita fonti, agenda, task
- `Finance Dock`: ingresso preparato per il futuro desk finanziario
- `Nyra`: copilot operativo e proposte confermabili

Dottrina usata nel redesign:

- una priorita dominante
- una prossima mossa verificabile
- niente rumore se non cambia la decisione

Endpoint nuovo:

```text
GET /api/nyra/control
```

Restituisce il layer decisionale locale del Control Desk:

- `doctrine`
- `primary`
- `tempo` (`now / next / blocked / watch`)
- `queue`
- `confidence`
- `segmented`
- `financeDockReadiness`

## Avvio

```bash
npm run control:dev
```

URL locale:

```text
http://127.0.0.1:3025
```

## Cosa legge

- `outreach_stats.json`
- `lead/*.json`
- `mail/ultimo_report_outreach.md`
- `agenda/todo.json`
- `agenda/appuntamenti.json`
- `AGENTS.md`
- `SMARTDESK_MAPPA_OPERATIVA.md`

## Funzioni iniziali

- Dashboard con invii, risposte, tasso risposta e lead totali.
- Blocco decisionale iniziale con performance attuale, trend 7 giorni, campagna migliore, campagna debole e alert.
- Prossima azione generata dai dati, con priorita critica/attenzione/ok.
- Gerarchia visiva:
  - Acquisizione e campagne
  - Comportamento e conversione
  - Risultati economici
  - Controllo sticky con alert, assistente e task
- Layout riorganizzato in stile dashboard revenue intelligence:
  - header decisionale
  - overview report tipo analytics con tab per fonte
  - KPI principali
  - grafici business/trading
  - blocchi operativi Input, Movimento, Risultato
  - controllo laterale sticky
- Grafici principali:
  - andamento ecosistema per Sito, Instagram, Gestionale, Campagne e Magazzino
  - trend performance
  - invii vs risposte
  - funnel visivo
  - performance campagne
  - attivita giornaliera
- Grafico campagne email.
- Grafico cartesiano temporale con invii, risposte e segmenti per target.
- Tabelle lead recenti e stato file lead.
- Funnel lead con stati:
  - nuovo
  - contattato
  - risposto
  - interessato
  - trattativa
  - cliente
  - perso
- Stato lead aggiornabile manualmente dalla tabella.
- Storico azioni collegato ai lead, derivato da `outreach_stats.json`.
- Modulo comportamento con risposta, tempo risposta, follow-up e interazioni manuali.
- Risultati campagna con invii, risposte, lead generati, trattative, clienti e conversion rate.
- Modulo economico manuale con prodotto venduto, prezzo, costo stimato e margine.
- Magazzino collegato alle vendite e correlazione prodotti/campagne.
- Modulo social base con contenuto, tipo, piattaforma, data pubblicazione e lead generati.
- Data hub per fonti collegate:
  - sito web
  - Instagram
  - Smart Desk / gestionale
  - contatti manuali
  - magazzino manuale
- Caricamento manuale contatti dalla UI, salvati anche come lead in `lead/control_desk_manual_contacts.json`.
- Magazzino operativo manuale:
  - aggiunta prodotto
  - carico merce
  - scarico merce
  - soglia minima
  - movimenti collegabili a lead/campagne
- Alert automatici su:
  - tasso risposta sotto 2%
  - campagne senza clienti
  - lead senza follow-up da oltre 5 giorni
  - campagne sopra media
- Assistente marketing interno:
  - legge i dati locali gia presenti nel Control Desk
  - risponde alle domande scritte dalla UI
  - propone strategia marketing basata su invii, risposte, lead e task aperti
  - non inventa dati non presenti
- Pulsanti per:
  - controllare risposte email
  - aggiornare report outreach
  - aprire Smart Desk live
  - aprire pagina Smart Desk WordPress
  - aggiungere task operativi
- Sezione memoria con ultime sessioni salvate.

## Nota operativa

Questa è la prima base del programma personale. Non invia campagne email direttamente dalla UI: l'invio resta gestito dagli script dedicati e tracciati, per evitare automazioni rischiose.

L'assistente marketing attuale genera risposte locali basate sui dati gia letti dal programma. Il prossimo passaggio tecnico utile e collegarlo a un endpoint AI dedicato, mantenendo la stessa regola: leggere solo dati reali del workspace e dichiarare quando manca un dato.

## Endpoint AI-ready

```text
GET /api/ai/context
```

Restituisce un JSON unico con campagne, lead, funnel, azioni, comportamento, vendite, margini, magazzino, social e alert. Questo endpoint e la base per collegare un assistente AI operativo senza fargli leggere file sparsi.

## Dati manuali Control Desk

I dati manuali nuovi vengono salvati in:

```text
personal-control-center/data/marketing-data.json
```

Lo stato lead viene invece aggiornato nel file lead originale, per mantenere la continuita con l'archivio gia esistente.

## Collegamenti reali

Il Control Desk ora e pronto per collegare fonti esterne. Al momento:

- sito web: WordPress API collegata tramite `WP_URL`, `WP_USER`, `WP_APP_PASSWORD`
- Google Search Console: connector aggiunto tramite token Google; richiede refresh token valido con scope Search Console e proprieta sito accessibile
- Google Analytics 4: connector aggiunto tramite token Google; richiede `GA4_PROPERTY_ID` o `GOOGLE_ANALYTICS_PROPERTY_ID`
- Token Google Analytics/Search Console: usare preferibilmente `GOOGLE_ANALYTICS_REFRESH_TOKEN` o `GOOGLE_REFRESH_TOKEN`, cosi non si confonde il token Gmail con le API analytics
- Funnel sito: blocco decisionale dedicato che unisce Search Console, GA4, eventi CTA Smart Desk e form. Gli eventi attesi sono `trial_click`, `login_click`, `demo_click`, `lead_form_submit`.
- Instagram: Meta/Instagram API predisposta tramite `META_ACCESS_TOKEN` e `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- Smart Desk: lettura locale + controllo live predisposti
- Render: Render API collegata tramite `RENDER_API_KEY` e `RENDER_SERVICE_ID`
- GitHub: GitHub API collegata; usa token se presenti `GITHUB_TOKEN`/`GH_TOKEN`, altrimenti API pubblica
- contatti presi manualmente: gia caricabili e collegati ai lead
- magazzino: gia caricabile/scaricabile manualmente da UI

Le API esterne richiedono credenziali, token o chiavi di accesso. Finche non sono configurate, il sistema non inventa dati: mostra fonte `da collegare` oppure usa solo dati caricati manualmente.

## Sync fonti

Endpoint disponibili:

```text
POST /api/sync/wordpress
POST /api/sync/search-console
POST /api/sync/ga4
POST /api/website/events
POST /api/sync/instagram
POST /api/sync/smartdesk
POST /api/sync/render
POST /api/sync/github
POST /api/sync/all
```

Stato verificato:

- WordPress: OK
- Search Console: endpoint OK, ma il token Google locale ha restituito `invalid_grant`; serve rigenerare/autorizzare token Google valido
- GA4: `GA4_PROPERTY_ID=381286478` configurato per la proprieta collegata al tag `G-QS516K4PFL`; la sync e ancora bloccata da token Google `invalid_grant`
- Smart Desk: OK
- Render: OK
- GitHub: OK
- Instagram: OK con token Meta aggiornato; letti username, follower, media recenti ed engagement. Reach/profile visits dipendono dai permessi insight disponibili.

## Linea temporale globale

La dashboard ha un filtro temporale unico nell'header:

- ultimi 7 giorni
- ultimi 30 giorni
- ultimi 90 giorni
- tutto lo storico
- periodo personalizzato con date da/a

Il filtro aggiorna grafici principali, report ecosistema, andamento fonti, campagne e movimenti magazzino senza modificare i dati salvati.

## Direzione aziendale e produttivita

Il Control Desk ora espone anche una lettura direzionale:

- command bar sticky: stato operativo, periodo, ultimo aggiornamento, score generale e refresh
- card executive: marketing, vendite, margine, produttivita, Instagram, qualita dati
- decision panel centrale: problema principale, causa probabile, impatto e azione consigliata
- priorita giornaliere top 3 generate da urgenza, blocchi sistema e dati mancanti
- home operativa ridotta: lead senza follow-up, lead con risposta, lead recenti e alert
- tabelle e inserimenti manuali spostati nei moduli completi secondari
- `Qualita dati`: indica se mancano fonti fondamentali come GA4/Search Console, vendite collegate, costi o magazzino
- `Produttivita`: combina invii, risposte, interazioni, vendite, movimenti magazzino e log manuali
- report `Produttivita` dentro Overview report
- form `Produttivita e lavoro reale` per salvare ore, azioni e risultato operativo
- assistente strategico aggiornato: legge anche qualita dati, produttivita e direzione consigliata
- assistente AI OpenAI attivo nel pannello `Assistente`, con fallback locale se OpenAI non risponde
- test OpenAI riuscito: risposta in modalita `openai` con modello configurato
- card executive cliccabili con drawer laterale di dettaglio
- drawer esteso anche a fonti dati, lead operativi e alert
- barra AI globale `Chiedi o crea un'azione`
- barra AI contestuale dentro drawer
- proposte AI confermabili: task, note lead, bozze email e strategie salvate
- log uso AI salvato in `aiLogs` con stima token input/output
- bozze e strategie AI salvate in `aiDrafts`; nessun invio email automatico

Endpoint aggiunto:

```text
POST /api/productivity
POST /api/assistant/ai
POST /api/assistant/action
POST /api/assistant/commit
```
