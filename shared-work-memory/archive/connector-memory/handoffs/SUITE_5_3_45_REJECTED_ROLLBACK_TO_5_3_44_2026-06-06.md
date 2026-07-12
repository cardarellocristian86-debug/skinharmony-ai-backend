# Suite 5.3.45 Rejected -> Rollback to 5.3.44

Data: `2026-06-06`

## Decisione
- `5.3.45` non va bene come baseline operativa.
- Si riparte da `5.3.44`.

## Motivo
- La `light view` sul `CRM B2B` non e allineata al flusso operativo richiesto.
- Aprire il CRM e vedere una schermata intermedia `vista leggera` e stato giudicato sbagliato.

## Regola corretta
- I moduli operativi come `CRM B2B` devono aprire direttamente nella vista completa.
- La cache/snapshot deve stare dietro le quinte:
  - velocizzare il caricamento;
  - evitare builder profondi inutili;
  - non cambiare il comportamento percepito da chi lavora.

## Baseline corrente
- Versione di riferimento: `5.3.44`
- Artefatto locale: `dist/skinharmony-site-suite-5.3.44.zip`
- Closure locale: `reports/wordpress/SUITE_OPERATIONAL_CLOSURE_5_3_44_LOCAL_2026-05-19.json`

## Nota per il prossimo ciclo
- Non riproporre `light view` come gateway UX per il CRM.
- Se si riapre il lavoro performance:
  - partire da `5.3.44`;
  - mantenere apertura diretta dei moduli operativi;
  - usare cache locale, snapshot e refresh parziale solo come meccanica interna.
