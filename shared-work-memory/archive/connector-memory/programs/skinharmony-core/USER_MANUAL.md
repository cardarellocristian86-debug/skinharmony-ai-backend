# Manuale Utente SkinHarmony Translation Hub

## A Cosa Serve

Serve a tradurre, migliorare testi, controllare claim e rendere il copy più chiaro e adatto al settore.

## Come Si Usa

1. Entra in WordPress > SkinHarmony Translation Hub.
2. Configura API/chiavi dove richiesto.
3. Usa traduzione o content governance sulle pagine.
4. Controlla review, claim e suggerimenti.
5. Pubblica solo dopo conferma quando il sistema segnala review.

## Flusso Consigliato

1. Configura lingue target e provider.
2. Esegui scan/integrity della pagina o del sito.
3. Traduci tramite queue o Language Autopilot.
4. Controlla `Review Queue`.
5. Correggi claim segnalati con le proposte puntuali.
6. Completa SEO localizzato.
7. Verifica readiness prima della pubblicazione.

## Quando Usare Language Autopilot

- Testi freddi o ripetitivi.
- Pagine prodotto/tecnologia che non spiegano bene cosa fanno.
- Traduzioni troppo letterali.
- Copy marketing da adattare a mercato locale.
- Claim da riscrivere senza bloccare tutta la pagina.

## Quando Usare Solo Memory / Review

- Stringhe UI brevi.
- Testi gia approvati.
- Cataloghi software.
- Testi dove non vuoi generazione AI nuova.

## Automation Key

- Genera una key per automazioni esterne.
- Usala solo con scope necessari.
- Revoca o rigenera se compromessa.

## Stati Tipici

- `publish_safe`: testo pronto.
- `requires_review`: serve controllo.
- `claim_risk`: claim da correggere.
- `needs_functional_detail`: testo troppo generico.
- `claim_safe_but_cold`: sicuro ma poco commerciale/umano.

## Ruoli

- Translator: vede dashboard/activity.
- Reviewer: puo revisionare.
- Approver: puo approvare.
- Publisher: puo pubblicare/operare.
- Compliance Officer: controlla review e claim.
- Regional Manager: puo approvare/pubblicare nel perimetro assegnato.
- Distributor: visione limitata dashboard.

## Regole Da Non Violare

- Non inventare prezzi.
- Non inventare specifiche tecniche.
- Non usare claim medici o terapeutici.
- Non tradurre termini protetti come se fossero parole generiche.
- Non pubblicare contenuti sensibili se `requires_review` e vero.
- Non duplicare in Suite regole gia presenti in Core: Suite deve consumare il servizio.
