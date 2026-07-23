# Core + Nyra Admin Control Room

## Obiettivo

Il Control Room è una superficie umana separata da WordPress per osservare e governare Universal Core e Nyra. Il browser usa una sessione amministrativa; le credenziali Core restano esclusivamente sul server.

## Primo rilascio

Percorso: `/admin`.

Copre:

- login username/password iniziale con password derivata tramite `scrypt`;
- sessione firmata, cookie `HttpOnly`, `Secure` in produzione e `SameSite=Strict`;
- token CSRF sulle azioni scriventi;
- limite tentativi login in memoria;
- ruoli `owner` e `security_admin` per inventario, emissione e revoca chiavi;
- overview tenant, chiavi, catalogo Nyra, agent registry e audit sanitizzato;
- emissione chiave con conferma esplicita `CREATE_KEY`, visualizzata una sola volta;
- revoca con conferma esplicita `REVOKE_KEY`;
- UI statica senza dipendenze, servita dal processo Universal Core.

## Configurazione Render obbligatoria

Configurare solo tramite variabili segrete Render:

```text
CORE_ADMIN_SESSION_SECRET=<almeno 32 caratteri casuali>
CORE_ADMIN_BOOTSTRAP_USERNAME=<username owner>
CORE_ADMIN_BOOTSTRAP_PASSWORD=<password owner di almeno 16 caratteri>
```

Il bootstrap crea l'owner soltanto se non esiste già. Le variabili non vengono inviate alla UI, registrate nell'audit o restituite dalle API.

### Gate di configurazione

La configurazione è autorizzabile soltanto con la capability
`reversible_owner_confirmed_core_admin_bootstrap_configuration`.

Il relativo envelope:

- accetta esclusivamente il servizio Render `skinharmony-universal-core` e il suo ID registrato;
- richiede un contesto owner OAuth firmato e vincolato all'intera richiesta;
- permette solo le tre variabili elencate sopra, nello stesso ordine;
- dichiara che valori e segreti non sono presenti nell'envelope Core;
- crea esclusivamente variabili mancanti e vieta sovrascritture;
- non consente deploy, merge, provider execution, database, storage, domini, scaling o modifiche Auth0;
- vincola conferma, servizio, variabili e commit allo stesso payload;
- registra nell'audit solo riferimenti canonici non segreti.

L'API Render salva prima le variabili senza distribuirle. L'attivazione avviene
con un secondo deploy governato e reversibile, in modo che configurazione e
rilascio abbiano autorizzazioni e rollback separati.

## Mappa delle superfici

```text
Browser owner/admin
  -> /admin sessione umana
     -> API amministrativa server-side
        -> Universal Core: tenant, key store, audit, branch catalog, agent registry
           -> Nyra: branch routing e spiegazione
           -> MCP/ChatGPT/Codex: connettori separati, con scope propri
```

## Checklist prima del deploy

- [ ] Inserire le tre variabili bootstrap in Render, mai nel repository.
- [ ] Attivare dominio HTTPS dedicato e health check `/admin/healthz`.
- [ ] Effettuare primo accesso owner e sostituire la password bootstrap con un flusso di reset dedicato.
- [ ] Configurare MFA TOTP prima di abilitare revoche/chiavi in produzione.
- [ ] Testare login errato, rate limit, session fixation, CSRF, logout e accesso senza sessione.
- [ ] Testare isolamento tenant e permessi `security_admin`.
- [ ] Verificare che una nuova chiave sia visibile una sola volta e che il suo hash non compaia nelle risposte.
- [ ] Verificare audit, rollback del deploy e health post-deploy.

## Fasi successive obbligatorie

1. MFA TOTP, reset password, ruoli tenant-specifici e session store PostgreSQL.
2. Mappa Nyra interattiva: rami, sotto-rami, Core binding, maturità e routing.
3. Agent queue, review inbox, change/rollback board, evidence explorer e incident export.
4. OAuth separato per MCP/ChatGPT/Codex; il login admin non deve mai diventare una credenziale MCP.
5. Audit append-only su PostgreSQL e filtri/export firmati.

## Limiti intenzionali

- Non esiste password hardcoded.
- Non viene usata né esposta `CORE_SERVICE_ADMIN_KEY` nel browser.
- Nessuna chiave provider/OpenAI è visualizzabile nell'interfaccia.
- Il Control Room non invia deploy, messaggi o modifiche di policy in automatico.
