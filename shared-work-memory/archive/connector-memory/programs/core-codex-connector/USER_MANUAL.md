# Manuale Utente Core Codex Connector

## Avvio Rapido

```sh
cd /Users/cristiancardarello/skinharmony-codex
./scripts/start-codex-agent.sh codex_04 suite
```

Lo script usa `work-start`: crea automaticamente workspace-init, sessione, lock, intent, task contract, checklist progressiva, trace, checkpoint preflight e pulse iniziale prima di aprire Codex.
Da giugno 2026 `work-start` allega anche Mission Control: ruolo del Codex, livello autonomia e regola owner. Cristian non va chiesto per ogni micro-passaggio: si chiede solo quando Core/Nyra classificano `owner_required` o bloccano.

## Comandi Base

- `work-start`: avvia in un solo comando sessione, lock, intent, task contract, checklist, trace, preflight e pulse iniziale.
- `checklist-item`: spunta o blocca un punto della checklist con evidenza.
- `checklist-check`: verifica se la checklist e pronta per la chiusura.
- `workspace-init`: prepara un repo nuovo creando memoria condivisa, snapshot minimi, cartelle report, workflow runtime e registry programmi vuoto.
- `session-start`: apre sessione.
- `intent-start`: dichiara lavoro.
- `lock`: blocca area.
- `pulse`: aggiorna stato.
- `checkpoint`: salva fase.
- `cleanup-check`: verifica che non restino file fuori scope, scarti temporanei, file mancanti o test assenti.
- `finalize`: chiude con prove.
- `program-map-check`: verifica mappe programmi.
- `skinharmony-method-check`: verifica e aggiorna il Metodo SkinHarmony interno quando una correzione di lavoro deve diventare regola operativa.
- `local-agent`: interroga un modello Ollama locale come assistente coding subordinato, con contesto automatico di snapshot workspace, memoria Nyra e ultimo report Core locale.

## Ruoli Mission Control

- `orchestrator`: assegna e spezza il lavoro.
- `worker`: implementa dentro scope e lock.
- `researcher`: cerca evidenze, scenari e varianti; non modifica codice lockato.
- `support`: verifica e giudica il lavoro altrui.
- `code_corrector`: corregge errori di codice quando scope, lock e Core lo permettono.
- `tester`: produce verifiche e prove.

Livelli autonomia: `allow_auto`, `allow_with_audit`, `review_required`, `owner_required`, `blocked`.

## Regola

Se lavori su Suite/Core/Smart Desk/traduttore/connector e non aggiorni la mappa programma quando cambia qualcosa, il lavoro non e completo.
Per ogni lavoro non banale usa `work-start`: evita sessioni senza contratto e consente a Core 2.0 di controllare coerenza mentre Codex lavora.
Su un repo nuovo usa prima `workspace-init`, oppure lascia che `work-start`/`bootstrap` lo eseguano in automatico.
La checklist non e promemoria facoltativo: `finalize` resta bloccato finche ogni punto required non e `done` con evidenza oppure `not_applicable` con motivo/evidenza.
Quando Cristian corregge un errore di metodo, tono, visuale o processo che puo ripetersi, non lasciarlo solo in chat: registralo con `skinharmony-method-check`. Questa memoria e verticale SkinHarmony, interna, non vendibile e non sostituisce Core gate.

## Esempio

```sh
sh-core-codex work-start \
  --role worker \
  --title "Fix Smart Desk agenda" \
  --request "Correggere feedback azioni agenda senza toccare checkout" \
  --success "Azioni agenda aggiornano vista e test minimi passano" \
  --scope smartdesk \
  --item "Gate Core e lettura logica agenda" \
  --item "Fix feedback azioni agenda" \
  --item "Test agenda e cleanup"
```

Durante il lavoro:

```sh
sh-core-codex pulse \
  --summary "Cosa e cambiato e perche" \
  --file smartdesk/public/operations.js \
  --test "npm test" \
  --next "Verifica agenda e cleanup"
```

Quando un punto e davvero chiuso:

```sh
sh-core-codex checklist-item \
  --item "Fix feedback azioni agenda" \
  --status done \
  --evidence "smartdesk/public/operations.js aggiornato + npm test"
```

Verifica checklist:

```sh
sh-core-codex checklist-check
```

Quando una correzione deve diventare metodo:

```sh
sh-core-codex skinharmony-method-check \
  --correction "Evitare termini tecnici o difensivi nel copy pubblico quando il posizionamento richiede tono commerciale alto" \
  --evidence "reports/codex-core/client_facing_language_latest.json" \
  --prevent-repeat "Eseguire client-facing-check prima di pubblicare copy marketing SkinHarmony"
```

Uso agente locale governato:

```sh
sh-core-codex local-agent \
  --mode review \
  --prompt "Analizza questo file e dimmi ruolo, rischi e miglioramenti" \
  --context-file wordpress/plugins/skinharmony-site-suite/skinharmony-site-suite.php
```

Per una lettura piu ampia del workspace:

```sh
sh-core-codex local-agent \
  --mode coding \
  --prompt "Spiegami i blocchi principali del workspace" \
  --workspace-context minimal
```

Il comando resta advisory: usa Ollama locale, aggiorna Nyra sidecar se disponibile, allega il riassunto Core locale e scrive il report in `reports/codex-core/local_agent_latest.json`.

Prima di chiudere:

```sh
sh-core-codex cleanup-check \
  --file smartdesk/public/operations.js \
  --test "npm test"
```

```sh
sh-core-codex program-map-check \
  --file wordpress/plugins/skinharmony-core/includes/class-sh-site-translator.php \
  --file SHARED_MEMORY/programs/skinharmony-core/ARCHITECTURE.md
```

Se il primo file appartiene a un programma e manca un file programma aggiornato, il check blocca.
