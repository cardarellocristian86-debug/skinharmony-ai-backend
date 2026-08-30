# ADR — Nyra Control Room v1

## Decisione

Nyra Control Room estende il Core MCP esistente con una lettura unica,
tenant-bound e server-derived: `nyra_control_room_status`.

Non introduce un secondo dashboard, un secondo Work store, un secondo policy
engine o una seconda authority. Riusa:

- `/healthz` di Universal Core per i readback di runtime;
- Work Continuity V2 per conteggi di chiusura e prossimo task;
- Host App Registry per la superficie visibile a ChatGPT, Codex e future AI;
- gli handler governati già esistenti quando una transizione è realmente
  supportata.

Il controllo è disponibile sia con `NYRA_DIALOGUE_ENABLED=false` sia nel
front-door conversazionale, ma resta una lettura. Nyra non riceve authority
aggiuntiva per il fatto di poterla spiegare.

## Perché non sono tutti interruttori ON/OFF

Un comando chat non può aggiornare arbitrariamente una variabile di deploy,
aggirare Core o far sembrare runtime una configurazione che richiede rollout.
Ogni dominio dichiara quindi azioni precise con una delle seguenti nature:

| Nature | Significato |
| --- | --- |
| `READ_ONLY` | lettura immediata, senza effetto |
| `REQUEST_BOUND_GOVERNED` | esiste un handler dedicato, con conferma owner e Core |
| `DEPLOYMENT_CONFIGURATION` | richiede una change request/release governata e riavvio |

Per esempio, Entity 360 espone solo la reale richiesta governata
`entity_360_shadow_enable`. Non viene pubblicato un fittizio `SET_OFF` finché
non esistono handler, rollback receipt e test corrispondenti. Nyra Dialogue e
Semantic Scope Guard restano configurazioni di deploy: la Control Room le
mostra e può guidare la change request, ma non scrive environment da chat.

## Contratto e trust boundary

`nyra_control_room_status_v1` restituisce esclusivamente:

- stato readback dei domini;
- categorie di azione e relativi prerequisiti;
- per un `work_id` esatto, percentuale, blocker, prossimo task e stato di
  closure derivati dalla projection V2 ACL'd.

La percentuale non è mai input dell'AI. È:

`(task richiesti completati + evidence richieste verificate + closure verificata) / (task richiesti + evidence richieste + closure gate)`.

Se il contesto V2 è assente o non valido, `percent=null`; uno stato mancante
dal health readback è `UNKNOWN`, non `OFF`.

Il reader Work usa il tenant autenticato e propaga una denial ACL/cross-tenant.
Non esegue il generic Work preflight, non legge raw evidence e non restituisce
contenuto sensibile.

## Invarianti

- Agent Identity non è Work Identity.
- Control Room, Nyra, Entity 360 e Semantic Guard non autorizzano effetti.
- Core rimane final authority; owner confirmation e host approval restano
  additive.
- Le applicazioni AI future ricevono la stessa superficie solo attraverso il
  registry/capability server-side; `client_type` nel payload non è authority.
- Nessun readback sconosciuto è convertito in una presunta disattivazione.

## Rollout e rollback

L'aggiunta è additive e read-only. Non richiede migrazioni, non modifica Work,
Entity 360 o policy. Il rollback rimuove il tool dal catalogo; gli store e i
contratti preesistenti restano invariati.

Prima di promuovere una futura command plane bisogna aggiungere per ogni nuova
azione: handler reale, Core gate, owner binding, idempotenza, audit readback,
rollback e test negativo. Un'etichetta UI non sostituisce nessuno di questi.
