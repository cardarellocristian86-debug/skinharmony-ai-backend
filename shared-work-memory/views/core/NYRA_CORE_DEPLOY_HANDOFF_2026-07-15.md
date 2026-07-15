# Nyra / Universal Core — handoff di deploy

Data: 2026-07-15
Commit candidato: `2104508`
Ambito: Nyra, Universal Core, MCP e bridge necessario Smart Desk → Core → Nyra.

## Consegnato e verificato localmente

- SkinHarmony risolve il domain pack tenant-scoped `skinharmony`; un tenant generico resta `generic`.
- I rami verticali SkinHarmony sono raggiungibili solo tramite il pack autorizzato.
- Il preflight MCP conserva `gate.allowed`.
- Core distingue stabilmente `ALLOW`, `CONFIRM`, `DEFER` e `BLOCK`; `verified_outcome=false` è limitato alle vere azioni di learning/outcome.
- Il bridge Smart Desk invia a Core/Nyra un payload canonico minimizzato, senza dati cliente, prompt grezzi, segreti o autorizzazioni di esecuzione.
- Il build dell'estrattore Rust evita il proxy rustup non affidabile e usa il toolchain stable installato.

## Verifiche locali

- Universal Core: 97 test passati e smoke end-to-end passato.
- MCP: 77 test passati.
- Bridge Smart Desk: semantic selection, contratto Nyra/Core ed external AI bridge passati.
- Build Rust: completato.
- Nessun segreto incluso in commit o report.

## Resta da chiudere

1. Cockpit 360: definire e applicare il contratto `cockpit_360_v1` tra il payload Smart Desk `gold_cockpit_v1`, Core, Nyra e gli endpoint Suite strettamente necessari. Nessuna modifica dati cliente o automazione.
2. Osservabilità Render: raccogliere metriche realmente osservate per restart count, memoria, latenza di sincronizzazione MCP/Core/Nyra ed error rate; non usare valori stimati.
3. CI remota: dopo il push, verificare i job GitHub Actions di MCP, Universal Core e Nyra sullo stesso commit prima di dichiarare il rilascio completo.
4. Verifica deploy Render: health endpoint e log privi di segreti, con controllo dei restart effettivi.

## Guardrail invariati

- Fail-closed, tenant isolation, audit e redazione segreti restano obbligatori.
- Nessuna pubblicazione, deploy o azione esterna automatica bypassa Core e owner confirmation.
- Il test multi-agent 5/10 era già passato e non è un blocco di questo handoff.
