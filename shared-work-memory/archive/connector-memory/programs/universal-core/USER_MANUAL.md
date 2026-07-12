# Manuale Utente Universal Core

## A Cosa Serve

Serve a evitare che AI e automazioni decidano liberamente senza controllo. Core decide se una proposta e sicura, richiede review, va riscritta o va bloccata.

## Come Si Usa Con Codex

1. Genera varianti.
2. Passa varianti a Core 2.0.
3. Implementa solo la variante selezionata.
4. Salva report.

## Come Si Usa Per Intercettare Errori Smart Desk

1. Esegui lo scan locale read-only sul mirror Smart Desk con `npm --prefix universal-core-2.0 run nyra:smartdesk-code-overlay -- --target <mirror>`.
2. Leggi prima i findings `high`: endpoint chiamati dal frontend senza route backend, import locali mancanti e script HTML mancanti.
3. Tratta `uncalled_route_advisory` come verifica, non come bug certo: admin, webhook o endpoint esterni possono essere legittimi.
4. Prima di correggere Smart Desk apri una fase separata con Core gate; lo scan intercetta e documenta, non modifica Render.

## Come Si Usa Con Clienti

1. Genera API key scoped.
2. Collega Suite/Core/Smart Desk.
3. Manda snapshot/decision payload.
4. Mostra verdict e richiedi conferma quando serve.
