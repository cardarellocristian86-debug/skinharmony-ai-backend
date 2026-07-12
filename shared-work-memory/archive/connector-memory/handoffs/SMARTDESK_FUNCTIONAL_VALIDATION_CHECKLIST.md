# SMARTDESK FUNCTIONAL VALIDATION CHECKLIST

Ultimo aggiornamento: 2026-05-18T11:45:00+02:00

## Scopo
Evitare che un Codex dichiari `Smart Desk web pronta` solo perche il refactor e pulito.  
Questa checklist serve al collaudo reale fuori sandbox.

## Regola
- Non spuntare `[x]` senza prova reale di comportamento.
- `node --check` non basta.
- Il deploy Render resta bloccato finche questa checklist non e ragionevolmente verde.
- Runner tecnico standard:
  - `bash scripts/run_smartdesk_local_validation.sh`

## Preflight
- [ ] Avvio locale confermato da terminale utente reale su `http://127.0.0.1:3010`
- [ ] Login o ingresso shell confermato
- [ ] Nessun errore JS evidente all apertura
- [ ] Piano/moduli coerenti con `runtimeMeta.subscription.plan`

## Agenda
- [ ] Apertura agenda veloce
- [ ] Cambio data reale funzionante
- [ ] Slot orario cliccabile e nuova sessione apribile
- [ ] Full screen agenda con topbar nascosta
- [ ] Drawer `Appuntamento / Cliente / Azioni` funzionante
- [ ] `Conferma arrivo` aggiorna vista con feedback
- [ ] `Apri cassa` registra pagamento e chiude la seduta
- [ ] `Sposta` aggiorna data/ora senza rompere la vista
- [ ] `Non presentato / Annulla / Elimina` danno feedback e aggiornano la vista
- [ ] `Nota tecnica` salva e riappare correttamente

## Clienti
- [ ] Ricerca per nome / telefono / email
- [ ] Scheda cliente apre correttamente
- [ ] Storico appuntamenti leggibile
- [ ] Ultimi incassi coerenti
- [ ] Continuita cliente mostrata in modo coerente
- [ ] Blocco `Gold / Core` leggibile senza numeri inventati
- [ ] Dossier operativo cliente coerente
- [ ] Messaggio suggerito copiabile solo quando consentito

## Cassa
- [ ] Vista `Cassa` apre senza errori
- [ ] Giorno selezionabile funzionante
- [ ] Pagamento rapido salvato
- [ ] Collegamento `appuntamento aperto -> pagamento -> chiusura seduta` funzionante
- [ ] Storico pagamenti cliente / globale coerente
- [ ] `Verifica giornata` leggibile e sensata
- [ ] `Chiusura giornata` mostra stato coerente

## AI Gold
- [ ] Vista `AI Gold` apre correttamente
- [ ] Priorita primaria leggibile
- [ ] Priorita secondarie aprono il modulo giusto
- [ ] Pressioni del giorno coerenti con dati reali
- [ ] Coda marketing da approvare coerente
- [ ] Nessuna azione sensibile eseguita automaticamente

## Marketing
- [ ] Vista `Marketing` apre correttamente
- [ ] Bucket `Da richiamare / A rischio / Perso / Storico` coerenti
- [ ] Messaggio suggerito copiabile
- [ ] Consenso marketing rispettato
- [ ] Ponte verso scheda cliente e AI Gold funzionante

## Magazzino
- [ ] Vista `Magazzino` apre correttamente
- [ ] Overview premium leggibile
- [ ] Sottoscorta coerente
- [ ] Registrazione movimento stock funzionante
- [ ] Movimenti recenti aggiornati

## Redditivita
- [ ] Vista `Redditivita` apre correttamente
- [ ] Gating piano/modulo coerente
- [ ] Range date funzionante
- [ ] Refresh analisi funzionante
- [ ] Nessun numero inventato quando l overview backend manca

## Protocolli
- [ ] Vista `Protocolli` apre correttamente
- [ ] Gating piano/modulo coerente
- [ ] Trattamenti recenti leggibili
- [ ] Registrazione trattamento funzionante
- [ ] Ponte minimo con clienti / AI Gold coerente

## Esito finale
- [ ] Smart Desk web pronta per preflight Render
- [ ] Note residue annotate in `STATE_SNAPSHOT.md`
