# Nyra Policy Registry

## Obiettivo

Il registry separa l'interpretazione elastica di Nyra dall'autorita di Universal Core.
Nyra puo trovare o proporre un percorso di policy; Core puo soltanto valutarne uno
snapshot immutabile e verificato.

```text
Core invariants
└── global
    └── sector
        └── tenant / company
            └── environment
                └── work type
                    └── action
                        └── policy
                            └── ... ulteriori nodi logici
```

Il catalogo non ha un tetto statico di profondita. La lettura runtime ha sempre un
budget esplicito (predefinito 256 nodi, massimo 4096), rileva cicli e ancestry
incompleta e fallisce in chiuso. Questo rende l'albero estensibile senza trasformare
la ricorsione in una superficie DoS.

## Ciclo di vita

1. Nyra individua il ramo o apre una proposta DTT `candidate`.
2. La ricerca collega claim brevi a fonti HTTPS primarie.
3. La pipeline valida schema, tenant, ancestry, test ALLOW/DENY, expiry e provenance.
4. Il diff separa restrizioni compatibili da nuove capability.
5. Un ampliamento richiede owner proof request-bound e receipt Core `ALLOW`.
6. Il pack completo, incluso lo stato di lifecycle, viene firmato separatamente
   da issuer Core e Nyra con chiavi indipendenti; la verifica richiede entrambi i
   ruoli e il digest reale. Un pack `compiled_core` vale solo se il suo digest è
   presente nel trust manifest bootstrap.
7. Core compila uno snapshot appiattito e immutabile, poi canary o attivazione.
8. Status, scadenza e regressioni possono innescare quarantine o rollback.

Nyra, DTT e agenti non hanno una funzione di attivazione. La funzione
`assessPolicyCandidate` produce soltanto `ready_for_activation` e dichiara
esplicitamente `activation_performed: false`. Receipt Core e owner proof passano
da un consumer atomico iniettato dal control plane: firma, tenant, digest candidato,
azione, scadenza e consumo monouso Core+owner nella stessa transazione devono
coincidere; semplici booleani sono
rifiutati. Anche lo snapshot parent deve avere un'attestazione Core valida e
corrispondere esattamente ai `parent_refs` del candidato.

## Precedenza e conflitti

- invarianti Core prima di ogni overlay;
- ogni leaf e ogni percorso parent è compilabile solo se raggiunge lo stesso pack
  `compiled_core` attestato;
- i figli possono restringere, non rimuovere un deny ereditato;
- gli allow si intersecano, i deny e i gate obbligatori si uniscono;
- nessun allow esplicito significa `DENY`;
- un deny prevale su un allow;
- un allow list vuoto in modalita `restrict` nega tutto; `inherit` e una scelta
  esplicita riservata ai pack che aggiungono soltanto invarianti;
- qualunque diagnostica, schema incompatibile, pack scaduto, firma non valida,
  ancestry incompleta o replay cross-tenant produce `DENY`.
- i binding Core/Nyra/domain-pack si intersecano; un'intersezione vuota o una
  valutazione da un ramo diverso viene negata.

Il wrapper Core e intenzionalmente piu severo di Cedar: Cedar espone gli errori
nelle diagnostics ma li salta durante la decisione; qui una diagnostics non vuota
nega l'azione.

## Aggiornamenti

Possono essere automatizzati soltanto:

- aggiornamento di evidenza e freschezza delle fonti;
- aggiunta di una restrizione compatibile;
- quarantine alla scadenza.

Richiedono sempre un nuovo gate:

- nuova capability o ampliamento di scope;
- attivazione, promozione, rollback;
- cambio di schema o trust anchor;
- trasferimento tra tenant o ambienti.

## Fonti primarie visitabili da Nyra

Il catalogo macchina si trova in `NYRA_POLICY_PRIMARY_SOURCES`, esportato da
`src/nyraPolicyRegistry.js`.

- OPA Bundles: https://www.openpolicyagent.org/docs/management-bundles
- OPA Discovery: https://www.openpolicyagent.org/docs/management-discovery
- OPA Status: https://www.openpolicyagent.org/docs/management-status
- Cedar authorization: https://docs.cedarpolicy.com/auth/authorization.html
- Cedar validation: https://docs.cedarpolicy.com/policies/validation.html
- NIST SP 800-207: https://csrc.nist.gov/pubs/sp/800/207/final
- NIST SP 800-207A: https://csrc.nist.gov/pubs/sp/800/207/a/final
- NIST SP 800-162: https://csrc.nist.gov/pubs/sp/800/162/upd2/final
- NIST AI RMF Core: https://airc.nist.gov/airmf-resources/airmf/5-sec-core/
- SLSA Provenance: https://slsa.dev/spec/v1.2/provenance
- SLSA Verification Summary: https://slsa.dev/spec/v1.2/verification_summary
- in-toto Attestation Framework: https://github.com/in-toto/attestation/blob/main/spec/README.md
- SPIFFE concepts: https://spiffe.io/docs/latest/spiffe/concepts/
- SPIFFE Workload API: https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/
