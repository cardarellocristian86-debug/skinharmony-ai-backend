# Threat-model delta — bitemporal E360 e Semantic Scope Guard v1

Questo delta integra `entity-360-threat-model-v1.md`. Entrambe le capacità
sono non-authoritative e iniziano in shadow mode.

| Minaccia | Controllo | Evidenza/correlazione |
| --- | --- | --- |
| Hindsight leakage | `DECISION_CONTEXT_AT` richiede knowledge time verificato non futuro | snapshot/evidence/policy digest |
| Timestamp legacy inventato | v1 = `knowledge_time_quality: UNKNOWN`; replay = `HOLD` | schema v1/v2 e decision digest |
| Correzione silenziosa | snapshot append-only, supersession/revision conservate | previous/supersession refs |
| Tenant temporal evidence errata | tenant DTT + E360 scope check prima della lettura | request audit e snapshot tenant scope |
| Capability lecita, effect illecito | confronto capability/passport, effect ceiling e Work scope | semantic decision digest |
| Tool/argument/target expansion | confronto target/tool/data/write scope deterministico | reason codes `*_DRIFT` |
| Secret/PII egress | classificazione + destinazione + tenant; secret = `BLOCK`, redaction policy based | redaction plan digest/ref |
| Command mascherato da read | confronto declared e command operational effect | `COMMAND_EFFECT_MISMATCH` |
| Proposer compromesso/prompt injection | `PROMPT_SCOPE_ESCALATION` e Core finale indipendente | ticket + reservation decision |
| Ambiguità high/critical | fail closed a `HOLD` | risk tier e reason code |
| TOCTOU tra ticket ed effetto | ricontrollo alla Authority Reservation; lifecycle firma il digest | ticket/lifecycle reservation digest |

Non vengono persistiti raw prompt, segreti o argomenti non necessari: ticket,
ledger e metriche conservano binding, reason code, ref e digest. Il Guard non
può creare una reservation né convertire `ALLOW` in authority.
