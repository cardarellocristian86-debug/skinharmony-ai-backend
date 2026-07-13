# Nyra/Core Embedded Software Intelligence

## Stato

Il branch orizzontale `software_binary_intelligence` fornisce una prima analisi
statica incorporata nel servizio Universal Core. Non richiede l'app desktop di
Ghidra o Frida e non esegue l'artefatto ricevuto.

Capacita attive:

- rilevamento ELF, PE e Mach-O;
- architettura, bitness, endianness ed entry point quando disponibile;
- metadati essenziali delle intestazioni eseguibili;
- SHA-256, entropia e stringhe ASCII con offset;
- redazione di possibili segreti ed email;
- dichiarazione esplicita di confidenza e limiti dell'analisi.

## Contratto di governance

L'endpoint rifiuta l'analisi senza dichiarazione esplicita di proprieta,
autorizzazione scritta o licenza open source. Gli scopi ammessi sono test,
debugging, manutenzione, personalizzazione, interoperabilita, compatibilita e
security review autorizzata.

Il servizio Core:

- non esegue binari;
- non persiste il contenuto grezzo;
- registra nell'audit soltanto hash, dimensione, formato, architettura e scopo;
- non genera patch nell'endpoint di analisi;
- richiede un verdetto Core separato per sandbox, patch e pubblicazione.

## API

Catalogo componenti:

```text
GET /v1/software-intelligence/components
```

Analisi:

```json
POST /v1/software-intelligence/analyze
{
  "artifact": {
    "name": "app.bin",
    "content_base64": "..."
  },
  "authorization": {
    "asserted": true,
    "basis": "owned",
    "purpose": "testing"
  }
}
```

Entrambi gli endpoint richiedono `read:decision` e il branch
`software_binary_intelligence` nel package del tenant. La dimensione massima
predefinita e 6 MiB, cosi la codifica Base64 resta entro il limite JSON del
servizio.

## Import dei componenti Ghidra e Frida

Il manifest distingue il motore nativo gia incorporato dai componenti upstream
non ancora importati. I componenti upstream possono entrare soltanto da sorgenti
ufficiali, con versione esatta, hash, SBOM, licenza, NOTICE e test di
riproducibilita. Copiare cartelle da un'applicazione installata non e una fonte
sufficiente per la supply-chain.

Ghidra e Frida non vengono dichiarati incorporati fino al completamento di tale
processo. Questo evita sia dichiarazioni tecniche false sia distribuzioni con
licenze o dipendenze incomplete.
