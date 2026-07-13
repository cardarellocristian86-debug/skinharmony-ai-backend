# Nyra/Core Embedded Software Intelligence — 2026-07-13

## Esito

Implementato il primo nucleo realmente incorporato di Software Intelligence per
Nyra e Universal Core. Il runtime non dipende dalle applicazioni desktop Ghidra
o Frida, non esegue gli artefatti e non persiste il contenuto grezzo.

## Componenti consegnati

- branch Core `software_binary_intelligence` con 20 sotto-rami;
- branch Nyra `software_intelligence`, aperto automaticamente sui task software;
- gruppo Core `software_intelligence_lab`;
- rilevamento incorporato ELF, PE e Mach-O;
- architettura, bitness, endianness, entry point e metadati essenziali;
- SHA-256, entropia e stringhe ASCII con offset e redazione segreti;
- endpoint catalogo e analisi;
- manifest supply-chain per l'import successivo di componenti Ghidra/Frida;
- documentazione API e guardrail.

## Sicurezza e governance

- dichiarazione obbligatoria: `owned`, `written_permission` oppure `open_source`;
- finalita limitate a test, debugging, manutenzione, personalizzazione,
  interoperabilita, compatibilita e security review autorizzata;
- entitlement del branch e scope `read:decision` obbligatori;
- contenuto binario non salvato nell'audit;
- nessuna esecuzione, decompilazione, instrumentazione o patch automatica;
- patch e sandbox richiedono un verdetto Core separato;
- limite artefatto di 6 MiB per restare entro il limite JSON dopo Base64.

## Test

Comandi eseguiti:

```text
npm test                           # universal-core-service
npm run nyra:runtime:test
npm run core:mcp:test
npm run core:service:test
git diff --check
```

Risultati:

- Universal Core: 20 test unitari/API passati e smoke test completo passato;
- Nyra runtime: 4 test passati, tenant isolation e smoke passati;
- Core MCP: 37 test passati;
- regressione complessiva: nessun fallimento;
- `git diff --check`: nessun errore di whitespace.

Il primo rerun sull'ultimo `main` ha individuato un test di configurazione rimasto
allineato ai vecchi scope granulari. L'aspettativa e stata corretta per verificare
`core:read` e `core:govern`, coerentemente con le PR #15/#16, e l'intera suite e
poi tornata verde.

Copertura nuova:

- fixture ELF x86_64;
- fixture PE arm64;
- fixture Mach-O arm64;
- formato sconosciuto;
- autorizzazione assente o non valida;
- Base64 non valido;
- payload oltre limite;
- redazione di possibili segreti;
- entitlement negato;
- risposta senza contenuto Base64 originale;
- apertura automatica Nyra e disponibilita del ramo Core.

## Benchmark locale

Ambiente Linux x86_64 della sessione Codex, artefatti casuali, singola esecuzione:

| Dimensione | Tempo |
|---:|---:|
| 1 KiB | 1,25 ms |
| 1 MiB | 30,29 ms |
| 6 MiB | 152,97 ms |

Questi numeri sono indicativi e non sostituiscono il benchmark sul servizio
Render dopo il deploy.

## Stato Ghidra/Frida

Il motore nativo SkinHarmony e incorporato e attivo. I componenti upstream
Ghidra e Frida restano marcati `vendor_import_required`: non sono dichiarati
incorporati finche il Mac non fornisce versione esatta e sorgenti ufficiali e
non vengono completati hash, licenze, NOTICE, SBOM e build riproducibile.
