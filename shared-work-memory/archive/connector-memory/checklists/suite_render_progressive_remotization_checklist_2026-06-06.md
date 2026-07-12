# Suite Render Progressive Remotization Checklist

Data: 2026-06-06
Stato: operativo
Scope: checklist locale di lavoro, nessun deploy, nessun sync live, nessuna modifica tenant/chiavi

## Regola madre

- `WordPress plugin = client locale + render + fallback`
- `Render = control plane + registry + audit + runbook`
- `Core = decisione + rischio + policy`

## Cosa e gia corretto su Render

- [x] Control Plane come destinazione remota per snapshot e sync governati
- [x] Event Spine Analytics aggregato
- [x] Commerce Snapshot aggregato
- [x] Google provider config custodita lato Render
- [x] runtime remoto / evidence dashboard / runbook dispatch predisposti

## Cosa deve restare in WordPress

- [ ] shortcode pubblici
- [ ] render frontend e asset del sito
- [ ] lead capture e salvataggio locale
- [ ] WooCommerce bridge locale
- [ ] bozze/pagine WordPress
- [ ] preview WordPress
- [ ] fallback se Render non risponde
- [ ] health locale e mini audit locale

## Cosa va ancora spostato su Render

### P0 - Alleggerimento immediato

- [ ] registry centrali tenant/node
- [ ] policy registry tenant/settore/modulo
- [ ] audit/evidence centrale
- [ ] version registry / update channel / rollback registry
- [ ] timeout/cold-start strategy per GET read-only del Control Plane

### P1 - Control Plane vero

- [ ] decision queue centrale
- [ ] lock/concurrency centrale
- [ ] stato WordPress nodes
- [ ] stato Smart Desk nodes
- [ ] export report cliente
- [ ] dashboard enterprise unica

### P2 - Dati e calcoli pesanti

- [ ] snapshot CRM aggregati piu ricchi
- [ ] graph rete / network analytics
- [ ] claim scan pesanti fuori dal first paint WordPress
- [ ] price scan pesanti fuori dal first paint WordPress
- [ ] completion map / deep diagnostics persistiti lato Render
- [ ] storage pesanti su Render o custom table dedicate

### P3 - UI esterna

- [ ] app Suite esterna read-only
- [ ] dashboard operativa esterna
- [ ] CRM cockpit esterno
- [ ] product/technology registry esterno
- [ ] customer success esterno
- [ ] passaggio progressivo da wp-admin a UI SaaS

### P4 - Azioni confermate da Render

- [ ] crea lead/cliente via connector scoped
- [ ] prepara ordine assistito via connector scoped
- [ ] crea bozza documento via connector scoped
- [ ] aggiorna follow-up via connector scoped
- [ ] owner confirmation + audit obbligatori per ogni write sensibile

## Cosa non va spostato adesso

- [ ] checkout WooCommerce
- [ ] ordini WooCommerce come source of truth
- [ ] pubblicazione diretta pagine senza draft/owner confirm
- [ ] customer data raw negli snapshot remoti
- [ ] write automatiche cieche da Render a WordPress

## Colli reali oggi

- [ ] monolite WordPress ancora centrale per molte UI e handler
- [ ] first paint admin ancora sensibile ai builder profondi residui
- [ ] Render ha cold start sulle prime letture read-only
- [ ] troppi pannelli in wp-admin leggono ancora logiche profonde invece di snapshot cheap

## Ordine consigliato di esecuzione

1. [ ] censire i builder WordPress ancora pesanti per schermata
2. [ ] separare ovunque `light view` da `deep builder`
3. [ ] chiudere registry/policy/audit/versioning sul Control Plane
4. [ ] spostare i calcoli pesanti read-only fuori dal first paint WordPress
5. [ ] aprire la UI esterna read-only
6. [ ] aggiungere solo dopo le write owner-confirmed

## Criteri di chiusura per dire che il passaggio sta funzionando

- [ ] wp-admin apre solo viste leggere di default
- [ ] nessuna schermata operativa blocca su letture remote lente
- [ ] registry e policy non vivono piu come fonte primaria nel monolite
- [ ] Render diventa source of truth per snapshot, governance, audit e stato rete
- [ ] WordPress resta source of truth per sito, contenuti e WooCommerce
- [ ] UI cliente puo uscire progressivamente da wp-admin senza perdere fallback

## Prossimo micro-blocco corretto

- [x] creare inventario tecnico dei builder pesanti ancora nel plugin (`SHARED_MEMORY/checklists/suite_wordpress_heavy_builder_inventory_2026-06-06.md`)
- [x] marcare per ciascuno: `resta locale`, `va su Render`, `va solo cachato`, `va fuori first paint`
- [x] scegliere i 3 builder P0 da alleggerire subito: `render_dashboard()`, `render_waas_analytics_admin()`, `render_b2b_crm_admin()`
- [x] separare per i 3 P0 la shell leggera dai dati profondi
- [ ] aggiungere refresh parziale per sezione/card sulle tre schermate P0 senza ricalcolare il builder completo
