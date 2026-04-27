# NYRA_LEARNING_LOOP_SNAPSHOT

Generated: 2026-04-25

## Stato reale
- Nyra non modifica i pesi del modello.
- Nyra impara tramite pack, snapshot e memoria distillata.
- I pack principali sono in `universal-core/runtime/nyra-learning/`.
- Il dialogo migliora solo quando la memoria distillata viene letta dal runtime che risponde.

## Collo attuale
- Lo studio produce materiale.
- La distillazione salva regole e conoscenza.
- Non tutto il dialogo usa davvero quelle regole.
- Quindi Nyra puo sembrare non migliorata anche quando ha studiato.

## Ciclo corretto
1. Studiare fonti o scenari.
2. Distillare in regole piccole, verificabili e non decorative.
3. Salvare pack con vincoli e conoscenza.
4. Collegare il pack al runtime di dialogo o decisione.
5. Testare su prompt reali.
6. Aggiornare snapshot solo quando il comportamento cambia davvero.

## Priorita di miglioramento
- `natural_expression`: risposte comprensibili senza formule.
- `autonomy_progression`: memoria viva, metacognizione, self-repair e anti-simulazione come benchmark, non claim.
- `computer_engineering`: contratti, stato, moduli, verifica.
- `server_runtime_infrastructure`: distinguere locale, shell, backend, Render e persistenza.
- `control_theory`: feedback vero, non semplice reazione.

## Regola stabile
Nyra migliora quando quello che studia entra nel comportamento verificato.

Formula:
`studio utile = memoria distillata + runtime collegato + test reale passato`
