# Universal Core V0/V1/V2/V7 — architettura Render

Data: 2026-07-15
Stato: implementato localmente, V2 Rust in `shadow` per impostazione predefinita

## Gerarchia

1. **V7 — scenario overlap router**: misura pressione e sovrapposizione, applica i guardrail e sceglie il percorso. Non autorizza azioni.
2. **V0 — final judge**: valuta casi ad alto rischio, blocchi, protezione e ambiguità critica. Resta l'autorità finale.
3. **V1 — canonical digest**: produce il digest deterministico di riferimento e governa il percorso ordinario.
4. **V2 Rust — digest accelerator**: processo persistente JSONL, isolato dal server HTTP. In modalità `shadow` calcola in parallelo e viene confrontato con V1; non prende decisioni né autorizza esecuzioni.

## Regole operative

- `V7 -> V0` per guardrail (`risk > 85` o `sensitivity > 0.80`) e pressione elevata.
- `V7 -> V1` per il percorso ordinario intermedio.
- `V7 -> V2` per il percorso veloce a bassa pressione.
- V2 ricade su V1 per timeout, processo assente, errore o mismatch.
- I casi `protection`, `critical`, `blocked`, rischio elevato, confidenza insufficiente o regole bloccanti vengono comunque elevati a V0.
- `execution_allowed` resta sempre `false`: questa gerarchia analizza e instrada, mentre autorizzazioni e conferme restano nel gate Universal Core esistente.
- Il client non può auto-dichiararsi owner/god: la modalità owner è solo configurazione server-side verificata.

## Endpoint tenant-scoped

- `GET /v1/runtime/hierarchy/status`
- `POST /v1/runtime/hierarchy/evaluate`

Entrambi richiedono `read:decision`. Il tenant del payload non può differire dal tenant autenticato. Audit e risposte contengono soltanto stato compatto, versioni, percorso e delta numerici; nessun segreto o payload grezzo.

## Attivazione progressiva

- `CORE_RUNTIME_V2_MODE=shadow` — predefinito e consigliato.
- `disabled` — disabilita il worker V2.
- `active` — ammette V2 come acceleratore solo quando la singola risposta ha parità esatta con V1 e non è richiesta escalation V0. Non conferisce autorità esecutiva.

L'attivazione generale di `active` richiede un campione storico rappresentativo, parità completa, benchmark di latenza e rollback verificato.

## Verifiche eseguite

- Test gerarchia V7, parità, fallback e V0: 4/4.
- Suite Universal Core Service: 86/86.
- Smoke test end-to-end del servizio: superato.
- Compilazione/parità massiva Rust: richiesta prima dell'attivazione e del collaudo live; su Render il build è fail-closed se il binario non viene prodotto.

## Obiettivo di latenza

Il worker Rust è persistente: evita un processo per richiesta. V7 esegue routing deterministico; V0 viene aperto solo quando necessario. In `shadow` il guadagno non viene ancora usato in produzione: serve a misurare parità e latenza senza regressioni.
