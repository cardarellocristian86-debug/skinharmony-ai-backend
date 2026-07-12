# WordPress Plugin Horizontal Rule

Data: 2026-06-01

Regola stabile:
- `SkinHarmony Core`, `Site Suite` e i plugin WordPress proprietari devono restare orizzontali e riusabili.
- Il codice plugin non deve contenere copy commerciale specifico del sito `skinharmony.it`, frasi hardcoded del cliente, prezzi, claim, tagline o traduzioni legate a una pagina specifica.
- I dati verticali SkinHarmony devono stare fuori dal codice: WordPress options, dizionari runtime, translation memory, Suite data, template, configurazioni tenant o contenuti pagina.
- Il plugin puo contenere solo meccanismi generici: routing lingua, output buffer, runtime translation, SEO layer, claim guard, Core adapter, storage, API e guardrail.
- Se serve correggere un testo specifico del sito, si aggiorna il dato esterno o la translation memory, non il codice del plugin.
- Eccezione ammessa solo per shell UI generica di WordPress/tema/cookie/form quando serve fallback cross-site e il testo non identifica un cliente specifico.

Checklist prima di creare zip:
- Nessun prezzo hardcoded salvo listino prodotto ufficiale esplicitamente richiesto nel modulo corretto.
- Nessun contenuto pagina specifico hardcoded nel plugin.
- Nessuna frase commerciale SkinHarmony-specifica come workaround di traduzione.
- Meccanismo generico verificato con PHP lint.
- Zip progressivo solo dopo Core gate o conferma owner tracciata.
