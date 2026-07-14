# Multi-agent architecture v1

## Decisione

Universal Core resta l'autorità per identità, tenant, policy, autorizzazioni, audit, evidenze e azioni. Nyra apre il contesto di ragionamento. Il coordinatore conserva la risposta finale e chiama gli specialisti come capacità delimitate.

```text
Input autenticato
  -> Core: tenant + policy + route deterministica
  -> Nyra: rami e onde bounded
  -> Coordinatore: 0..2 chiamate modello in parallelo, massimo 3 specialisti totali
  -> Core: evidenza + verdict + approval/rollback
  -> Client autorizzato: eventuale esecuzione
```

Questa scelta segue il modello "agents as tools" per lavoro bounded: il manager conserva l'ownership della risposta; un handoff è riservato ai casi in cui un dominio deve davvero prendere in carico la conversazione. Fonti: [OpenAI orchestration](https://developers.openai.com/api/docs/guides/agents/orchestration), [guardrails e human review](https://developers.openai.com/api/docs/guides/agents/guardrails-approvals), [agent evaluation](https://developers.openai.com/api/docs/guides/agent-evals).

## Agent registry

| Classe | Agenti | Quando si usa | Credito |
| --- | --- | --- | --- |
| Deterministica | `core_intake_router`, `quality_evaluator` | routing, policy, schema, regressioni | 0 chiamate modello |
| Coordinamento | `work_coordinator` | solo quando serve sintetizzare specialisti | standard |
| Specialistica | ricerca, marketing/lingua, codice, variante Core | trigger esplicito e contratto narrow | una chiamata bounded |
| Visione | `vision_analyst` | soltanto se un'immagine autorizzata è presente | vision |
| Verticale | protocollo beauty, SmartDesk | solo con domain pack autorizzato dalla key | standard |

La "fabbrica di varianti" è `core_variant_designer`: produce una proposta con contratto, impatto, test, evidenze e rollback. Non crea automaticamente rami, non modifica Core e non pubblica.

## Regole di efficienza

1. Non usare un modello per routing, policy, autorizzazioni, validazione schema, calcoli, retry o audit.
2. Cache solo nel perimetro `tenant + request fingerprint`; mai riuso di memoria inter-tenant.
3. Fan-out massimo tre specialisti e due chiamate modello parallele; il Core riconcilia i risultati.
4. Escalare a ragionamento più costoso soltanto per conflitto non risolto, alta incertezza o modalità richiesta (vision/codice).
5. La memoria passa agli specialisti come contesto strutturato minimo, con provenienza, non come transcript completo.

## Sicurezza e promozione

Azioni che producono effetti (publish, deploy, pagamento, contatto cliente, write tenant, cancellazione) restano sospese finché non sono presenti verdict Core, conferma owner esplicita, audit tenant-scoped e sandbox/rollback quando applicabile. Un agent non ottiene mai un token o una delega più ampia di quella del suo workload: l'identità resta verificabile e revocabile.

Prima di promuovere un agente o una variante, eseguire una suite con casi positivi/negativi, isolamento tenant, scelta tool, blocchi di sicurezza, qualità dell'evidenza e comportamento di approval. Le tracce sono il punto di partenza per i grader; le valutazioni ripetibili vengono poi trasformate in dataset.

## API locali

- `GET /v1/agents/registry`: registry filtrato dal domain pack autorizzato.
- `POST /v1/agents/plan`: crea un piano advisory, senza invocare provider o eseguire side effect.

Entrambi richiedono scope `read:decision`. Il client non può selezionare il tenant né elevare il domain pack.
