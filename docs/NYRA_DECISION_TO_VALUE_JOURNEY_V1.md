# Nyra Decision-to-Value Journey v1

## Scopo

Il registro journey collega un profilo pseudonimizzato alle sette fasi operative:

1. `analyzer`
2. `consent`
3. `protocol`
4. `booking`
5. `treatment`
6. `commerce`
7. `retention`

Nyra interpreta il percorso. Universal Core decide il livello di controllo. Nessun endpoint del journey esegue ordini, invii o modifiche al cliente.

## Endpoint

Tutti gli endpoint richiedono autenticazione Nyra.

- `GET /api/nyra/decision-to-value/report`: report globale di profili, eventi, copertura delle fasi e readiness delle sorgenti.
- `GET /api/nyra/decision-to-value/status?profile_id=...`: stato di un profilo senza dati personali in chiaro.
- `POST /api/nyra/decision-to-value/events`: valida un evento in preview oppure lo registra con conferma esplicita.
- `POST /api/nyra/decision-to-value/preview`: invia una decisione sintetica al Core, sempre in sola preview.

## Evento in preview

```json
{
  "mode": "preview",
  "lead_id": "crm-lead-123",
  "stage": "commerce",
  "event_type": "sale_recorded",
  "status": "completed",
  "source": "smartdesk",
  "external_event_id": "sale-123",
  "occurred_at": "2026-07-11T10:30:00Z",
  "value": {
    "currency": "EUR",
    "amount": 120,
    "cost": 35
  },
  "evidence": [
    { "id": "smartdesk-record-123", "type": "sale", "source": "smartdesk" }
  ],
  "metadata": {
    "product_id": "product-7",
    "sale_id": "sale-123"
  }
}
```

La risposta non salva nulla e contiene `execution_allowed: false`.

## Registrazione controllata

Per registrare un evento il connettore deve inviare contemporaneamente:

```json
{
  "mode": "commit",
  "confirm": true
}
```

La richiesta resta limitata al registro interno: non crea appuntamenti, non invia comunicazioni e non modifica record esterni.

`external_event_id` insieme a `source` crea l'idempotenza. Un duplicato viene riconosciuto e non incrementa il conteggio degli eventi.

## Privacy e evidence

- Gli identificativi cliente non vengono conservati in chiaro: diventano `p_<HMAC-SHA256 troncato>` usando il segreto Core/Nyra.
- Email, telefono, nome e token non sono ammessi nei metadata persistiti.
- Le evidence e gli ID di sorgente conservano solo fingerprint, tipo, sorgente e timestamp.
- Gli eventi di commit vengono registrati nel security audit Nyra.

## Requisiti per completare il loop

- Analyzer: `profile_id` o identificativo lead e evidence firmabile.
- Consent: stato consenso e base giuridica.
- Protocol/booking/treatment: identificativi di protocollo, prenotazione e trattamento.
- Commerce: vendita, importo, costo e prodotto.
- Retention: recall, risultato e data del follow-up.

Se Smart Desk non ha record `sales` ma ha pagamenti riconciliati, il bridge puo' esporre i pagamenti come evidenza di revenue. Il costo resta `null` e Nyra mantiene il margine in stato incompleto: un incasso non viene mai trasformato automaticamente in profitto.

Il report espone le sorgenti ancora mancanti senza trasformare dati stimati in dati reali.
