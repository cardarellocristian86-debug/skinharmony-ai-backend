# Nyra Office Artifact Intelligence V1

## Obiettivo

La prima famiglia e dedicata alla produzione governata di pitch, documenti Word, presentazioni PowerPoint,
workbook Excel, grafici e immagini destinati a Microsoft 365. Il futuro Social Cortex resta fuori scope.

Nyra pianifica, scrive, supervisiona e propone correzioni. Universal Core resta l'autorita su accesso a
Microsoft 365, condivisione, sovrascrittura, pubblicazione e consegna esterna.

## Rami

### `office_artifact_intelligence`

Orchestra brief, audience, purpose, pitch, testo umanizzato, fonti, documenti lunghi, Word, PowerPoint,
Excel, grafici, immagini, accessibilita, interoperabilita Microsoft 365 e packaging finale.

### `typography_layout_guard`

Ramo orizzontale cross-formato. Controlla token tipografici, geometria, densita, tabelle, grafici,
immagini, paginazione, overflow, sovrapposizioni, pagine vuote, reading order e regressioni di render.

### `human_tone_intelligence`

Ramo orizzontale condiviso da Office Artifact Cortex, Translate Manager e Site Suite. Rende il testo piu
naturale in funzione di audience, superficie, brand e locale, ma conserva significato, numeri, claim,
incertezza, token protetti e azione richiesta. Non simula esperienze umane e non elude detector AI.
Un PASS richiede verifica semantica indipendente legata ai digest esatti di sorgente e candidato.

### Rami riutilizzati

- `lexical_semantic_intelligence`: significato, ambiguita, coerenza terminologica e provenance.
- `marketing_copy`: pitch e copy commerciale senza claim inventati.
- `ramo_testo`: grammatica, tono, brand voice e publish safety.
- `human_tone_intelligence`: naturalezza meaning-locked riutilizzata da traduzioni, siti e documenti.
- `translation_governance` e `content_localization_guard`: cataloghi atomici e traduzioni governate.
- `research_evidence_intelligence`: fonti e claim graph.
- `quality_verification_intelligence`: acceptance, negative path e verifica indipendente.
- `decision_provenance_intelligence`: revisione, decisioni, responsabilita e reversal.

## Problemi AI verificati e contromisure

| Problema | Evidenza o osservazione | Contromisura V1 |
|---|---|---|
| Perdita di informazioni nei lavori lunghi | I modelli possono recuperare peggio informazioni collocate nel mezzo di contesti lunghi. | Outline versionata, budget per sezione, ledger di fatti/claim/termini/decisioni e checkpoint ogni 1-25 unita. |
| Documento o deck incompleto | Un conteggio di file/slide non dimostra che ogni unita sia popolata e corretta. | Inventario esatto, corrispondenza budget-sezione, render di tutte le unita e blocco su pagine vuote/semivuote. |
| Testo tagliato, overflow e sovrapposizioni | Parsing e metadati non rilevano difetti della resa finale. | Render visuale e verifica a dimensione leggibile di ogni pagina/slide/foglio; nuovo render dopo ogni correzione. |
| Grafici errati o decorativi | Etichette, unita, range e valori possono divergere dalla sorgente. | Digest della sorgente, range dati, riconciliazione valori, titolo/assi/legenda, label leggibili e alt text. |
| Reading order incoerente | L'ordine visuale e quello letto dalle tecnologie assistive possono divergere. | Audit reading order, grouping logico e alt text per ogni oggetto informativo. |
| Immagini distorte, sfocate o mal tagliate | Un asset corretto puo essere degradato dal crop o dal layout; il testo generato nell'immagine puo essere corrotto. | Provenance/licenza, rapporto d'aspetto, crop, risoluzione, bounding box, controllo OCR/visuale e divieto di riuso immotivato. |
| Testi generici o artificiali | La riscrittura puo cambiare tono, claim o certezza invece di rendere il testo naturale. | Il ramo `humanized_copy` varia ritmo e leggibilita ma preserva fatti, claim, incertezza, voce e terminologia. |
| Output AI considerato definitivo | Microsoft indica che i contenuti generati devono essere revisionati e possono essere inaccurati o non pertinenti. | Stato advisory, verifica indipendente e conferma owner; nessun auto-share o auto-publish. |
| Limiti Microsoft 365/API | Licenze, permessi, formati e limiti di trasferimento differiscono tra Graph, Excel REST e Office Scripts. | Capability discovery, identita tenant-scoped, least privilege, batching e fallback locale; nessuna promessa di feature non disponibile. |

## Contratto per lavori fino a 200 unita

`buildOfficeArtifactPlan` accetta da 1 a 200 pagine, slide o fogli. La somma dei budget di sezione deve
corrispondere esattamente al totale. Ogni checkpoint lega il lavoro a:

- plan digest e source revision digest;
- facts, claims, terminology e decisions digest;
- domande ancora aperte;
- sezioni completate.

La qualita viene derivata da evidence indipendente. Il chiamante non puo imporre `PASS` o
`release_eligible`. `evaluateOfficeArtifactQuality` blocca almeno:

- piano o sorgente stale;
- self-verification o riuso di sessione;
- unita mancanti, duplicate, vuote o non renderizzate;
- clipping, overflow, overlap e placeholder;
- sezione con budget incompleto;
- grafico non riconciliato o immagine senza provenance;
- checkpoint mancante o contraddizione di contesto;
- formula error e totali non riconciliati nei workbook;
- approvazione basata su campionamento anziche inventario completo.

## Microsoft 365

Il runtime locale produce e verifica OOXML (`.docx`, `.pptx`, `.xlsx`) prima dell'eventuale trasferimento.
L'integrazione cloud puo usare Microsoft Graph/OneDrive/SharePoint ed Excel REST solo dopo autenticazione,
consenso, tenant binding e scope minimi. Office Scripts richiede capability e limiti riletti dal runtime.

V1 non presume che un abbonamento Microsoft 365 includa automaticamente Copilot, Designer, Graph write,
Office Scripts o Power Automate. La disponibilita viene rilevata e registrata; in assenza, Nyra produce il
file verificato localmente e propone il caricamento manuale.

## Fonti primarie

- Microsoft Graph overview: https://learn.microsoft.com/en-us/graph/overview
- Excel REST in Microsoft Graph: https://learn.microsoft.com/en-us/graph/api/resources/excel?view=graph-rest-1.0
- Office Scripts platform limits: https://learn.microsoft.com/en-us/office/dev/scripts/testing/platform-limits
- Microsoft PowerPoint Copilot FAQ: https://support.microsoft.com/en-us/office/frequently-asked-questions-about-copilot-in-powerpoint-3e229188-9086-4f4c-9f9f-824cd25ae84f
- PowerPoint reading order: https://support.microsoft.com/en-us/office/make-slides-easier-to-read-by-using-the-reading-order-pane-863b5c1c-4f19-45ec-96e6-93a6457f5e1c
- Word accessibility: https://support.microsoft.com/en-us/accessibility/word/make-your-word-documents-accessible-to-people-with-disabilities
- Excel accessible charts: https://support.microsoft.com/en-us/excel/accessibility/video-create-more-accessible-charts-in-excel
- Lost in the Middle: https://arxiv.org/abs/2307.03172

## Rollout

1. Registry e motore deterministico in test locale.
2. Adapter locali Word/PowerPoint/Excel con render e receipt verificati.
3. Microsoft 365 capability discovery in read-only.
4. Upload di una copia in area sandbox con owner confirmation.
5. Solo dopo evidenza operativa, eventuale condivisione governata.

Il Social Cortex verra progettato separatamente per evitare che calendario editoriale, canali,
pubblicazione e metriche social contaminino l'autorita dei materiali Office.
