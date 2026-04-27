# NYRA_DIALOGUE_LAB_REPORT

## Varianti

| Variante | FinalScore | Utility | Risk | Style |
|---|---:|---:|---:|---|
| owner_heavy_v1 | 0.310258 | 0.690427 | 0.340761 | owner_heavy |
| self_check_v1 | 0.295957 | 0.668952 | 0.336276 | self_check_first |
| execution_guard_v1 | 0.267596 | 0.660713 | 0.352297 | execution_guard |
| action_router_v1 | 0.257247 | 0.642190 | 0.348337 | action_separated |
| semantic_owner_v1 | 0.205611 | 0.633791 | 0.386337 | semantic_owner |
| memory_pre_active_v1 | 0.177154 | 0.607818 | 0.387443 | memory_pre_active |
| linear_pipeline_v1 | 0.125140 | 0.569162 | 0.405436 | linear_pipeline |

## Scelta finale

- winner: `owner_heavy_v1`
- style: `owner_heavy`
- final score: `0.310258`
- expected utility: `0.690427`
- risk: `0.340761`

## Modulo ordine V1

1. owner_authority_recognizer
2. input_parser
3. intent_domain_router
4. core_decision_layer
5. action_router
6. self_diagnosis_layer
7. nyra_expression_layer
8. memory_writer

## Perché vince

- miglior equilibrio tra comprensione, sicurezza e memoria owner-only
- azione disciplinata tramite confirm_execute
- espressione naturale senza perdere coerenza col Core
- self model forte utile per identita, owner scope e autodiagnosi
