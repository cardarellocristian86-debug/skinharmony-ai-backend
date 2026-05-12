# Smart Desk Suite App Key Bridge

Smart Desk resta il nodo operativo. SkinHarmony Site Suite resta il provider che genera App Key, piani, regole e snapshot di governance.

## Ruoli

- **Suite**: genera App Key, assegna piano, scadenza, moduli, policy brand e infrastruttura.
- **Smart Desk**: usa la App Key per sbloccarsi, riceve il bundle e invia pulse aggregati.
- **Brand / franchising / distributore**: definisce cataloghi, listini, protocolli e regole di modifica.
- **Centro**: usa Smart Desk e può modificare solo ciò che la policy consente.

## Variabili Render

Configurazione minima:

```env
SUITE_APP_KEY_PROVIDER_URL=https://www.skinharmony.it
```

Opzionale, se vuoi assegnare una chiave predefinita all'istanza:

```env
SUITE_APP_KEY=SHD-GOLD-XXXXXX-XXXXXXXX
SUITE_APP_KEY_TIMEOUT_MS=8000
```

## Endpoint Smart Desk

```http
GET  /api/suite-bridge/status
POST /api/suite-bridge/activate
POST /api/suite-bridge/config-bundle
POST /api/suite-bridge/pulse
```

Payload attivazione:

```json
{
  "appKey": "SHD-GOLD-XXXXXX-XXXXXXXX",
  "centerId": "center-001",
  "centerName": "Centro Demo SkinHarmony",
  "instanceId": "smartdesk-live-001"
}
```

Pulse consentito:

```json
{
  "appKey": "SHD-GOLD-XXXXXX-XXXXXXXX",
  "centerId": "center-001",
  "pulse": {
    "appointmentsToday": 12,
    "revenueToday": 950,
    "currency": "EUR",
    "activeStaff": 3,
    "stockAlerts": 1,
    "riskSignals": ["stock_low"],
    "healthStatus": "ok"
  }
}
```

## Privacy

Il bridge non invia clienti nominativi, telefoni, email, note scheda o trattamenti personali. Invia solo:

- stato licenza;
- configurazione piano/moduli;
- policy brand;
- aggregati operativi;
- segnali rischio.

## Policy modifiche locali

Suite può inviare una delle seguenti policy:

- `allowed`: il centro può modificare localmente.
- `approval_required`: il centro propone, il brand/owner approva.
- `locked`: il dato resta governato dal brand/franchising/distributore.

Questa regola vale per cataloghi, listini, protocolli, campagne e materiali approvati.
