# Ramo Testo

Questo ramo Universal Core e il layer decisionale per `SkinHarmony Content Guard`.

## Scopo
- leggere issue di revisione testo;
- classificare rischio editoriale, claim e publish safety;
- restituire una decisione governata riusabile da:
  - plugin Traduttore SkinHarmony Core;
  - Suite;
  - Nyra;
  - Smart Desk;
  - materiali e pagine future.

## Cosa non fa
- non salva testi;
- non pubblica contenuti;
- non modifica pagine;
- non accetta correzioni senza conferma utente.

## Contratto minimo
Input:
- testo;
- lingua;
- contesto;
- issue rilevate dal motore Content Guard.

Output:
- stato;
- control level;
- publish_safe;
- azioni consigliate;
- motivi di blocco.

## Endpoint da esporre in un servizio remoto
- `GET /v1/tenant/status`
- `POST /v1/decision`
- `POST /v1/content-guard/check`

## Nota
Questo workspace contiene il ramo runtime, non ancora un server HTTP deployabile su Render.
