# SkinHarmony Vertical Work Method Learning Policy V1

## Scopo

Questa policy definisce il metodo interno SkinHarmony per apprendimento e miglioramento continuo del lavoro Codex/Core/Nyra.

Quando durante un lavoro emerge un errore ricorrente, un difetto di tono, una scelta visiva debole, un passaggio operativo confuso o una regola di qualita non rispettata, la correzione non deve restare solo nella chat. Deve diventare memoria operativa del connettore, con evidenza e regola anti-ripetizione.

## Perimetro

- Perimetro: verticale SkinHarmony.
- Uso: interno owner/Codex/Core/Nyra.
- Stato commerciale: non vendibile.
- Tipo: non automazione cliente.
- Distribuzione: non entra nei pacchetti automazioni, nei runbook vendibili o nel catalogo cliente.

Questa policy governa il modo in cui SkinHarmony lavora su se stessa. Non e una feature SaaS da esporre ai clienti.

## Regola Operativa

Ogni correzione di metodo deve indicare:

- errore o comportamento da non ripetere;
- contesto in cui e avvenuto;
- evidenza minima: report, screenshot, file, test, audit o feedback owner;
- regola pratica per prevenirlo;
- eventuale punto da aggiungere a checklist, policy, comando o mappa programma.

Comando interno:

```sh
sh-core-codex skinharmony-method-check \
  --correction "Errore o modo di lavoro da correggere" \
  --evidence "report/screenshot/test" \
  --prevent-repeat "Regola o controllo da applicare nei prossimi lavori"
```

Il comando scrive in:

```text
SHARED_MEMORY/method-learning/skinharmony_method_corrections.jsonl
reports/codex-core/skinharmony_method_check_latest.json
```

## Quando Aggiornare

Aggiornare il metodo quando:

- Cristian corregge tono, stile, priorita o processo;
- si ripete un errore gia visto;
- una pagina o asset risulta tecnicamente corretto ma non abbastanza SkinHarmony;
- compare linguaggio AI, tecnico, difensivo o debole in un contenuto pubblico;
- serve distinguere asset interno da asset vendibile;
- una verifica arriva troppo tardi e va anticipata nel flusso.

## Confini Vietati

Questa policy non autorizza:

- deploy;
- pubblicazioni;
- modifiche prezzi;
- claim medici o terapeutici;
- uso di dati cliente;
- automazioni che scrivono su WordPress, Render, tenant, pagamenti o clienti;
- trasformare correzioni interne in pacchetto commerciale.

Ogni azione sensibile resta soggetta a Core gate.

## Principio SkinHarmony

Il lavoro migliora mentre viene fatto. Ogni correzione utile deve lasciare una traccia concreta nel metodo, cosi il connettore riduce gli errori successivi invece di ripartire da zero.

Formula:

```text
Cristian corregge il metodo. Core governa il rischio. Nyra assorbe il pattern. Codex aggiorna con evidenza.
```

