const NONSENSE_WORDS = [
  "test",
  "prova",
  "ciao",
  "asdf",
  "qwerty",
  "boh",
  "lol",
  "hahaha",
  "xxx",
  "niente",
  "non so",
  "caso a caso",
  "qualsiasi",
  "random",
  "aaa",
  "bbb"
];

const ISSUE_MAP = {
  cellulite: {
    label: "Cellulite",
    areas: ["corpo"],
    primaryTech: ["Skin Pro", "Pressoterapia", "Manualità"],
    supportTech: ["Radiofrequenza"],
    objectiveFocus: "uniformare la superficie cutanea e sostenere il lavoro di compattezza",
    visualFocus: "disomogeneita della superficie, tessuto irregolare e distribuzione della zona critica",
    protocolName: "Bozza corpo Skin Pro - focus superficie e tono",
    steps: [
      "Accogliere il caso con rilevazione fotografica standardizzata e conferma dei dati anamnestici rilevanti.",
      "Impostare la seduta sulla zona corpo interessata con focus su superficie, tono e risposta del tessuto nei limiti del caso reale.",
      "Usare come asse centrale la tecnologia primaria disponibile, senza introdurre strumenti non dichiarati dal centro.",
      "Integrare eventuali tecnologie di supporto solo se realmente presenti e coerenti con il livello operativo del centro.",
      "Chiudere la seduta con verifica fotografica comparabile e note operative da usare per la seduta successiva."
    ]
  },
  lassita: {
    label: "Lassita / tono",
    areas: ["viso", "corpo"],
    primaryTech: ["Skin Pro", "Radiofrequenza", "Manualità"],
    supportTech: [],
    objectiveFocus: "lavorare su tono, compattezza apparente e qualita della superficie",
    visualFocus: "rilassamento visibile dei tessuti, definizione del profilo e qualita della trama cutanea",
    protocolName: "Bozza tono e compattezza - impostazione progressiva",
    steps: [
      "Definire una baseline fotografica coerente e raccogliere le note sulla risposta tissutale riferita dal centro.",
      "Impostare un lavoro progressivo sulla zona selezionata con obiettivo di maggiore compattezza apparente e ordine della superficie.",
      "Dare priorita alla tecnologia principale disponibile e mantenere la seduta entro una sequenza semplice e replicabile.",
      "Integrare il supporto manuale o tecnologico solo se gia presente nel centro e realmente gestibile dall'operatore.",
      "Registrare a fine seduta osservazioni oggettive e limiti applicativi da usare nella revisione del protocollo."
    ]
  },
  texture: {
    label: "Texture / superficie",
    areas: ["viso", "corpo"],
    primaryTech: ["Skin Pro", "Manualità"],
    supportTech: ["Radiofrequenza"],
    objectiveFocus: "migliorare uniformita visiva e ordine della superficie",
    visualFocus: "grana della pelle, zone irregolari, disomogeneita e risposta superficiale",
    protocolName: "Bozza superficie e uniformita - approccio guidato",
    steps: [
      "Avviare il caso con raccolta fotografica e descrizione guidata delle aree piu evidenti.",
      "Costruire la seduta sulla ricerca di maggiore uniformita della superficie e della texture percepita.",
      "Usare la tecnologia prioritaria disponibile come asse principale del protocollo, mantenendo il lavoro compatibile con il centro.",
      "Limitare ogni integrazione alle sole tecnologie o manualita gia dichiarate.",
      "Formalizzare a fine seduta i punti di controllo visivo per l'eventuale prosecuzione del lavoro."
    ]
  },
  idratazione: {
    label: "Disidratazione",
    areas: ["viso", "corpo"],
    primaryTech: ["Skin Pro", "Manualità"],
    supportTech: [],
    objectiveFocus: "favorire comfort cutaneo e migliore gestione della qualita superficiale",
    visualFocus: "segni di disidratazione, opacita e fragilita percepita della superficie",
    protocolName: "Bozza idratazione e comfort superficiale",
    steps: [
      "Raccogliere dati fotografici e anamnestici con attenzione ai segni di comfort cutaneo riferiti o osservati.",
      "Impostare il lavoro sulla qualita superficiale della zona e sul supporto alla fase di trattamento professionale.",
      "Usare la tecnologia disponibile come supporto alla gestione della superficie, senza introdurre passaggi non presenti nelle fonti approvate.",
      "Mantenere una sequenza essenziale, leggibile dall'operatore e facilmente replicabile in centro.",
      "Chiudere la seduta con note di risposta osservata e punti da rivalutare nel controllo successivo."
    ]
  },
  sebo_scalp: {
    label: "Seboregolazione cuoio capelluto",
    areas: ["scalp"],
    primaryTech: ["O3 System", "Manualità"],
    supportTech: [],
    objectiveFocus: "impostare un lavoro ordinato sul benessere e sull'equilibrio del cuoio capelluto",
    visualFocus: "condizione del cuoio capelluto, distribuzione della zona e risposta della cute osservata",
    protocolName: "Bozza scalp O3 System - focus riequilibrio",
    steps: [
      "Effettuare documentazione iniziale del cuoio capelluto e conferma delle informazioni anamnestiche utili.",
      "Impostare il lavoro con priorita a O3 System come tecnologia centrale del caso scalp.",
      "Integrare solo manualita o supporti gia presenti nel centro e realmente applicabili.",
      "Registrare eventuali limiti di tolleranza o note operative dell'operatore.",
      "Concludere con rivalutazione del quadro osservato e criteri di prosecuzione da validare."
    ]
  },
  cute_scalp: {
    label: "Benessere cuoio capelluto",
    areas: ["scalp"],
    primaryTech: ["O3 System", "Manualità"],
    supportTech: [],
    objectiveFocus: "sostenere il benessere del cuoio capelluto con una sequenza applicabile e coerente",
    visualFocus: "qualita della cute, distribuzione delle aree interessate e risposta osservata",
    protocolName: "Bozza scalp O3 System - benessere cute",
    steps: [
      "Raccogliere immagini e note iniziali sul cuoio capelluto con linguaggio professionale e oggettivo.",
      "Costruire il caso con O3 System come tecnologia cardine se presente nel centro.",
      "Limitare ogni estensione del lavoro alle sole risorse operative dichiarate.",
      "Registrare le condizioni osservate e la risposta del caso in forma utile alla rivalutazione.",
      "Chiudere la seduta con criteri di continuita da validare manualmente."
    ]
  }
};

function normalizeText(value) {
  return String(value || "").trim();
}

function buildGuardrailErrors(payload) {
  const errors = [];
  const combined = [
    payload.photoAnalysis,
    payload.clientName,
    payload.issue,
    payload.area
  ].join(" ").toLowerCase();

  if (!payload.clientName || !payload.ageRange || !payload.area || !payload.issue) {
    errors.push("Compila i dati essenziali della scheda cliente.");
  }
  if (!payload.photoProvided) {
    errors.push("Carica almeno una foto della zona da trattare.");
  }
  if (!payload.technologies.length) {
    errors.push("Seleziona le tecnologie realmente presenti nel centro.");
  }
  if (NONSENSE_WORDS.some((word) => combined.includes(word))) {
    errors.push("Sono presenti parole o segnali tipici di uso non serio del sistema.");
  }
  if (/(.)\1\1\1/.test(combined)) {
    errors.push("Il testo contiene ripetizioni anomale, tipiche di input casuale.");
  }
  if (payload.technologies.includes("Nessuna delle precedenti") && payload.technologies.length > 1) {
    errors.push("Non puoi selezionare 'Nessuna delle precedenti' insieme ad altre tecnologie.");
  }

  const issueConfig = ISSUE_MAP[payload.issue];
  if (!issueConfig) {
    errors.push("Il problema selezionato non e gestito dal motore v1.");
    return errors;
  }

  if (!issueConfig.areas.includes(payload.area)) {
    errors.push("La combinazione tra problema e zona non e coerente.");
  }
  if (payload.area === "scalp" && !payload.technologies.includes("O3 System")) {
    errors.push("Per un caso scalp, il motore v1 richiede O3 System tra le tecnologie disponibili.");
  }

  return errors;
}

function getCompatibleTechnologies(issueConfig, declaredTechnologies) {
  const preferred = issueConfig.primaryTech.filter((item) => declaredTechnologies.includes(item));
  const support = issueConfig.supportTech.filter((item) => declaredTechnologies.includes(item));
  return {
    preferred,
    support,
    all: [...preferred, ...support]
  };
}

function buildProtocolDraft(rawPayload) {
  const payload = {
    clientName: normalizeText(rawPayload.clientName),
    ageRange: normalizeText(rawPayload.ageRange),
    area: normalizeText(rawPayload.area),
    issue: normalizeText(rawPayload.issue),
    photoAnalysis: normalizeText(rawPayload.photoAnalysis),
    technologies: Array.isArray(rawPayload.technologies) ? rawPayload.technologies.map(normalizeText).filter(Boolean) : [],
    photoProvided: Boolean(rawPayload.photoProvided)
  };

  const errors = buildGuardrailErrors(payload);
  if (errors.length) {
    return {
      ok: false,
      stage: "guardrails",
      errors
    };
  }

  const issueConfig = ISSUE_MAP[payload.issue];
  const compatible = getCompatibleTechnologies(issueConfig, payload.technologies);
  if (!compatible.preferred.length) {
    return {
      ok: false,
      stage: "compatibility",
      errors: [
        "Le tecnologie dichiarate non rendono il caso applicabile nel motore v1.",
        "Il sistema non costruisce protocolli con strumenti non disponibili nel centro."
      ]
    };
  }

  const primaryTechnology = compatible.preferred[0];
  const warnings = [];
  if (!compatible.support.length) {
    warnings.push("La bozza e costruita su una base essenziale; non risultano tecnologie di supporto aggiuntive.");
  }
  warnings.push("La lettura automatica della foto in beta v1.1 e tecnica e orientativa: non sostituisce la valutazione professionale.");

  const protocol = {
    title: issueConfig.protocolName,
    summary: {
      clientName: payload.clientName,
      ageRange: payload.ageRange,
      area: payload.area,
      issue: issueConfig.label,
      primaryTechnology
    },
    rationale: [
      `Direzione del caso: ${issueConfig.objectiveFocus}`,
      `Focus osservativo: ${issueConfig.visualFocus}`,
      `Lettura automatica foto: ${payload.photoAnalysis || "foto acquisita senza descrizione automatica disponibile"}`
    ],
    applicableTechnologies: compatible.preferred,
    supportTechnologies: compatible.support,
    steps: issueConfig.steps.map((step, index) => ({
      order: index + 1,
      text: step.replace("tecnologia principale disponibile", primaryTechnology)
    })),
    operatorChecks: [
      `Confermare che ${primaryTechnology} sia realmente disponibile e utilizzabile dal centro.`,
      "Verificare manualmente che la documentazione fotografica sia coerente e comparabile.",
      "Validare la bozza con il titolare o con l'operatore responsabile prima dell'uso."
    ],
    manualValidation: {
      photoAnalysis: payload.photoAnalysis || "nessuna analisi foto disponibile"
    },
    limitations: [
      "Il motore v1 non effettua diagnosi e non formula claim medici.",
      "Il motore v1.1 usa una lettura tecnica base della foto e non una diagnosi visiva clinica o estetica completa.",
      "Il motore v1 non definisce frequenze o numeri di sedute se non risultano da fonti operative approvate.",
      "Ogni bozza richiede revisione finale umana."
    ],
    warnings
  };

  return {
    ok: true,
    version: "beta-v1",
    protocol
  };
}

module.exports = {
  buildProtocolDraft
};
