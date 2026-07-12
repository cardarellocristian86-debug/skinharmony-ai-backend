# Suite Scale Readiness Checklist 5.3.7

Aggiornato: 2026-05-30T20:58:33Z

Stato base: Site Suite `5.3.7` installata, manifest allineato, Final Closure Board `18/18`, sync Render completato e handoff remoto `observable`.

Regola: non riaprire la release managed pilot. Ogni punto sotto e un blocco di scala/vendibilita e va chiuso con test minimo, report e memoria aggiornata.

## 1. Monolite
- [x] Estrarre `Product Inventory` dal monolite lasciando bridge compatibile.
  - Chiuso quando: form, REST/status, salvataggio, UI e test locali passano senza cambiare chiavi dati.
  - Stato 2026-05-30: chiuso con `5.3.11`. Helper, label, normalizer, calcoli base, status, guard E2E, REST `status/upsert`, logica admin post `create/duplicate/save` e renderer UI `Product Governance Hub` sono stati spostati in `SHSS_Product_Inventory_Service`; il monolite mantiene wrapper compatibili per route, permessi, nonce, redirect e pagina admin. Test locali OK: PHP lint, suite plugin `1684/1684`, closure preflight `22/22`. Nessuna chiave dati, form action, UI copy, WooCommerce o stock policy modificata.
- [ ] Estrarre `CRM B2B / Order Ledger` dal monolite lasciando source of truth distribuite.
  - Chiuso quando: cockpit, ledger, timeline, documenti e letture registry restano funzionanti.
- [ ] Estrarre `Analytics collector` dal monolite.
  - Chiuso quando: page view, CTA, scroll, engagement, Event Spine e Render forward restano invariati.
- [ ] Estrarre `Commerce/WooCommerce bridge` dal monolite.
  - Chiuso quando: ordini, pagamento, settlement, stock read-only e owner confirmation restano coerenti.
- [ ] Estrarre `Template/Page Factory`.
  - Chiuso quando: template, draft, clone, registry e salvataggi persistenti non dipendono da dati hardcoded.

## 2. Storage Scalabile
- [ ] Mappare options pesanti e crescita stimata.
  - Chiuso quando: elenco options, volume, rischio e owner proposto sono documentati.
- [ ] Spostare progressivamente eventi analytics su custom table o Render.
  - Chiuso quando: lettura dashboard non dipende da options infinite.
- [ ] Spostare CRM timeline / order ledger su storage dedicato.
  - Chiuso quando: cockpit legge da storage strutturato senza duplicare ordini.
- [ ] Spostare audit lunghi su storage dedicato con retention.
  - Chiuso quando: audit resta consultabile ma non appesantisce WordPress.
- [ ] Stabilire fallback locale se Render non risponde.
  - Chiuso quando: UI mostra stato degradato senza perdere operativita.

## 3. Ruoli Multiutente
- [ ] Definire capability reali per `owner`, `admin`, `agent`, `finance`, `support`.
  - Chiuso quando: matrice permessi e enforcement coincidono.
- [ ] Separare azioni registry da azioni CRM.
  - Chiuso quando: agent puo creare cliente/ordine assistito ma non modificare Product/Technology Registry.
- [ ] Separare pagamenti/settlements per finance.
  - Chiuso quando: finance vede pagamenti e settlement senza accesso completo al software.
- [ ] Separare support/customer success.
  - Chiuso quando: support vede follow-up, onboarding e rischio rinnovo senza cambiare prezzi/prodotti.

## 4. Soft Delete / Audit
- [ ] Sostituire cancellazioni dure CRM con archiviazione dove serve.
  - Chiuso quando: contatti, documenti e thread possono essere archiviati/ripristinati.
- [ ] Aggiungere audit trail per azioni sensibili.
  - Chiuso quando: chi, cosa, quando, modulo e owner confirmation sono tracciati.
- [ ] Bloccare hard delete su dati commerciali collegati a ordini/pagamenti.
  - Chiuso quando: record collegati non vengono eliminati senza percorso di revoca controllato.

## 5. Trial / Onboarding / Provisioning
- [ ] Mappare flusso trial -> lead -> licenza -> moduli -> dominio.
  - Chiuso quando: ogni passaggio ha source of truth e stato visibile.
- [ ] Collegare onboarding cliente a License Registry.
  - Chiuso quando: piano, scadenza, dominio, stato moduli e rinnovo sono visibili nel cockpit.
- [ ] Preparare provisioning WaaS controllato.
  - Chiuso quando: nessuna attivazione automatica avviene senza owner confirmation.

## 6. Price List Engine
- [ ] Mappare listini, offerte, bundle, contratti e margini.
  - Chiuso quando: e chiaro cosa vive in registry, CRM, Price Guard e contratti.
- [ ] Evitare doppia logica margine tra Product Inventory e CRM.
  - Chiuso quando: registry salva dati master; CRM calcola commerciale reale; Price Guard valida.
- [/] Evitare duplicazione tra Technology Registry e Product Registry.
  - Stato 2026-06-05: regola SSOT fissata; Suite locale in aggiornamento con route `technology-inventory/upsert`, tecnologie `registry-only` senza listino e stop ai nuovi upsert tecnologia -> Product Registry. Resta da migrare/archiviare le righe duplicate già create in passato.
- [ ] Collegare alert margine a owner confirmation.
  - Chiuso quando: vendite sotto soglia mostrano attention e non procedono senza conferma.

## 7. Verifica Release Continua
- [ ] Eseguire test locale dopo ogni blocco.
  - Minimo: PHP lint, suite plugin test, closure preflight.
- [ ] Aggiornare memoria condivisa dopo ogni blocco.
  - Minimo: `STATE_SNAPSHOT`, `WORK_SNAPSHOT`, `EVENTS.jsonl`.
- [ ] Non fare deploy/upload senza Core gate.
  - Minimo: report Core gate citato nel finale.
