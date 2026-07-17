# Generic Agents — report benchmark multi-agente

## Obiettivo
Verificare il runtime Generic Agents su progetti complessi condivisi, senza dati cliente né azioni esterne.

## Scenari eseguiti in CI
- 24 progetti complessi, distribuiti su due tenant.
- Ogni progetto usa 11 ruoli: intake, 8 specialisti su varianti di scenario, synthesis e review.
- Totale: 264 worker orchestrati, con massimo 4 worker attivi per piano.
- Dipendenze: intake → varianti parallele → synthesis → review → Core join.
- Isolamento: tentativo di lettura del piano da tenant diverso, atteso fail-closed.
- Resilienza: 30 piani da 10 worker; 15 avviati e cancellati, 15 completati.

## Criteri di successo
- Tutti i 24 progetti convergono al Core join.
- Ogni join contiene 11 risultati worker.
- Nessun piano è leggibile cross-tenant.
- Le cancellazioni restano terminali e non contaminano piani vicini.
- La suite Universal Core e Core MCP resta verde.

## Limiti dichiarati
Il benchmark è deterministico e in-memory: verifica contratti, dipendenze, isolamento e limiti logici. Non misura ancora throughput di infrastruttura Render, memoria di processo o provider esterni; per questo servirebbe una prova di carico osservata in ambiente separato.
