# Nyra Analyzer Italian Score Aliases Render Fix

Data: 2026-06-25

## Problema
L'endpoint live Analyzer accettava solo una parte delle chiavi score del payload iPad.

## Fix
Sono stati aggiunti gli alias italiani composti usati da Skin Analyzer Pro:
- `rossore_sensibilita`
- `texture_linee_fini`
- `discromie_uniformita`
- `pori_grana`
- `acqua_sebo`

## Effetto
Il payload iPad completo torna a `score_count=5` e Nyra puo leggere il quadro reale senza perdere metriche.

