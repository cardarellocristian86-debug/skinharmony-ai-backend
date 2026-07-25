# ADR: Nyra Governed Research & Distillation Layer

## Stato

Accettato localmente per l’implementazione nel Core MCP.

## Contesto

Il repository aveva già:

- `research-cortex` tenant-scoped;
- `memory-fabric` per memoria durabile;
- `work_preflight` e DTT nel Core service;
- branch learning e learning pack preesistenti.

Mancavano però:

- registry sorgenti versionato e governato;
- workspace temporaneo per evidence runs;
- distillazione esplicita con candidate tracciabili;
- status unificato per workspace, cache e learning candidate.

## Decisione

Estendere il Core MCP con un layer governato separato dal research cortex esistente, così da:

- non duplicare il runtime già in uso;
- mantenere compatibilità con i tool `nyra_research_*`;
- introdurre workspace temporanei e candidate distillati;
- restare fail-closed per tenant allowlist e feature flag.

## Conseguenze

Positive:

- il Core continua a essere l’autorità finale;
- la memoria permanente resta solo verified;
- il lavoro di ricerca resta temporaneo e redatto;
- il layer può essere spento senza toccare la V2 o il DTT.

Negative:

- più state da mantenere nel Core MCP;
- serve disciplina su TTL, cleanup e test di regressione.

## Alternative scartate

- duplicare il research runtime: rigettato;
- spostare tutto nel Universal Core service: rigettato perché già esiste il path MCP di ricerca;
- usare memoria permanente come workspace: rigettato.
