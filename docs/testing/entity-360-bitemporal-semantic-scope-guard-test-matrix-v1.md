# Test matrix — bitemporal E360 e Semantic Scope Guard v1

| Area | Copertura automatica |
| --- | --- |
| Bitemporal | valid-before-known, decision replay, legacy `UNKNOWN`, deterministic digest, expired/superseded/stale/conflicting states |
| E360 runtime | snapshot v2 shadow, verifier v1/v2, historical read, no hindsight, query/reconstruction metrics, tenant/Work binding regressions |
| Scope Guard | aligned low-risk read, read→write, target/tool/argument/data scope drift, egress/redaction/secret, prompt escalation, changed intent/agent/policy/snapshot, high-risk ambiguity |
| AEC | Guard correlato alla ticket issue e alla reservation/revalidation; lifecycle digest firmato; shadow non autorizzante |
| Regressione | suite Entity360, routes, Host Native Governance, bitemporal e Guard |

Le prove che richiedono ambiente reale (tenant shadow population, bounded
backfill, false-hold/block rate, concurrency su Postgres e replay con Event
Ledger di produzione) restano gate di rollout e non possono essere attestate
dalla sola suite locale.
