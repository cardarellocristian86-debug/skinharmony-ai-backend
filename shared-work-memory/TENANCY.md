# Shared-memory tenancy contract

1. Il tenant deriva soltanto dall'identità autenticata.
2. Nessun tool accetta `tenant_id` dall'utente.
3. Ogni file remoto vive sotto `tenants/<tenant_id>/`.
4. I path vengono risolti e verificati dentro il namespace assegnato.
5. L'archivio importato non è direttamente esposto.
6. Ogni lettura e scrittura futura deve produrre audit con tenant, soggetto, tool e percorso logico.
7. Chiavi, token e password sono vietati nella memoria condivisa.
