# Operazioni Core Codex Connector

## Test

```sh
node packages/core-codex-connector/src/cli.mjs --help
node packages/core-codex-connector/src/cli.mjs workspace-init
node packages/core-codex-connector/src/cli.mjs e2e-self-test
SH_CODEX_AGENT_ID=checklist_smoke node packages/core-codex-connector/src/cli.mjs work-start --session-id checklist_smoke_session --title "Checklist smoke" --request "Verificare checklist" --success "Checklist blocca e sblocca finalize" --scope reports/codex-core --item "Punto uno" --item "Punto due"
SH_CODEX_AGENT_ID=checklist_smoke node packages/core-codex-connector/src/cli.mjs checklist-item --item "Punto uno" --status done --evidence "smoke evidence"
SH_CODEX_AGENT_ID=checklist_smoke node packages/core-codex-connector/src/cli.mjs checklist-check
SH_CODEX_AGENT_ID=mission_control_smoke node packages/core-codex-connector/src/cli.mjs work-start --role researcher --title "Mission Control smoke" --request "Verificare metadata Mission Control multi-Codex senza deploy e senza produzione" --success "Il comando stampa livello autonomia e ruolo normalizzato" --scope SHARED_WORK --lock mission-control-smoke --file packages/core-codex-connector/src/cli.mjs --test "node --check packages/core-codex-connector/src/cli.mjs"
node packages/core-codex-connector/src/cli.mjs cleanup-check --file packages/core-codex-connector/src/cli.mjs --test "node --check packages/core-codex-connector/src/cli.mjs"
node packages/core-codex-connector/src/cli.mjs skinharmony-method-check
node scripts/program_registry_check.js
npm run codex:program-registry
node scripts/codex_shared_memory_preflight.js
node packages/core-codex-connector/src/cli.mjs program-map-check --file packages/core-codex-connector/src/cli.mjs --file SHARED_MEMORY/programs/core-codex-connector/ARCHITECTURE.md
node -e "const fs=require('fs'); const r=JSON.parse(fs.readFileSync('reports/codex-core/nyra_sidecar_latest.json','utf8')); if(!r.cli_contract_unchanged||r.render_touched) process.exit(1);"
```

## Test End-to-End Minimi

1. `node --check packages/core-codex-connector/src/cli.mjs`
2. `workspace-init` deve essere idempotente e non sovrascrivere memoria esistente.
3. `node packages/core-codex-connector/src/cli.mjs e2e-self-test` almeno tre volte quando si cambia enforcement.
4. `work-start` smoke su scope innocuo.
5. `checklist-check` deve bloccare con punti aperti.
6. `checklist-item --status done --evidence ...` deve spuntare i punti e `checklist-check` deve passare solo quando tutti i required sono chiusi.
7. `cleanup-check` positivo su file reale.
8. `cleanup-check` negativo su file temporaneo/fuori scope per confermare il blocco.
9. `supervise --cycles 1` sulla sessione attiva.
10. `finalize` deve bloccare se manca una fase/checklist e passare solo dopo preflight/during/after, checklist chiusa, test, cleanup e mappa programma.
11. Se cambia il sidecar Nyra, uno smoke `work-start -> checkpoint -> finalize` deve produrre `reports/codex-core/nyra_sidecar_latest.json` con `refreshed=true`, `cli_contract_unchanged=true` e `render_touched=false`.
12. Se cambia Mission Control, smoke `work-start --role researcher` deve stampare `mission_control=allow_with_audit`, `role=researcher`, `owner_default=false` su richiesta locale non-live.
13. Se cambia il Metodo SkinHarmony, `skinharmony-method-check` deve produrre stato `READY`, confermare `sellable_package=false` e non richiedere dati cliente o automazioni.

## Aggiornamento

- Modificare CLI.
- Aggiornare README/onboarding.
- Testare validator.
- Testare `task contract`, `trace_id`, checklist, `cleanup-check`, `work-start` e dashboard timeline.
- Aggiornare mappe programma.
- Se il comportamento del connector cambia, aggiornare sempre questa cartella programma.

## Note Operative Recenti

- 2026-05-29: sessione `codex_core_nyra_deploy_key_1780086886044` chiusa con deploy Render e rotazione Suite Codex Automation key. Report: `SHARED_MEMORY/reports/codex-orchestrator/codex_core_nyra_deploy_key_1780086886044_final.md`. Il caso conferma che i report operativi sotto `SHARED_MEMORY/reports/codex-orchestrator` devono essere accompagnati da evidenza checklist, checkpoint e mappa programma quando il finalize lo richiede.
- 2026-05-30: aggiunto Nyra sidecar locale al connector senza cambiare i comandi Codex. Verifica minima: `work-start`, `checkpoint` e `finalize` aggiornano la memoria distillata Nyra/Codex; se `universal-core-2.0` manca il comportamento resta no-op.
- 2026-06-02: aggiunto metadata Mission Control multi-Codex nel ciclo locale del connector. Verifica minima: `node --check` e smoke `work-start --role researcher` con autonomia `allow_with_audit` e owner default disattivato.
- 2026-06-02: separata la spiegazione `Nyra explain` dal testo tecnico `Core explain`. Core resta il giudice e il verdict non cambia; Nyra traduce blocchi, review e allow in motivo operativo, confine sicuro e prossimo passo. Verifica minima: `node --check`, gate `read_only` consentito e gate bloccato su local hard gate.
- 2026-06-05: aggiunto Metodo SkinHarmony verticale interno. Verifica minima: `node --check`, `skinharmony-method-check`, registrazione facoltativa con `--correction` e Program Registry READY. La memoria metodo resta interna e non entra nei pacchetti automazioni vendibili.

## Fallback

- Se Core 2.0 non risponde, usare runner locale o diagnosticare endpoint.
- Non bypassare blocchi senza `core off` esplicito.
