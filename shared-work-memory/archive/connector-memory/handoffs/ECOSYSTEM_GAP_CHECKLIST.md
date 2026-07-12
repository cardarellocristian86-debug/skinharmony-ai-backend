# Ecosystem Gap Checklist - 2026-05-17

Questa checklist serve a tutti i Codex che lavorano su SkinHarmony.

Regola:
- quando un punto viene chiuso davvero, cambiare `[ ]` in `[x]`
- non spuntare senza verifica reale
- se il punto e solo parziale, lasciare `[ ]` e aggiungere nota breve

## Posizionamento pubblico
- [ ] Chiudere una pagina pubblica forte e coerente per `Smart Desk`
- [ ] Chiudere una pagina pubblica forte e coerente per `WaaS / Site Suite`
- [ ] Chiudere una pagina pubblica forte e coerente per `Partner Network`
- [ ] Chiudere una pagina pubblica forte e coerente per `AI Gold`
- [ ] Chiudere una pagina pubblica forte e coerente per `ecosistema enterprise`

## Prova prodotto
- [ ] Preparare screenshot coerenti e approvati dei blocchi principali
- [ ] Preparare demo guidata reale dei flussi `Base / Silver / Gold`
- [ ] Preparare 2-3 casi d'uso con risultato operativo o ROI leggibile
- [ ] Rendere pubbliche prove abbastanza forti da sostenere il posizionamento premium

## Productization
- [ ] Allineare davvero `Smart Desk web` alla `desktop` come sorgente madre
- [ ] Chiudere `AI Gold` fino a livello coerente con il prezzo e la promessa commerciale
- [x] Rendere `Site Suite` piu leggibile come `control plane`, non solo come plugin
- [ ] Separare meglio lato prodotto visibile e lato infrastruttura interna

## Core e architettura
- [ ] Tenere `Universal Core su Render` agnostico
- [ ] Tenere i `rami del Core` agnostici
- [ ] Lasciare in SkinHarmony solo `tenant policy`, `adapter`, `vocabulary pack`, `runtime pack`
- [x] Collegare i task WordPress sensibili al `wordpress branch` del Core in modo stabile
- [ ] Collegare `Suite Core Connector` al ramo `wordpress` senza hardcode SkinHarmony nel Core

## Automazioni e governance
- [ ] Usare sempre `Codex + Core gate` per update, deploy, publish, release, chiavi, tenant, clienti
- [x] Tenere attivo il wrapper `scripts/codex-guarded-exec.sh` come percorso standard
- [ ] Agganciare ogni lavoro sensibile a `SHARED_MEMORY` con evento o handoff finale
- [x] Esporre in Suite una vista operativa `Shared Memory / Handoff` senza segreti

## Note aperte
- Stato iniziale: checklist creata dopo review ecosistema e confronto mercato.
- Se un punto viene chiuso, lasciare prova minima: file, report, URL o test.
- Avanzamento parziale `2026-05-17` su `Smart Desk web -> desktop`:
  - agenda web rafforzata con drawer a tab, stati operativi, move flow base e salto coerente a scheda cliente minima
  - file: [smartdesk/public/app.js](/Users/cristiancardarello/skinharmony-codex/smartdesk/public/app.js:1)
  - verifica: `node --check smartdesk/public/app.js`
  - non basta ancora per spuntare `[x]` il punto `Allineare davvero Smart Desk web alla desktop`
- Chiusure verificate `2026-05-17`:
  - `wordpress branch` chiuso: [universal-core/packages/branches/wordpress/src/index.ts](/Users/cristiancardarello/skinharmony-codex/universal-core/packages/branches/wordpress/src/index.ts:1), [UNIVERSAL_CORE_WORDPRESS_BRANCH_V1.md](/Users/cristiancardarello/skinharmony-codex/universal-core/docs/UNIVERSAL_CORE_WORDPRESS_BRANCH_V1.md:1), [wordpress-branch-smoke-test.ts](/Users/cristiancardarello/skinharmony-codex/universal-core/tests/wordpress-branch-smoke-test.ts:1), gate report [codex_core_gate_latest.json](/Users/cristiancardarello/skinharmony-codex/reports/codex-core/codex_core_gate_latest.json:1) con `action=publish` e `branch=wordpress`.
  - wrapper standard chiuso: [codex-guarded-exec.sh](/Users/cristiancardarello/skinharmony-codex/scripts/codex-guarded-exec.sh:1) ora usa prima il connector locale del repo e poi il gate remoto.
  - `Site Suite come control plane` chiuso: [skinharmony-site-suite.php](/Users/cristiancardarello/skinharmony-codex/wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php:3452) ora rafforza in Control Room/Core Connector il linguaggio `control plane`, i passaggi owner e la memoria operativa condivisa.
  - `Shared Memory / Handoff in Suite` chiuso: [skinharmony-site-suite.php](/Users/cristiancardarello/skinharmony-codex/wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php:8481) aggiunge pagina admin dedicata read-only, scorciatoie dalla Control Room e lettura sicura di snapshot/checklist/eventi/handoff senza segreti.
