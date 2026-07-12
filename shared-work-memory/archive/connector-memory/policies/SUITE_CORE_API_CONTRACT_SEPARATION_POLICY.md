# Suite / Core API Contract Separation Policy

Data: 2026-06-01

## Regola
SkinHarmony Suite non deve essere aggiornata a ogni aggiornamento interno di Universal Core su Render.

Suite deve lavorare tramite:

- API key scoped;
- endpoint Core stabili;
- contratti pubblici versionati;
- fallback locale/read-only quando Core non risponde;
- owner confirmation per azioni sensibili.

## Separazione

Universal Core su Render puo evolvere internamente senza richiedere una release Suite se:

- gli endpoint pubblici restano compatibili;
- lo schema di risposta resta compatibile;
- le policy di sicurezza restano uguali o piu restrittive;
- non cambiano nomi di campi letti da Suite;
- non cambia la semantica di `execution_allowed`, `owner_confirmation_required`, `decision`, `risk`, `confidence`.

Suite va aggiornata solo quando cambia:

- contratto API pubblico;
- endpoint usato da Suite;
- schema dati che Suite deve visualizzare;
- nuova capability da mostrare in UI;
- nuova azione governata;
- nuova chiave/scoping tenant;
- policy che richiede UI o consenso owner diverso.

## Responsabilita

- Core = motore decisionale, policy, ranking, analisi, gate, audit.
- Suite = UI operativa, orchestrazione, lettura dati WordPress/WooCommerce, invio snapshot/eventi e richiesta decisioni a Core.
- Render Suite Control Plane = storage/event spine/snapshot/bridge remoto, senza duplicare il motore Core.

## Regola pratica

Aggiornare Core non deve implicare aggiornare Suite.

Aggiornare Suite serve solo se il contratto tra Suite e Core cambia o se la UI deve mostrare una nuova capability.

## Anti-pattern da evitare

- Copiare logiche Core dentro Suite.
- Duplicare branch decisionali Core nel plugin.
- Bloccare release Suite per ogni deploy Core.
- Far dipendere Suite da versioni interne Core non pubbliche.
- Esporre segreti o token Core nel browser.

## Pattern corretto

Suite chiama Core cosi:

```text
Suite WordPress
-> scoped API key / tenant key
-> Suite Control Plane o Universal Core endpoint stabile
-> risposta decisionale read-only
-> UI Suite mostra diagnosi, azione proposta e richiesta conferma owner
```

Nessuna modifica automatica senza conferma owner.
