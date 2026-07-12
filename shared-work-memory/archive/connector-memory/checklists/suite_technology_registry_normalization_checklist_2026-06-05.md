# Suite Technology Registry Normalization Checklist

Aggiornato: 2026-06-05

Scope: riallineare `Magazzino Tecnologie`, publish script e flussi CRM/WooCommerce a una sola anagrafica tecnologia.

Legenda:
- `[ ]` aperto
- `[/]` parziale
- `[x]` chiuso

## 1. Regola SSOT
- [x] Fissare che `Technology Registry` è la source of truth delle tecnologie.
- [x] Fissare che `Product Registry` resta dedicato ai prodotti reali e non deve più ricevere nuove tecnologie duplicate.
- [x] Fissare che CRM / Company Cockpit leggono le tecnologie dal registry anche quando il listino ufficiale non è ancora disponibile.

## 2. Suite Plugin
- [x] Aggiungere route governate `GET/POST` per `technology-inventory`.
- [x] Permettere tecnologie `registry-only` senza listino ufficiale, senza inventare prezzi.
- [x] Permettere attivazione WooCommerce dalla tecnologia master quando il prezzo ufficiale esiste.
- [ ] Valutare una successiva UI esplicita di disattivazione Woo dalla stessa tecnologia master.

## 3. Publish Script
- [x] Fermare l'upsert automatico tecnologie -> `product-inventory`.
- [x] Scrivere le nuove tecnologie nel `technology-inventory/upsert`.
- [x] Mantenere il passaggio automatico al CRM attraverso il catalogo tecnologie.

## 4. Migrazione Dati Esistenti
- [x] Mappare tutte le tecnologie nuove oggi presenti nel `Product Registry` ma non nel `Technology Registry`.
- [x] Creare/migrare le anagrafiche mancanti nel `Technology Registry` senza inventare listini.
- [/] Verificare per ogni tecnologia se il prezzo ufficiale esiste o resta `quote-only`.
- [x] Solo dopo migrazione verificata, archiviare le righe duplicate `reserved` dal `Product Registry`.

## 5. Verifica
- [/] Verificare localmente `Magazzino Tecnologie` con grafica/setup allineati a `Magazzino Prodotti`.
- [x] Verificare live via audit che `Product Registry` non contenga piu duplicati tecnologia e che `Technology Registry` conti anche le 8 nuove anagrafiche `price pending`.
- [x] Verificare localmente route REST, test plugin e Program Registry.
- [x] Aggiornare `EVENTS.jsonl` e snapshot se cambia lo stato operativo reale.
