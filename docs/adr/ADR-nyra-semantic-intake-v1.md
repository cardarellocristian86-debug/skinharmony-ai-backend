# ADR — Nyra Semantic Intake v1

## Decisione

Nyra riusa il router esistente `nyra-intent-router.js` come ingresso semantico
pre-Work. Non viene creato un secondo dialogo, un secondo Core, un secondo
policy engine o un secondo Entity 360.

L'ingresso distingue in modo server-side e provider-neutral:

| Tipo di domanda | Route | Effetto |
| --- | --- | --- |
| Stato di Nyra/Core, funzioni, toggle e runtime | `CONTROL_ROOM_READ` | Una lettura `nyra_control_room_status`, senza Work/preflight |
| Stato, task o continuità di un Work | normale `nyra_converse` | Binding Work + preflight/Core quando richiesto |
| Mutazione, anche mista a una domanda di stato | Core/guard | Nessuna lettura globale che mascheri l'azione |
| Ambiguità, injection o troppe clausole | `CORE_HOLD_THEN_NYRA` | Hold/chiarificazione, mai authority |

Con `NYRA_DIALOGUE_ENABLED=false`, il flag è un kill switch reale: la
superficie e l'handler di `nyra_converse`/continuation non sono disponibili.
`nyra_control_room_status` resta una lettura tenant-bound per rendere
osservabile lo stato OFF senza riattivare Dialogue.

## Semanticità “soft” e AI orizzontali

Il server usa anzitutto `lexical-semantic-engine.mjs` per il controllo
lessicale, scope e prompt-injection. Un host AI può allegare facoltativamente
un `nyra_semantic_intent_hint_v1` strutturato: route read-only, speech act e
confidence. È una parte “soft” di comprensione del linguaggio, portabile fra
host AI: il modello non deve calcolare digest, firmare dati o chiamare un
provider server-side. Il server calcola il digest del messaggio effettivo e lo
restituisce soltanto come binding di audit/replay.

Il hint è advisory, non una prova e non un comando. Può soltanto confermare una
route di lettura già sicura dopo l'intersezione server-side con:

- messaggio originale e digest server-generated;
- tenant autenticato;
- gate anti-injection;
- assenza di Work esplicito;
- assenza di verbo/effetto consequenziale.

Il hint non contiene e non può stabilire tenant, Work, policy, Passport,
reservation, Effect Ceiling, owner confirmation o authority. Un hint assente,
malformato, fuori dalla sola route read-only, o con segnali di injection viene
ignorato; il server continua con il percorso deterministico. Non viene
aggiunta alcuna API key o chiamata modello server-side (`server_model_calls=0`).
Questo consente a ChatGPT, Codex e future AI di usare la stessa interfaccia
senza lock-in. Un hint non può promuovere una mutazione: al massimo propone una
lettura Control Room che il server rende comunque tenant-bound e bounded.

## Invarianti

- Semantic Intake capisce il significato; Universal Core decide l'autorità.
- Una frase mista, ad esempio “quali funzioni sono attive e attiva Entity
  360”, non viene mai trattata come sola lettura.
- Un Work esplicito resta Work-scoped: non è convertito in una lettura globale.
- Stato sconosciuto resta `UNKNOWN`/non disponibile; non è inventato come OFF.
- Il contenuto raw del prompt non è inserito nella telemetria; restano solo
  digest e segnali bounded.

## Contratti e readback

La risposta versionata `nyra_conversation_turn_v3` contiene
`nyra_intent_route_v2`, `nyra_orchestration_directive_v2` e
`semantic_intake` (`authority: NONE`); la versione esplicita evita di mutare
silenziosamente i contratti v1/v2. Per una lettura Control Room include
soltanto il readback server-derived normalizzato in
`intent_routing.control_room`, con
`orchestration_directive.source=CONTROL_ROOM`, `work_bound=false`,
`selection_required=false`, action class `NONE` e nessun ticket.

Se il reader Control Room fallisce, Nyra restituisce una risposta bounded di
indisponibilità e non esegue fallback verso Gallery, Work, ticket, preflight o
azione. `intent_routing.control_room_readback` espone soltanto
`AVAILABLE`/`UNAVAILABLE` e una reason code bounded: il renderer non deve mai
inventare uno stato.

## Rollout, rollback e migrazione

La modifica è additiva: non cambia database, Entity 360, Work Identity o
policy state e non richiede backfill. Il router si attiva insieme al codice;
il percorso precedente rimane per Work e azioni. Il rollback è il revert del
bridge/contratto; impostare `NYRA_DIALOGUE_ENABLED=false` disattiva
immediatamente il dialogo mantenendo la Control Room read-only.

I test coprono status puro, Work esplicito, stato+muta, hint falsificato,
injection, analisi di clausole troncata, tenant-bound Control Room, kill switch
handler-level e descriptor MCP stale.
