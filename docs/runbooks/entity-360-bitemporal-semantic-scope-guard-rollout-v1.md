# Runbook — rollout e rollback bitemporal E360 / Semantic Scope Guard v1

## Preflight

1. Verificare migration store E360 `COMPLETED` e checkpoint
   `READBACK_VERIFIED`.
2. Verificare DTT tenant/Work binding, signer e verifier E360 separati.
3. Verificare che i legacy snapshot siano dichiarati `UNKNOWN`, non stimati.
4. Baseline dei current-path decision e delle latenze.

## Shadow rollout

Impostare, per tenant/canary autorizzato:

- `CORE_ENTITY360_BITEMPORAL_MODE=SHADOW`;
- `CORE_SEMANTIC_SCOPE_MODE=SHADOW`.

Confrontare current path, E360 bitemporal e decisioni del Guard. Monitorare
hindsight leakage impedito, stale context, scope drift, `HOLD`/`BLOCK`/`REDACT`,
latenza e overhead. Non promuovere a enforcement senza evidenza indipendente
e una policy/release governata successiva.

## Investigation

Per ogni high/critical `ALLOW` o qualsiasi `BLOCK`/`HOLD`/`REDACT`, correlare:
Work, intent, agent revision, Entity360 snapshot e as-of times, policy,
passport/effect ceiling derivati, authority reservation, ticket, lifecycle e
evidence digest. Ripetere il replay con `DECISION_CONTEXT_AT`; non usare
evidence registrata dopo la decisione.

## Rollback

Disabilitare prima il Semantic Guard (`OFF`) o mantenerlo `SHADOW`; quindi
disabilitare il bitemporal mode (`OFF`). Non eliminare snapshot v2, ticket o
lifecycle. Le read v1 restano compatibili e l’append-only history consente
forensic replay appena le dipendenze tornano disponibili.
