# Work Preflight — checkpoint esteso a tutte le infrastrutture

Data: 2026-08-03  
Stato: implementazione locale verificata, non ancora promossa live

## Obiettivo

Rendere obbligatorio il passaggio dalla Tenant Work Gallery prima di ogni ingresso operativo verso Universal Core, Nyra/Core, Core MCP, SmartDesk, Suite Control Plane e adapter collegati.

## Regola operativa

Ogni richiesta operativa deve trasportare un envelope `skinharmony_work_preflight_v1` con:

- `preflight_id` e `mandatory: true`;
- tenant coerente con la chiave autenticata;
- superficie `tenant_work_gallery` e Gallery disponibile;
- memoria tenant richiamata (`memory_first.status: recalled`);
- governance Core esplicita.

Envelope assente o alterato: rifiuto fail-closed, senza esecuzione e senza fallback legacy. Nel bridge SmartDesk un envelope scaduto viene rifiutato localmente.

## Percorsi coperti

- Universal Core: decision, semantic selection, customer readiness, branch analyze, action mediation e Nyra/Core bridge.
- Core MCP: preflight host-side e propagazione dell’envelope al mediation handler.
- SmartDesk: cache locale bounded del preflight; gli adapter lo trasportano senza aprire una nuova connessione per ogni chiamata.
- Suite Control Plane: readiness/action proxy richiedono e inoltrano il preflight.
- Adapter collegati: devono usare il bridge governato o fornire esplicitamente l’envelope; chiamate dirette senza Gallery vengono rifiutate da Core.

## Prestazioni e loop

SmartDesk usa un solo envelope per un intervallo breve configurabile (`SMARTDESK_WORK_PREFLIGHT_TTL_MS`, default 90 secondi). La scadenza non attiva retry automatici: la chiamata successiva viene bloccata localmente con `work_preflight_required`. Una nuova preflight deve essere richiesta esplicitamente dal flusso di lavoro/lease.

## Test eseguiti

- syntax check su Universal Core, Core MCP, Suite Control Plane e SmartDesk;
- adapter SmartDesk senza preflight: nessuna chiamata di rete, rifiuto locale;
- preflight scaduto: nessun retry e nessuna chiamata di rete;
- Nyra/Core bridge SmartDesk con preflight: contratto passato;
- semantic selection SmartDesk con preflight: contratto passato;
- gate condiviso: envelope valido, tenant/Gallery/memory mismatch e envelope assente;
- `git diff --check`: passato.

## Rollback / ripresa

Se SmartDesk Gold peggiora o resta in attesa:

1. mantenere il commit/checkpoint precedente come baseline;
2. disabilitare il rollout del nuovo gate sui servizi secondari, senza rimuovere il contratto condiviso;
3. riprendere dal bridge SmartDesk e misurare cache hit, scadenze, chiamate Core e codici `WORK_PREFLIGHT_REQUIRED`;
4. riattivare prima in staging, poi canary, quindi produzione.

Non sono richiesti reset di dati, cancellazioni o rollback distruttivi.
