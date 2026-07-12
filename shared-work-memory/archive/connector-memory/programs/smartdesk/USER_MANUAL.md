# Manuale Utente Smart Desk

Aggiornato: 2026-06-06 - Base completo, Silver controllo, Gold AI operativa e Assistente virtuale Nyra.

## A Cosa Serve

Serve a gestire il centro ogni giorno: agenda, clienti, cassa, turni, magazzino, protocolli e priorità operative.

## Come Si Usa

1. Apri dashboard.
2. Controlla alert AI/priorità.
3. Gestisci agenda e clienti.
4. Incassa da cassa.
5. Usa l'Assistente virtuale Nyra per farti guidare nei moduli.
6. Usa AI Gold per priorità, clienti da richiamare, redditività e azioni da confermare.

## Assistente Virtuale Nyra

- Nyra guida l'uso quotidiano: aprire agenda/clienti/cassa, aggiungere cliente, registrare pagamento, configurare servizi/operatori e capire cosa include il piano.
- Le richieste semplici restano locali e non consumano OpenAI.
- Le richieste di testo/copy piu articolate possono usare OpenAI.
- Le richieste sensibili o distruttive vengono bloccate e richiedono controllo Core/operatore.
- Le priorita Gold restano su AI Gold/Core/Gold State: Nyra non inventa dati e non esegue azioni senza conferma.

## Uso Gold

1. Apri AI Gold o Dashboard.
2. Leggi la priorita principale: cosa fare oggi.
3. Controlla confidence, rischio e spiegazione.
4. Se Gold segnala dati incompleti, correggi il modulo fonte.
5. Apri il modulo collegato: marketing, cassa, servizi, magazzino o agenda.
6. Approva manualmente messaggi, WhatsApp o azioni.
7. Registra l'esito quando l'azione e conclusa.

## Onboarding Gold

1. Carica CSV/XLSX clienti, appuntamenti o pagamenti.
2. Verifica righe `SAFE`, `REVIEW`, `INVALID`.
3. Approva solo le righe da importare.
4. Conferma import.
5. Lascia ricostruire Gold State e PIAL.
6. Controlla quali feature risultano abilitate.

## Lettura PIAL

- L0: dati insufficienti.
- L1-L2: priorita operative e recall base.
- L3: analisi economica.
- L4: ottimizzazione strategica.
- L5: scenari prudenziali e marketing intelligente.

Se una funzione e bloccata, non e un bug automatico: puo significare dati insufficienti o rischio troppo alto.

## Stati/Piani

- Base: gestionale completo per lavoro quotidiano con dashboard, agenda, clienti, servizi, cassa, pagamenti, marketing manuale, magazzino base, turni base, protocolli manuali, report base e impostazioni.
- Silver: tutto il Base piu redditivita, report evoluti, magazzino evoluto, turni evoluti e controlli operativi piu profondi.
- Gold: tutto il Silver piu AI Gold operativa, priorita giornaliere, marketing suggerito, clienti da recuperare, alert redditivita e suggerimenti sempre confermati.
- Enterprise: multi-centro/avanzato.

## Fuori Scope Commerciale

- Prenotazione online pubblica e flussi collegati.
- Protocolli AI, protocolli guidati/adattivi e analisi protocollo AI finche non sono sistemati e testati.

## Regole Uso

- Prima controlla alert/priorita.
- Poi agenda, clienti e cassa.
- Le azioni AI vanno confermate.
- WhatsApp Gold non invia senza consenso/conferma.
- WhatsApp Gold puo usare il Twilio del centro: il centro inserisce Account SID, Auth Token e sender, poi usa `Test connessione`. Il token non viene mostrato dopo il salvataggio.
- Se Twilio non e pronto o rifiuta l'invio, usare fallback copia/apertura manuale.
- Se un numero sembra errato, correggere il dato nel modulo sorgente.
- Se una funzione non e inclusa nel piano, deve comparire preview/upgrade, non errore tecnico.

## Superadmin

- Usa stanza di controllo/Fleet per vedere lo stato dei centri.
- Support mode serve per assistenza e non deve confondere dati tenant.
- Le azioni admin distruttive richiedono controllo esplicito.
