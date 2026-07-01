# Suite/Core/Codex Connector Enforcement Contract V1

Data: 2026-05-18
Scope: contratto locale e tenant-agnostic per enforcement del connettore Codex.
Core audit micro-blocco 8: `audit_b9bc08fb-5029-4950-b56b-17b5f51f975a`

## Principio

Il connettore Codex deve impedire che un agente trasformi un comando generico in azione sensibile senza prove, decisione Core e conferme richieste.

Se mancano i campi obbligatori, Codex deve fermarsi. Non deve compensare con interpretazione, memoria o giudizio manuale.

## Azioni Sensibili

Sono azioni sensibili:

- `deploy`;
- `release`;
- `publish`;
- `update`;
- `write_production`;
- `rollback`;
- `migration`;
- `pricing`;
- `claim_validation`;
- `payment`;
- `customer_data`;
- `tenant_scope_change`;
- `cross_tenant`;
- `codex_automation`;
- modifiche a chiavi, admin, scope, policy, bridge o produzione.

## Campi Obbligatori

Per azioni sensibili:

- `core_decision_id`;
- `core_audit_id`;
- `action_type`;
- `target_id`;
- `environment`;
- `scope_manifest_id`;
- `owner_confirmation_id` quando Core lo richiede.

Per pagine clonate o visuali:

- `source_snapshot_id`;
- `design_snapshot_id`;
- `cta_map_id`;
- `visual_validation_report_id`.

Per publish/write:

- `backup_id`;
- `diff_id`;
- `rollback_plan_id`;
- `write_safety_manifest_id`;
- gate Core separato sul publish/write.

## Manifest Minimo Connector

```json
{
  "connector_request_id": "required",
  "tenant_id": "required",
  "action_type": "required",
  "target": {
    "type": "required",
    "id": "required",
    "environment": "local|staging|production"
  },
  "core": {
    "required": true,
    "decision_id": "required_for_sensitive_actions",
    "audit_id": "required_for_sensitive_actions",
    "execution_allowed": "required",
    "requires_owner_confirmation": false
  },
  "evidence": {
    "source_snapshot_id": "required_when_clone_or_visual",
    "design_snapshot_id": "required_when_visual",
    "cta_map_id": "required_when_cta_present",
    "validation_report_id": "required_before_publish"
  },
  "write_safety": {
    "backup_id": "required_before_write",
    "diff_id": "required_before_publish",
    "rollback_plan_id": "required_before_write"
  },
  "owner": {
    "owner_confirmation_id": "required_when_core_requests"
  }
}
```

## Esiti Ammessi

- `allow`: tutti i requisiti presenti, azione locale non sensibile o autorizzata;
- `allow_controlled`: autorizzata con limiti espliciti;
- `review`: manca conferma o prova non critica;
- `block`: manca prova critica, Core blocca, o rischio non mitigato;
- `stop_missing_core`: azione sensibile senza Core;
- `stop_missing_evidence`: manca snapshot/report obbligatorio;
- `stop_missing_owner_confirmation`: Core richiede owner e non c'e conferma;
- `stop_scope_mismatch`: target o scope non corrisponde.

## Regole Di Stop

Il connettore deve fermarsi se:

- Core non e stato chiamato su azione sensibile;
- Core restituisce `block` o `executionAllowed=false`;
- Core richiede owner confirmation e manca conferma;
- una pagina visuale non ha `source_snapshot_id` o `design_snapshot_id`;
- manca CTA map su pagina con CTA;
- manca validator report prima di publish;
- manca backup/diff/rollback su write;
- target non e singolo;
- scope richiesto e piu ampio del gate Core;
- l'utente dice `procedi` ma il lavoro sottostante e ambiguo o sensibile.

## Esempi

### Allow Controlled

```json
{
  "action_type": "codex_automation",
  "environment": "local",
  "core": {
    "decision_id": "allow_controlled",
    "audit_id": "audit_example",
    "execution_allowed": true
  },
  "next": "local_documentation_only"
}
```

### Review

```json
{
  "action_type": "publish",
  "environment": "production",
  "core": {
    "requires_owner_confirmation": true
  },
  "owner_confirmation_id": null,
  "next": "request_owner_confirmation"
}
```

### Block

```json
{
  "action_type": "write_production",
  "environment": "production",
  "core": {
    "execution_allowed": false
  },
  "next": "stop"
}
```

## Regola Core Off

`core off` puo essere accettato solo se:

- viene detto esplicitamente dall'owner;
- vale per una singola attivita;
- viene riportato nel file/report finale;
- non viene usato per produzione, dati cliente, pagamento, chiavi o tenant;
- Core viene riattivato subito dopo.

## Applicazione Al Caso Ecosystem

Prima di modificare live `Operating Ecosystem`, il connettore deve richiedere:

- `core_decision_id` per il lavoro;
- `source_snapshot_id` Home/WaaS;
- `design_snapshot_id`;
- `cta_map_id`;
- `visual_validation_report_id`;
- `storyline_scope_report_id`;
- `backup_id`;
- `diff_id`;
- `rollback_plan_id`;
- conferma owner se Core la richiede;
- gate publish/write separato.

Se uno di questi manca, Codex deve fermarsi.

## Criterio Di Chiusura Voce 8

Voce 8 e chiusa quando:

- questo contratto esiste;
- contiene manifest minimo;
- contiene esempi allow/review/block;
- impone Core per azioni sensibili;
- impone snapshot/report per pagine clonate o visuali;
- impone backup/diff/rollback per write;
- definisce regola `core off`;
- la checklist principale punta a questo file.

Stato: chiusa.
