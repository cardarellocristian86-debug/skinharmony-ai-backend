# Suite Agnostic Data Separation Policy

Stato: regola persistente workspace.
Data: 2026-05-26.

## Regola
`codice = motore`
`WordPress/Suite = dati tenant`

SkinHarmony Site Suite deve essere trattata come motore agnostico. Prezzi, listini, testi commerciali, contatti, social, endpoint cliente, configurazioni Smart Desk/Core/Nyra e preset proprietari non devono essere hardcoded nello zip distribuibile.

## Dove stanno i dati SkinHarmony
- WordPress options del sito SkinHarmony.
- File runtime/private locali non inclusi nello zip.
- Export/import amministrativi caricati manualmente nella Suite.

## Dove non devono stare
- Default del plugin vendibile.
- Template agnostici distribuiti ai clienti.
- README o documentazione operativa del plugin se destinata al cliente.
- Zip release vendibile.

## Eccezioni temporanee
Il plugin storico contiene ancora naming e preset SkinHarmony. Sono debito tecnico da separare progressivamente. Da oggi nessun nuovo listino, prezzo, contatto o testo commerciale SkinHarmony deve essere aggiunto ai default del codice.

## Regola proposta/PDF
Il generatore proposte deve leggere listini salvati come dati. Il PDF/stampa deve essere una bozza modificabile prima della consegna al cliente.

## Gate Core
Ogni modifica a prezzi, listini, checkout, pubblicazione o dati cliente resta azione sensibile e passa da Core gate.
