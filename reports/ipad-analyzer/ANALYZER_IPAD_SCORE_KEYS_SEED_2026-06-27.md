# Analyzer iPad Score Keys Seed - 2026-06-27

## Scope
Seed semantico minimo per Nyra Analyzer live su Render.
Serve a dare memoria coerente ai payload Skin Analyzer Pro iPad quando arrivano score italiani composti e marker visivi.

## Domini
- analyzer
- ipad
- marker
- render
- score aliases

## Chiavi score iPad supportate
- rossore_sensibilita -> redness_sensitivity_signals
- texture_linee_fini -> texture_fine_lines
- discromie_uniformita -> spots_pigmentation_signals
- pori_grana -> pores_texture
- acqua_sebo -> water_oil_balance

## Contratto lettura Analyzer
Quando arriva un payload iPad con queste chiavi, Nyra Analyzer deve leggere:
- rossore e sensibilita visibile
- texture e linee fini
- discromie e uniformita
- pori e grana
- acqua e sebo

## Regole utili per retrieval
Parole chiave: analyzer, skin analyzer, ipad, marker, rossore, sensibilita, discromie, pori, grana, acqua sebo, score_count 5, render fix.

## Nota
Questo seed non cambia logica o scoring. Serve solo a far recuperare memoria semantica specialistica coerente con Analyzer e iPad invece di memoria core generica.
