const SKINHARMONY_LIBRARY_CENTER_ID = "__skinharmony_library";
const SKINHARMONY_LIBRARY_CENTER_NAME = "SkinHarmony Protocol Library";

const safeAvoidClaims = [
  "Non promettere risultati garantiti.",
  "Non usare linguaggio medico, clinico o terapeutico.",
  "Non dichiarare cura, guarigione, dimagrimento garantito, ricrescita o effetti dermatologici.",
  "Confermare sempre consenso, scheda cliente e valutazione professionale prima del percorso."
].join("\n");

const skinHarmonyProtocolLibrary = [
  {
    id: "sh-protocol-face-luminosity-skinpro",
    title: "Viso luminosita progressiva Skin Pro",
    objective: "Migliorare luminosita percepita, uniformita estetica e qualita visiva della pelle.",
    area: "Viso",
    targetArea: "viso",
    needType: "luminosita",
    caseIntensity: "lieve",
    sessionsCount: 4,
    frequency: "1 seduta ogni 7/10 giorni, review dopo la seconda seduta.",
    technologies: "Skin Pro",
    products: "Supporto cosmetico da scegliere in base alla scheda cliente e alla disponibilita del centro.",
    steps: [
      "1. Foto iniziale se autorizzata e verifica sensibilita.",
      "2. Preparazione delicata della pelle.",
      "3. Fase centrale con Skin Pro orientata a luminosita e qualita estetica.",
      "4. Chiusura con prodotto coerente e nota operativa sulla risposta della pelle."
    ].join("\n"),
    clientCommunication: "Impostiamo un lavoro progressivo sulla qualita visiva della pelle, verificando seduta dopo seduta come risponde.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-protocol-face-tone-skinpro",
    title: "Viso tono e compattezza progressiva",
    objective: "Lavorare su tono, compattezza percepita e definizione estetica progressiva.",
    area: "Viso",
    targetArea: "viso",
    needType: "tono",
    caseIntensity: "media",
    sessionsCount: 6,
    frequency: "1 seduta a settimana, review dopo la terza seduta.",
    technologies: "Skin Pro, manualita professionale se disponibile",
    products: "Supporto cosmetico elasticizzante o nutriente se presente nel centro.",
    steps: [
      "1. Confronto fotografico iniziale e obiettivo realistico.",
      "2. Preparazione pelle e controllo zone piu sensibili.",
      "3. Fase centrale con Skin Pro o tecnologia disponibile per lavoro progressivo.",
      "4. Registrazione risposta e pianificazione richiamo."
    ].join("\n"),
    clientCommunication: "Il percorso lavora in modo graduale su tono e compattezza apparente, senza promesse immediate.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-protocol-face-texture-skinpro",
    title: "Viso grana e texture irregolare",
    objective: "Supportare una pelle visivamente piu uniforme e ordinata nel percorso estetico.",
    area: "Viso",
    targetArea: "viso",
    needType: "texture",
    caseIntensity: "media",
    sessionsCount: 5,
    frequency: "1 seduta ogni 10 giorni, review dopo la terza seduta.",
    technologies: "Skin Pro",
    products: "Cosmetico lenitivo o riequilibrante secondo scheda cliente.",
    steps: [
      "1. Valutazione visiva delle zone non uniformi.",
      "2. Preparazione conservativa e controllo tollerabilita.",
      "3. Trattamento centrale con focus su uniformita estetica.",
      "4. Nota finale su percezione cliente e prossima seduta."
    ].join("\n"),
    clientCommunication: "Lavoriamo sull'aspetto della superficie cutanea con un percorso progressivo e controllato.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-protocol-face-sensitive-basic",
    title: "Viso sensibilita percepita e riequilibrio estetico",
    objective: "Impostare un percorso prudente per pelle percepita sensibile o reattiva.",
    area: "Viso",
    targetArea: "viso",
    needType: "sensibilita",
    caseIntensity: "media",
    sessionsCount: 3,
    frequency: "1 seduta ogni 10/14 giorni, rivalutazione continua.",
    technologies: "Tecnologia centrale solo se tollerata, altrimenti manualita e cosmetico.",
    products: "Supporto cosmetico delicato se disponibile.",
    steps: [
      "1. Verifica scheda cliente, trattamenti recenti e sensibilita dichiarata.",
      "2. Seduta breve e prudente, senza sovraccaricare la pelle.",
      "3. Registrazione risposta immediata e percezione cliente.",
      "4. Aumento progressivo solo se la risposta e coerente."
    ].join("\n"),
    clientCommunication: "Partiamo con un lavoro prudente per capire come risponde la pelle e costruire il percorso con sicurezza.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-protocol-face-maintenance",
    title: "Viso mantenimento qualita pelle",
    objective: "Mantenere qualita estetica, continuita e controllo nel tempo.",
    area: "Viso",
    targetArea: "viso",
    needType: "mantenimento",
    caseIntensity: "lieve",
    sessionsCount: 4,
    frequency: "1 seduta ogni 21/30 giorni.",
    technologies: "Skin Pro o tecnologia viso disponibile nel centro.",
    products: "Prodotti di mantenimento se coerenti con scheda cliente.",
    steps: [
      "1. Check iniziale rispetto alla visita precedente.",
      "2. Seduta di mantenimento non aggressiva.",
      "3. Aggiornamento note, prodotti e richiamo.",
      "4. Programmazione controllo successivo."
    ].join("\n"),
    clientCommunication: "L'obiettivo e mantenere continuita e qualita nel tempo, senza ripartire ogni volta da zero.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-protocol-body-retention-thermo",
    title: "Corpo ritenzione percepita e calore controllato",
    objective: "Supportare comfort, leggerezza percepita e qualita dell'esperienza corpo.",
    area: "Corpo",
    targetArea: "corpo",
    needType: "ritenzione",
    caseIntensity: "media",
    sessionsCount: 6,
    frequency: "1 seduta a settimana, review dopo la terza seduta.",
    technologies: "Termosauna, manualita se disponibile",
    products: "Supporto corpo se presente e coerente con scheda cliente.",
    steps: [
      "1. Verifica condizioni generali, comfort e consenso.",
      "2. Fase calore controllato con durata prudente.",
      "3. Supporto manuale o cosmetico se disponibile.",
      "4. Nota su percezione cliente e richiamo."
    ].join("\n"),
    clientCommunication: "Impostiamo un percorso corpo orientato a comfort, continuita e sensazione di leggerezza percepita.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-protocol-body-cellulite-aesthetic",
    title: "Corpo aspetto buccia d'arancia estetico",
    objective: "Lavorare sull'aspetto estetico della superficie corpo con progressione controllata.",
    area: "Corpo",
    targetArea: "corpo",
    needType: "cellulite estetica",
    caseIntensity: "media",
    sessionsCount: 8,
    frequency: "1 seduta a settimana, review dopo la quarta seduta.",
    technologies: "Termosauna, tecnologia corpo disponibile",
    products: "Supporto cosmetico corpo se presente.",
    steps: [
      "1. Foto iniziale solo con consenso e luce coerente.",
      "2. Fase centrale su area dichiarata senza promesse.",
      "3. Supporto cosmetico o manuale se disponibile.",
      "4. Review fotografica intermedia e aggiornamento percorso."
    ].join("\n"),
    clientCommunication: "Lavoriamo sull'aspetto estetico della zona con un percorso misurabile e progressivo.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-protocol-body-tone",
    title: "Corpo tono e compattezza estetica",
    objective: "Supportare tono e compattezza percepita nelle zone corpo dichiarate.",
    area: "Corpo",
    targetArea: "corpo",
    needType: "tono",
    caseIntensity: "media",
    sessionsCount: 6,
    frequency: "1 seduta ogni 7/10 giorni.",
    technologies: "Tecnologia corpo disponibile, manualita professionale",
    products: "Cosmetico corpo tonificante se presente.",
    steps: [
      "1. Definizione zona e obiettivo realistico.",
      "2. Seduta centrale con intensita progressiva.",
      "3. Registrazione risposta e comfort cliente.",
      "4. Programmazione review dopo meta percorso."
    ].join("\n"),
    clientCommunication: "Il lavoro e progressivo e punta alla qualita estetica della zona, con controllo a meta percorso.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-protocol-body-relax-thermo",
    title: "Corpo relax e benessere con termosauna",
    objective: "Creare una seduta corpo orientata a relax, comfort e percezione premium.",
    area: "Corpo",
    targetArea: "corpo",
    needType: "relax",
    caseIntensity: "lieve",
    sessionsCount: 4,
    frequency: "1 seduta ogni 7/14 giorni.",
    technologies: "Termosauna",
    products: "Prodotti corpo sensoriali se disponibili.",
    steps: [
      "1. Verifica comfort, temperatura e preferenze.",
      "2. Fase termosauna con controllo costante.",
      "3. Chiusura sensoriale e consiglio mantenimento.",
      "4. Nota sulla percezione cliente."
    ].join("\n"),
    clientCommunication: "Questa seduta e pensata per un'esperienza corpo confortevole e premium.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-protocol-scalp-balance-o3",
    title: "Cute riequilibrio estetico O3 System",
    objective: "Supportare una cute piu ordinata nella percezione del trattamento professionale.",
    area: "Cuoio capelluto",
    targetArea: "scalp",
    needType: "riequilibrio cute",
    caseIntensity: "media",
    sessionsCount: 4,
    frequency: "1 seduta ogni 7/14 giorni, review dopo la seconda seduta.",
    technologies: "O3 System",
    products: "Prodotti cute professionali se presenti.",
    steps: [
      "1. Valutazione visiva cute e raccolta abitudini cliente.",
      "2. Preparazione area e trattamento O3 System secondo protocollo centro.",
      "3. Nota su comfort, percezione e risposta.",
      "4. Programmazione richiamo o mantenimento."
    ].join("\n"),
    clientCommunication: "Lavoriamo sulla qualita dell'esperienza cute e sul riequilibrio estetico percepito, senza promesse mediche.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-protocol-scalp-premium-o3",
    title: "Cute trattamento premium O3 System",
    objective: "Rendere il trattamento cute piu percepito, ordinato e valorizzabile in salone.",
    area: "Cuoio capelluto",
    targetArea: "scalp",
    needType: "premium cute",
    caseIntensity: "lieve",
    sessionsCount: 3,
    frequency: "1 seduta ogni 14 giorni o come mantenimento.",
    technologies: "O3 System",
    products: "Prodotti cute o finish coerenti con servizio hair.",
    steps: [
      "1. Spiegazione breve del valore della fase cute.",
      "2. Trattamento O3 System integrato al servizio hair.",
      "3. Chiusura con consiglio mantenimento.",
      "4. Nota in scheda cliente per prossima visita."
    ].join("\n"),
    clientCommunication: "Aggiungiamo una fase cute premium per migliorare la qualita percepita del servizio in salone.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-protocol-scalp-sensitive",
    title: "Cute sensibile percepita",
    objective: "Gestire un percorso cute prudente e controllato quando il cliente riferisce sensibilita.",
    area: "Cuoio capelluto",
    targetArea: "scalp",
    needType: "sensibilita cute",
    caseIntensity: "media",
    sessionsCount: 3,
    frequency: "1 seduta ogni 14 giorni, senza intensificare se la risposta non e chiara.",
    technologies: "O3 System solo se coerente con valutazione operatore.",
    products: "Prodotti delicati se disponibili.",
    steps: [
      "1. Verifica fastidi dichiarati e trattamenti recenti.",
      "2. Seduta breve e prudente.",
      "3. Registrazione risposta e comfort.",
      "4. Continuare solo se il cliente riferisce buona tollerabilita."
    ].join("\n"),
    clientCommunication: "Partiamo con prudenza e monitoriamo come percepisci il trattamento.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-module-photo-review",
    title: "Modulo controllo fotografico",
    objective: "Creare confronto visivo ordinato senza trasformarlo in promessa di risultato.",
    area: "Trasversale",
    targetArea: "",
    needType: "controllo fotografico",
    caseIntensity: "",
    sessionsCount: 0,
    frequency: "Foto iniziale e review a meta percorso se autorizzate.",
    technologies: "Non applicabile",
    products: "Non applicabile",
    steps: [
      "1. Chiedere consenso fotografico.",
      "2. Usare stessa luce, stessa distanza e stessa angolazione.",
      "3. Archiviare foto con data e zona.",
      "4. Usare il confronto solo come supporto di valutazione estetica."
    ].join("\n"),
    clientCommunication: "Useremo le foto solo per seguire il percorso in modo piu ordinato, se autorizzi.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-module-first-session",
    title: "Modulo prima seduta prudente",
    objective: "Avviare il percorso senza sovraccaricare il cliente o la zona trattata.",
    area: "Trasversale",
    targetArea: "",
    needType: "prima seduta",
    caseIntensity: "",
    sessionsCount: 1,
    frequency: "Da usare come prima seduta di ogni percorso non ancora validato.",
    technologies: "Tecnologia centrale scelta dal centro.",
    products: "Prodotti coerenti con scheda cliente.",
    steps: [
      "1. Raccogliere obiettivo e dati minimi.",
      "2. Impostare intensita prudente.",
      "3. Registrare risposta e sensazioni.",
      "4. Decidere aumento o mantenimento solo dalla seduta successiva."
    ].join("\n"),
    clientCommunication: "La prima seduta serve anche a capire come risponde la zona e costruire il percorso corretto.",
    avoidClaims: safeAvoidClaims
  },
  {
    id: "sh-module-maintenance",
    title: "Modulo mantenimento percorso",
    objective: "Dare continuita al risultato percepito e alla relazione con il cliente.",
    area: "Trasversale",
    targetArea: "",
    needType: "mantenimento",
    caseIntensity: "",
    sessionsCount: 4,
    frequency: "Richiamo ogni 21/45 giorni in base al caso.",
    technologies: "Tecnologia coerente con percorso iniziale.",
    products: "Prodotti di mantenimento se presenti.",
    steps: [
      "1. Check rispetto alla seduta precedente.",
      "2. Seduta piu breve o meno intensa.",
      "3. Aggiornamento scheda.",
      "4. Richiamo programmato."
    ].join("\n"),
    clientCommunication: "Il mantenimento evita di lavorare solo quando il problema e gia percepito.",
    avoidClaims: safeAvoidClaims
  }
].map((protocol) => ({
  ...protocol,
  centerId: SKINHARMONY_LIBRARY_CENTER_ID,
  centerName: SKINHARMONY_LIBRARY_CENTER_NAME,
  clientId: "",
  clientName: "",
  libraryScope: "skinharmony",
  operatorNotes: "Protocollo SkinHarmony beta. Da validare dall'operatore prima dell'uso.",
  limitations: "Protocollo operativo estetico non medico. Nessuna diagnosi, cura o risultato garantito.",
  source: "skinharmony_library",
  status: "active"
}));

module.exports = {
  SKINHARMONY_LIBRARY_CENTER_ID,
  SKINHARMONY_LIBRARY_CENTER_NAME,
  skinHarmonyProtocolLibrary
};
