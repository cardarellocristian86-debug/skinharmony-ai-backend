# Manuale Utente Suite

## A Cosa Serve

Suite serve a governare una rete commerciale da WordPress.

Con Suite puoi vedere e gestire:

- siti/nodi;
- clienti e account B2B;
- brand;
- distributori;
- partner;
- licenze;
- piani;
- moduli attivi;
- offerte WaaS;
- template;
- lead;
- ordini B2B;
- stock;
- listini;
- prezzi;
- claim;
- contenuti;
- tracking;
- update.

## Prima Schermata Da Usare

Apri:

- WordPress > SkinHarmony Suite

La Control Room e la cabina principale.

Da li devi capire:

- cosa e pronto;
- cosa e parziale;
- cosa e bloccato;
- quali moduli hanno rischio;
- quale azione fare dopo.

## Flusso Operativo Base

1. Controlla Control Room.
2. Entra in CRM B2B.
3. Crea o aggiorna account/nodo.
4. Collega brand, distributore, partner o cliente.
5. Assegna piano, listino, agente o distributore.
6. Usa Product Cards/Template/Offerte per contenuti pubblici.
7. Usa Price Guard e Claim Guard prima di pubblicare.
8. Usa Licenze/App Key per attivare nodo o Smart Desk.
9. Usa Analytics/Lead per leggere conversione.
10. Usa Enterprise Health prima di aggiornare o vendere.

Regola di navigazione:

- se una card o un bottone dice `Apri`, `Modifica` o descrive una prossima azione, deve portarti direttamente al modulo o al form giusto;
- quando apri una modifica da una scheda CRM, Suite deve aprire il blocco corretto e mettere il focus sul primo campo utile.
- nei pannelli read-only finanziari o WooCommerce, Suite deve almeno aprire il pannello sorgente corretto; non deve lasciare la lettura senza uscita operativa.

## Sync Render

Quando il runtime Render è configurato, Suite continua a restare il pannello
WordPress ma invia fuori solo riepiloghi controllati:

- eventi analytics minimizzati;
- azioni e evidence;
- snapshot commerce aggregato di CRM, magazzino, tecnologie, lead, ordini e licenze.

Render serve per storico, confronto e lettura Core/Nyra. Non prende pagamenti,
non modifica stock, non aggiorna campagne e non sostituisce WooCommerce o il CRM
locale.

## CRM B2B

Il CRM non e una rubrica.

Serve a capire:

- chi compra da chi;
- chi vende cosa;
- chi ha quale listino;
- chi puo ordinare;
- chi ha sconti dedicati;
- chi ha prodotti riservati;
- chi e fermo;
- chi va seguito.

Azioni disponibili:

- creare account;
- modificare account;
- duplicare;
- eliminare;
- trasformare lead in cliente;
- creare proposta/preventivo;
- creare ordine assistito;
- archiviare righe ledger manuali o B2B con motivo;
- esportare CSV;
- gestire documenti;
- raggruppare email per oggetto;
- vedere Node 360.

Regola ledger:

- se una riga e stata inserita per errore o la vendita salta, usare `Archivia`;
- i motivi validi sono `errore inserimento`, `vendita saltata`, `duplicato`, `trattativa fermata`;
- le righe lette da `WooCommerce` non si archiviano dal CRM: si correggono dalla sorgente WooCommerce.

## Template, Pagine E Clone

Le pagine generate devono restare in bozza.

Prima di pubblicare:

- controllo layout desktop/mobile;
- controllo overflow;
- controllo claim;
- controllo prezzi;
- controllo CTA;
- conferma owner.

Non usare Suite per cancellare tutto e ricreare una pagina da zero se deve solo migliorare una pagina esistente.

## Product Cards

Usa:

- `[sh_technology_cards]`

Per mostrare card pubbliche di tecnologie e prodotti.

Regola operativa attuale:

- il catalogo non va più scritto a mano qui;
- `Magazzino Tecnologie` e `Magazzino Prodotti` sono le fonti master;
- `Product Cards` mostra le righe risolte automaticamente dai registry;
- qui devi intervenire solo se vuoi un override leggero di titolo, tag, testo o link.

Collegamenti automatici:

- tecnologia -> pagina tecnologia dedicata, se esiste;
- prodotto -> permalink WooCommerce collegato, se esiste;
- WooCommerce e un canale opzionale: la card pubblica puo esistere anche senza prodotto Woo se la tecnologia ha la sua pagina dedicata.

Quando aggiungi o modifichi una tecnologia/prodotto nel registry master, la card deve comparire qui senza ricrearla manualmente.

Ogni card deve avere:

- titolo;
- tag;
- testo prudente;
- link.

Non inserire:

- prezzi inventati;
- claim medici;
- promesse garantite;
- termini interni tecnici visibili al cliente.

Non usare `Product Cards` come seconda anagrafica del catalogo.

## Product Governance Hub

Usa `Magazzino Prodotti` come registry master dei prodotti. Non usarlo come CRM.

Serve per:

- inserire prodotti pilota con nome, SKU, brand/nodo, prezzo, stock e categoria;
- dichiarare costo, IVA, MSRP, visibilità CRM/B2B/WooCommerce e tipo prodotto;
- definire prezzo sito WooCommerce da MSRP, manuale o MSRP con sconto;
- collegare un prodotto WooCommerce quando deve essere vendibile online;
- far leggere il catalogo a CRM, B2B Order Bridge, Price Guard e Claim Guard.

Le card `Product Action Center` indicano priorità, motivo, azione e verifica. Non pubblicano prodotti, non cambiano prezzi e non scalano stock da sole: ogni movimento irreversibile richiede ordine WooCommerce o conferma owner.

Il CRM deve usare i prodotti creati qui per offerte, preventivi, vendite, ordini B2B e proposte cliente. Sconti, filiera, listini dedicati, prezzo manuale, margini commerciali e alert sotto soglia restano nel CRM, non nel Product Registry.

## Technology Governance Hub

Usa `Magazzino Tecnologie` come registry master unico delle tecnologie.

Serve per:

- creare la tecnologia una sola volta;
- dichiarare costo, prezzo ufficiale se disponibile, stock e stato WooCommerce;
- lasciare la tecnologia `quote-only` quando il listino ufficiale non è ancora disponibile;
- attivare WooCommerce dalla tecnologia master solo quando il prezzo ufficiale è reale;
- far leggere la tecnologia a CRM, Company Cockpit, B2B e acconto/saldo senza duplicarla nel Product Registry.

Regola operativa:

- se manca il listino ufficiale, non inventare prezzi;
- la tecnologia può stare nel registry anche con prezzo `0`;
- CRM la vede comunque come anagrafica tecnologia;
- WooCommerce non va acceso finché il prezzo ufficiale non è confermato;
- non creare una seconda riga `reserved` nel Product Registry per una tecnologia.

## Traduzioni E Core

Suite deve esporre stringhe atomiche al Core.

Se la traduzione non esiste:

- fallback italiano.

Il testo pubblico importante deve passare da:

- SkinHarmony Core/traduttore;
- Claim Guard;
- eventuale review owner.

## Licenze E Smart Desk

Le licenze sono soft gate:

- avviso;
- grace;
- reminder;
- audit.

Non usare hard block brutale salvo contratto e conferma.

Le App Key Smart Desk servono a:

- attivare istanze;
- limitare seat;
- applicare piano;
- inviare branding/config bundle;
- collegare pulse aggregati.

Smart Desk Bridge non deve sincronizzare automaticamente senza:

- API key;
- consenso;
- privacy;
- test connessione;
- Core favorevole;
- owner confirmation.

## Tracking E Vendita

Google Ads:

- inserire solo AW ID e label reali;
- conversioni solo su lead/trial/WaaS/order reali;
- non creare campagne da Suite.

Traffic Attribution:

- aggregata;
- privacy-safe;
- niente IP in chiaro;
- niente città precisa senza integrazione.

Analytics WaaS con Render:

- la Suite continua a mostrare i dati locali del sito;
- se il Runtime Render è configurato, gli eventi vengono copiati anche su Render;
- nella pagina Analytics WaaS il blocco `Render Event Spine` mostra se il collegamento è locale, collegato o da verificare;
- Render serve a conservare e riepilogare eventi per tenant, così Core può leggere meglio funnel, pagine, CTA e sorgenti senza appesantire WordPress;
- nessuna campagna, budget, pagina, form o checkout viene modificato automaticamente.

Analytics WaaS come AI Operational Control Plane:

- leggere prima health score, conversion health, funnel health, tracking integrity e AI confidence;
- usare il funnel visuale per capire dove cade il percorso: impression, click, sessioni, CTA, richieste, checkout;
- usare `Next Controlled Moves` come coda operativa: why, action, verify e hold;
- usare `Pagine da correggere` per aprire prima le pagine con più visite e meno richiesta;
- ricordare la regola centrale: nessuna modifica automatica senza conferma owner.

## Aggiornamenti

Prima di aggiornare Suite:

1. controlla Enterprise Health;
2. verifica stable version;
3. verifica package zip;
4. verifica rollback zip;
5. fai canary/manual test;
6. carica zip;
7. controlla admin, frontend, CRM, Product Cards, Pagamenti/Contratti, Value Chain e Control Room.

## Errori Comuni

- Pulsante che porta alla pagina sbagliata: va collegato a dialog/azione coerente.
- Testi interni tipo `ready_preview` o `manual_sync_ready`: vanno tradotti in linguaggio utente.
- Card dentro card che escono dai box: bloccare publish e correggere layout.
- Claim Guard che blocca tutta la pagina: deve segnalare parola/riga e proporre riscrittura.
- Prezzi scritti a mano: usare listino ufficiale.
- Duplicare funzioni tra Suite e Core: Suite orchestra, Core decide testi/policy.

## Quando E Vendibile

Vendibile quote-first quando:

- Control Room pulita;
- CRM e lead funzionano;
- pagine WaaS/offerte pronte;
- licenze soft gate verificabili;
- Product Cards corrette;
- Claim/Price Guard senza criticità;
- tracking base attivo;
- rollback/update documentati.

Vendibile enterprise pieno solo quando:

- multi-tenant reale;
- update server stabile;
- Smart Desk Bridge sicuro;
- Core remoto pienamente collegato;
- audit/evidence completi;
- policy tenant mature;
- dashboard network completa.
