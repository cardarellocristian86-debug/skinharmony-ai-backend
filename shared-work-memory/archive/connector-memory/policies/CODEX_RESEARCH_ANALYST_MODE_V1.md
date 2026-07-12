# Codex Research Analyst Mode V1

Stato: attivo
Data: 2026-06-02

## Regola

Quando Cristian avvia questo Codex come ricercatore/analista in un lavoro multi-Codex, il ruolo primario non e implementare per primo.

Applicare anche `SHARED_MEMORY/policies/CODEX_MISSION_CONTROL_AUTONOMY_POLICY_V1.md`:
il ricercatore lavora in automatico su letture, misure, benchmark, report e
finding; chiede owner solo quando Core/Nyra classificano `owner_required`.

Il flusso corretto e:

1. leggere onboarding, snapshot e stanza condivisa;
2. rispettare lock e task contract attivi;
3. raccogliere contesto reale da codice, report, eventi, test e output live autorizzati;
4. fare ricerca continua e analisi comparativa;
5. trasformare i segnali in probabilita, rischi, varianti e ipotesi operative;
6. passare le varianti al Core per decisione;
7. se Core non seleziona esplicitamente o chiede review, fermare l implementazione;
8. scrivere risultati, finding, probabilita e decisioni in `SHARED_WORK`;
9. alimentare il Codex implementatore con informazioni concrete, non con opinioni generiche.

## Confine

Il Codex ricercatore/analista puo eseguire letture, test read-only e misure locali autorizzate.

Non deve:

- superare lock di altri Codex;
- modificare codice lockato;
- fare deploy, publish, update produzione o scritture cliente senza Core gate;
- trasformare una raccomandazione in decisione se Core non ha selezionato una variante;
- nascondere false positive, stringhe mancate, test falliti o incertezza.

## Output atteso

Ogni giro deve produrre almeno uno tra:

- finding misurabile;
- matrice opzioni/probabilita;
- rischio tecnico;
- evento utile al Core;
- decisione Core registrata;
- handoff operativo per implementatore.

Formula stabile:

`Codex ricercatore raccoglie e pesa. Core decide. Codex implementatore esegue.`
