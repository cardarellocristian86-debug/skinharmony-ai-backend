# Changelog

## 0.16.0-ai-learning-factory — candidate

- Aggiunge cinque rami Nyra orizzontali/advisory per valutazione, governo dei
  dati di apprendimento, performance runtime, esperimenti causali e adattamento
  esclusivamente test-only.
- Aggiunge i guard Universal Core `ai_learning_governance_guard`,
  `ai_data_integrity_guard` e `agentic_budget_governance_guard`.
- Aggiunge `agentic_efficiency_intelligence` per compaction, riuso verificato,
  soppressione del lavoro duplicato, budget, review selettiva ed early stop
  governato.
- Introduce exposure fail-closed basata su coppia client/audience autenticata;
  ChatGPT resta limitato alla corteccia orizzontale e `owner_root` non costituisce
  un bypass.
- Aggiunge sedici capability dinamiche AI/Agentic senza aumentare la superficie
  MCP top-level di 13 strumenti.
- Aggiunge telemetria redatta, scorecard, work capsule e persistenza PostgreSQL
  additive con audit e rollback.
- Mantiene `execution_enabled=false`; nessuna promozione, mutazione di modelli o
  esecuzione esterna autonoma è abilitata.

La release resta candidata finché CI, benchmark reali, smoke live e rollback
rehearsal non sono verdi sul commit esatto.
