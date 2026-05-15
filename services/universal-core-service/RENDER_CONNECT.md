# Universal Core su Render - collegamento Suite / Smart Desk / Codex

## Stato

Il servizio e pronto per Render tramite `render-universal-core.yaml`.

Non contiene segreti nel repository. Le chiavi vanno generate sul servizio live dopo il deploy.

## Servizio Render

Blueprint:

```text
render-universal-core.yaml
```

Servizio previsto:

```text
skinharmony-universal-core
```

Variabili obbligatorie:

```text
CORE_SERVICE_ADMIN_KEY=<chiave lunga superadmin>
CORE_SERVICE_STORAGE_ROOT=/var/data/universal-core-service
NODE_ENV=production
```

Health check:

```text
GET /healthz
```

Versione runtime attesa dopo questo aggiornamento:

```text
0.3.6-action-mediation
```

La `0.3.6` aggiunge `action_mediation`, `explainability` e `commercial_explanation` ai verdict AI Gateway. Non cambia gli endpoint esistenti.

## Generazione chiavi live

Suite:

```bash
npm run core:client -- generate-key \
  --url https://skinharmony-universal-core.onrender.com \
  --admin-key "$CORE_SERVICE_ADMIN_KEY" \
  --tenant skinharmony \
  --brand skinharmony \
  --preset suite_connector
```

Smart Desk:

```bash
npm run core:client -- generate-key \
  --url https://skinharmony-universal-core.onrender.com \
  --admin-key "$CORE_SERVICE_ADMIN_KEY" \
  --tenant smartdesk-skinharmony \
  --brand skinharmony \
  --preset smartdesk_connector
```

Codex controllato:

```bash
npm run core:client -- generate-key \
  --url https://skinharmony-universal-core.onrender.com \
  --admin-key "$CORE_SERVICE_ADMIN_KEY" \
  --tenant skinharmony \
  --brand skinharmony \
  --preset codex_automation
```

## Env da mettere su Smart Desk Render

```text
UNIVERSAL_CORE_URL=https://skinharmony-universal-core.onrender.com
UNIVERSAL_CORE_KEY=<key smartdesk_connector>
UNIVERSAL_CORE_TENANT_ID=smartdesk-skinharmony
UNIVERSAL_CORE_BRAND_SCOPE=skinharmony
```

Endpoint Smart Desk dopo il deploy:

```text
GET  /api/universal-core/status
GET  /api/universal-core/tenant-status
GET  /api/universal-core/pulse
POST /api/universal-core/decision
POST /api/universal-core/branches/:branch
```

## Regole operative

- Core decide priorita/rischio/readiness.
- Nyra spiega e organizza.
- Suite e Smart Desk applicano solo dopo conferma owner/operatore.
- Nyra Finance resta ramo `nyra_finance_beauty_test`, test-only e separato.
- Nessun publish automatico.
- Nessun hard block brutale di default.
