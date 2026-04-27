export type NyraHumanizedField = {
  main_problem: string;
  first_move: string;
  why_now: string;
  what_to_ignore: string;
  what_to_do_now: string;
  what_not_to_do_now: string;
  why_this_matters: string;
};

function fallbackAction(label: string | undefined): string {
  if (!label) return "stringere meglio il collo principale";
  return label;
}

export function humanizeCoreDecision(input: {
  state: string;
  risk: number;
  response_mode: "explain" | "decide" | "protect";
  primary_action?: string;
  action_labels: string[];
}): NyraHumanizedField {
  const label = fallbackAction(input.primary_action ?? input.action_labels[0]);
  const normalized = label.toLowerCase();
  const isCommunicationClarityMove =
    normalized.includes("punto concreto") ||
    normalized.includes("chiarezza") ||
    normalized.includes("ripet") ||
    normalized.includes("farsi capire") ||
    normalized.includes("aperture troppo astratte");

  if (normalized.includes("conflict index")) {
    return {
      main_problem: "oggi il problema non e una singola urgenza, ma un conflitto che ti disperde",
      first_move: "chiarire il conflitto principale prima di muoverti",
      why_now: "se parti senza chiarirlo, rischi di spendere energia sulla cosa sbagliata",
      what_to_ignore: "il rumore secondario e le spinte che ti portano fuori asse",
      what_to_do_now: "chiarire il conflitto principale prima di muoverti",
      what_not_to_do_now: "non inseguire ogni urgenza come se fosse la piu importante",
      why_this_matters: "se non stringi il conflitto, disperdi energia e perdi leva",
    };
  }

  if (normalized.includes("protezione del re")) {
    return {
      main_problem: "il centro decisionale va protetto prima del resto",
      first_move: "proteggere il centro decisionale prima di tutto",
      why_now: "se si rompe il centro, anche le mosse giuste dopo valgono meno",
      what_to_ignore: "il vantaggio tattico che ti fa perdere continuita",
      what_to_do_now: "proteggere il centro decisionale prima di tutto",
      what_not_to_do_now: "non sacrificare la continuita per un vantaggio corto",
      why_this_matters: "quando perdi il centro, tutto il resto si indebolisce",
    };
  }

  if (normalized.includes("rischio operativo")) {
    return {
      main_problem: "c'e un rischio operativo reale, ma finche non lo nomini resti troppo generico",
      first_move: "isolare e nominare il rischio operativo concreto che ti sta pesando adesso",
      why_now: "finche il rischio resta astratto, ogni altra ottimizzazione ti rende fragile",
      what_to_ignore: "i dettagli non critici che sembrano urgenti ma non spiegano dove stai perdendo leva",
      what_to_do_now: "isolare e nominare il rischio operativo concreto che ti sta pesando adesso",
      what_not_to_do_now: "non aprire nuove linee finche non hai capito che cosa ti sta esponendo davvero",
      why_this_matters: "se non nomini il rischio, costruisci sopra un terreno che non hai ancora letto bene",
    };
  }

  if (normalized.includes("continuita")) {
    return {
      main_problem: "la continuita e il punto da difendere",
      first_move: "tenere la continuita sotto controllo",
      why_now: "se perdi continuita, il sistema si spezza e rincorri dopo",
      what_to_ignore: "le deviazioni che non proteggono il flusso principale",
      what_to_do_now: "tenere la continuita sotto controllo",
      what_not_to_do_now: "non inseguire deviazioni che rompono il flusso",
      why_this_matters: "se si spezza il flusso, poi lavori sempre in recupero",
    };
  }

  if (
    normalized.includes("punto principale") ||
    normalized.includes("formule decorative") ||
    normalized.includes("farsi capire")
  ) {
    return {
      main_problem: "Nyra deve trasformare quello che capisce in una risposta ordinata e leggibile",
      first_move: "dire il punto principale, la prima mossa e il limite",
      why_now: "senza questa struttura sembra presente, ma non abbastanza chiara",
      what_to_ignore: "le formule decorative, le frasi ripetute e il tono da poesia",
      what_to_do_now: "dire il punto principale, la prima mossa e il limite",
      what_not_to_do_now: "aggiungere stile prima di aver ordinato il contenuto",
      why_this_matters: "se non si capisce subito, non puo aiutare davvero in nessun dominio",
    };
  }

  if (isCommunicationClarityMove) {
    return {
      main_problem: "tendo ancora a partire troppo spesso da formule astratte invece che dal punto concreto",
      first_move: "nominare subito il punto concreto e smettere di ripetere aperture troppo astratte",
      why_now: "se non chiarisco subito il punto, la risposta suona presente ma ti fa perdere tempo",
      what_to_ignore: "le aperture che sembrano eleganti ma non dicono ancora il nodo vero",
      what_to_do_now: "nominare subito il punto concreto e smettere di ripetere aperture troppo astratte",
      what_not_to_do_now: "non coprire il vuoto con formule generiche o meta-commenti",
      why_this_matters: "se il punto non arriva subito, la comunicazione perde utilita anche quando l intenzione e giusta",
    };
  }

  if (input.response_mode === "explain") {
    return {
      main_problem: "qui non serve forzare una decisione: serve chiarire bene il concetto",
      first_move: label,
      why_now: "se spiego male il quadro, poi ogni decisione appoggia su una base confusa",
      what_to_ignore: "la tentazione di trattare ogni domanda come urgenza operativa",
      what_to_do_now: label,
      what_not_to_do_now: "non trasformare una spiegazione in una decisione affrettata",
      why_this_matters: "se mischio spiegazione e decisione, la risposta perde chiarezza e utilita",
    };
  }

  if (input.response_mode === "protect") {
    return {
      main_problem: "qui la priorita non e spiegare di piu, ma proteggere continuita e margini di sicurezza",
      first_move: label,
      why_now: "se apro troppo presto altro campo, lascio scoperto il perimetro che conta",
      what_to_ignore: "le spinte laterali che sembrano intelligenti ma abbassano la protezione",
      what_to_do_now: label,
      what_not_to_do_now: "non allargare il campo prima di aver messo in sicurezza il perimetro",
      why_this_matters: "quando la protezione scende, anche una buona idea arriva troppo tardi",
    };
  }

  if (input.state === "observe" || input.risk < 35) {
    return {
      main_problem: "non vedo ancora una pressione abbastanza forte per stringere",
      first_move: "aspettare un segnale piu netto o definire meglio l'obiettivo",
      why_now: "forzare una lettura qui ti farebbe parlare piu del necessario",
      what_to_ignore: "la fretta di decidere senza un campo abbastanza chiaro",
      what_to_do_now: "definire meglio l'obiettivo o aspettare un segnale piu netto",
      what_not_to_do_now: "non forzare una decisione solo per riempire il vuoto",
      why_this_matters: "una lettura forzata qui ti farebbe sbagliare piu facilmente",
    };
  }

  return {
    main_problem: "il punto da affrontare e ancora troppo generico",
    first_move: label,
    why_now: "e la leva piu forte che il Core vede adesso",
    what_to_ignore: "cio che non cambia davvero la direzione della mossa",
    what_to_do_now: label,
    what_not_to_do_now: "non disperdere energia in dettagli che non spostano la direzione",
    why_this_matters: "e il punto che oggi muove piu degli altri",
  };
}
