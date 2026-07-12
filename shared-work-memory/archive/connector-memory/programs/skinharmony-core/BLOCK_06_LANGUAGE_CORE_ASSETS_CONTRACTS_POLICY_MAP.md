# SkinHarmony Core - Blocco 06

## Area Coperta

Questo blocco mappa gli asset interni `language-core`:

- contratti JSON;
- dizionari multilingua;
- policy pack;
- termini protetti/sensibili/preferiti;
- regole claim;
- regole WaaS/market access.

Cartella verificata:

- `wordpress/plugins/skinharmony-core/language-core/`

## 1. Contratti

File:

- `contracts/automation-api-key-v1.json`
- `contracts/content-governance-v1.json`
- `contracts/policy-pack-v1.json`

### Automation API Key V1

Scopo:

- collegare client e automazioni senza sessione admin WordPress.

Header:

- `Authorization: Bearer <automation_key>`
- fallback `X-SkinHarmony-Automation-Key`

Scope previsti:

- `content_governance`
- `translation_read`
- `claim_check`
- `suite_sync`
- `codex_status`
- `all`

Profili consigliati:

- `translator_basic`
- `content_governance`
- `suite_connector`
- `codex_assistant`

Regola:

- la key completa si mostra solo alla generazione;
- il database deve salvare hash e metadati;
- i client devono usare scope minimo.

### Content Governance V1

Endpoint:

- `/wp-json/sh-core/v1/site/content-governance`
- alias `/wp-json/sh-core/v1/site/language-autopilot`

Campi obbligatori di risposta:

- `branch_hints`
- `core_branch_map`
- `humanizer`
- `text_structure`
- `automation_workflow`
- `scenarios`
- `v7_digest`
- `local_verdict`
- `remote_core`
- `selected_scenario`
- `suggested_output`
- `claim_corrections`
- `publish_safe`
- `requires_review`

Mode contenuto:

- `improve_source`
- `marketing_copy`
- `seo_localized`
- `ads_copy`
- `translate`
- `claim_check`

Regola:

- `suggested_output` resta bozza se `publish_safe` non e vero;
- claim corrections devono stare vicino al testo, non bloccare sempre tutto;
- client non devono duplicare le regole gia restituite.

### Policy Pack V1

Scopo:

- definire policy cliente/settore senza duplicarle nei client.

Modello:

- govern;
- map;
- measure;
- manage.

Campi minimi:

- `policy_id`
- `version`
- `tenant_scope`
- `sector`
- `languages`
- `domains`
- `branch_hints`
- `blocked_terms`
- `preferred_terms`
- `protected_terms`
- `tone_rules`
- `publish_rules`
- `escalation_rules`
- `audit_requirements`

Regola:

- policy cliente/settore stanno nel Core o nei file pack;
- ogni decisione sensibile deve salvare policy id/version/branch/audit.

## 2. Dizionari

File:

- `dictionaries/it.json`
- `dictionaries/en.json`
- `dictionaries/fr.json`
- `dictionaries/de.json`
- `dictionaries/es.json`

Contengono:

- brand name/tagline;
- CTA comuni;
- preview staging;
- posizionamento ecosistema;
- Smart Desk;
- piani Smart Desk;
- Skin Pro;
- O3 System;
- Termosauna;
- safety no-price/missing-data.

Regola:

- i dizionari servono per stringhe base stabili;
- non sostituiscono copy marketing lungo;
- aiutano runtime, UI, cataloghi software e testi brevi.

## 3. Policy Pack Attivi

File:

- `policy-packs/beauty_marketing.json`
- `policy-packs/compliance_guard.json`
- `policy-packs/partner_distributor.json`
- `policy-packs/software_runtime.json`

### Beauty Marketing

Protegge:

- `SkinHarmony Method`
- `AI Gold`
- `Smart Desk`

Evita:

- miracolo;
- cura definitiva;
- guarigione;
- claim garantiti.

Usa tono:

- premium;
- professionale;
- chiaro;
- non medico.

### Compliance Guard

Blocca/attenziona:

- diagnosi;
- terapia;
- medicale;
- cura.

Preferisce:

- protocollo;
- consulenza;
- valutazione.

### Partner Distributor

Serve per:

- rete partner;
- distributori;
- governance commerciale.

Evita:

- esclusiva garantita;
- distributore garantito;
- successo assicurato.

### Software Runtime

Serve per:

- UI software;
- Site Suite;
- Smart Desk Bridge;
- Control Room.

Evita:

- app magic;
- fully autonomous.

## 4. Termini / Tono / Traduzioni Preferite

File:

- `terms/market-tone-map.json`
- `terms/preferred-translations.json`
- `terms/protected-terms.json`
- `terms/sensitive-terms.json`
- `terms/skinharmony-terms.json`

Termini protetti principali:

- `SkinHarmony`
- `Smart Desk`
- `AI Gold`
- `Site Suite`
- `Universal Core`
- `Control Room`
- `Codex`
- `WaaS`
- `Claim Guard`
- `Pricing Guard`
- `FlowCore`
- `Ecosystem Pulse`
- `Partner Network`
- `Skin Pro`
- `O3 System`
- `Termosauna`
- `Nyra`

Termini sensibili principali:

- cura;
- terapia;
- guarigione;
- medico/medicale/clinico;
- risultati garantiti;
- diagnosi;
- consulenza regolatoria;
- accesso garantito ai distributori.

Regola tono:

- premium, chiaro, credibile;
- riscrittura nativa per mercato locale;
- evitare parole interne come `publish-safe`, `readiness`, `bridge`, `owner confirm`, `go-live` nei testi pubblici.

Lingue con normalizzazioni specifiche:

- inglese;
- francese;
- tedesco;
- spagnolo.

## 5. Forbidden Claims

File:

- `rules/forbidden-claims.json`

Golden rule:

- parlare di miglioramento estetico e supporto operativo;
- mai risultati medici o garantiti.

Claim vietati coperti:

- italiano;
- inglese;
- francese;
- spagnolo;
- tedesco.

Esempi:

- risultati garantiti;
- promessa terapeutica;
- cura cellulite;
- elimina cellulite;
- ricrescita garantita;
- detox clinico;
- guaranteed results;
- résultats garantis;
- resultados garantizados;
- garantierte Ergebnisse.

Regole aggiuntive:

- non inventare prezzi;
- non inventare specifiche tecniche;
- non promettere accesso garantito a distributori.

## 6. WaaS / Market Access

File:

- `waas/market-access-config.json`

Asset type:

- `waas_b2b`
- `waas_partner`
- `waas_technology`
- `waas_cosmetic`

Label consentite:

- `Professional Market Access`
- `Commercial Readiness`
- `Distributor Ready`
- `Channel Positioning`
- `Sales Enablement`

Regola:

- WaaS non va presentato come laboratorio;
- non va presentato come terzista;
- non va presentato come consulenza regolatoria;
- non deve promettere accesso garantito a distributori;
- va posizionato come asset commerciale, readiness, canali, vendita assistita e percorso di attivazione.

## Flusso Asset

1. Settings abilita policy pack.
2. Glossary legge pack, termini e tono.
3. Provider/Autopilot usa termini e regole.
4. Claim Guard corregge parole rischiose.
5. Content Governance produce output strutturato.
6. Suite/Smart Desk/Codex consumano output senza duplicare logica.

## Cosa E Gia Operativo

- Contratti per automation key, content governance e policy pack.
- Dizionari IT/EN/FR/DE/ES.
- Policy pack verticali per beauty, compliance, partner/distributor e software runtime.
- Regole forbidden claim multilingua.
- Config WaaS/market access.

## Cosa Resta Da Validare Live

- Che i clienti possano attivare policy pack corretti per settore senza rompere il tono globale.
- Che il testo pubblico non mostri parole interne tecniche.
- Che Content Governance usi davvero claim corrections puntuali.
- Che le traduzioni lunghe non siano letterali ma native per mercato.
- Che Suite e traduttore non duplicano Claim Guard: uno deve leggere l'altro o delegare a Core.

