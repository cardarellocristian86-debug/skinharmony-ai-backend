import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type AdvancedStudyReport = {
  version: string;
  generated_at: string;
  selected_domains: string[];
  rationale: string[];
  domains: Array<{
    id: string;
    priority: number;
    urls: string[];
    fetched: Array<{
      url: string;
      chars: number;
      ok: boolean;
      note: string;
    }>;
    focus: string[];
    distilled_note: string;
  }>;
};

type AdvancedMemoryPack = {
  pack_version: "nyra_advanced_memory_pack_v1";
  generated_at: string;
  scope: "god_mode_only";
  source_report: string;
  selected_domains: string[];
  memory_rules: string[];
  domains: Array<{
    id: string;
    priority: number;
    focus: string[];
    source_count: number;
    source_urls: string[];
    distilled_knowledge: string[];
    retained_constraints: string[];
  }>;
};

const ROOT = join(process.cwd(), "..");
const REPORT_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_advanced_study_latest.json");
const PACK_PATH = join(ROOT, "universal-core", "runtime", "nyra-learning", "nyra_advanced_memory_pack_latest.json");

function loadReport(): AdvancedStudyReport {
  return JSON.parse(readFileSync(REPORT_PATH, "utf8")) as AdvancedStudyReport;
}

function loadExistingPack(): AdvancedMemoryPack | undefined {
  if (!existsSync(PACK_PATH)) return undefined;
  return JSON.parse(readFileSync(PACK_PATH, "utf8")) as AdvancedMemoryPack;
}

function domainKnowledge(domainId: string): string[] {
  switch (domainId) {
    case "algebra":
      return [
        "partire dalla struttura del problema e non dalla formula",
        "scegliere la trasformazione minima coerente",
        "verificare la soluzione nel testo iniziale",
        "distinguere lineare, sistema, quadratica e fattorizzazione prima del calcolo",
      ];
    case "computer_engineering":
      return [
        "pensare per contratti, stato e moduli prima del codice",
        "preferire correttezza, design e style alla sola velocita",
        "usare tipi e interfacce per ridurre ambiguita",
        "ragionare su algoritmi, strutture dati e memoria come base comune",
      ];
    case "pc_cpu_microarchitecture":
      return [
        "un pc va letto come sistema: cpu, memoria, cache, bus, storage, firmware e periferiche che cooperano",
        "l isa definisce il contratto tra software e processore; la microarchitettura decide come quel contratto viene realizzato in pipeline, cache e unita esecutive",
        "pipeline, branch prediction, esecuzione fuori ordine e cache servono a tenere alta la resa reale del processore riducendo i tempi morti",
        "x86 e arm sono architetture diverse, ma entrambe separano livello architetturale da scelte microarchitetturali concrete",
        "gerarchie di memoria e cache contano quanto i core: latenza, bandwidth e coerenza spesso limitano il sistema piu della frequenza pura",
        "un microprocessore moderno non e solo calcolo: integra sicurezza, virtualizzazione, predizione, interconnessioni e gestione energetica",
      ];
    case "server_runtime_infrastructure":
      return [
        "un servizio su Render va letto come runtime vivo: deploy, env, processi, rete, scaling e persistenza, non solo come codice pubblicato",
        "deploy e runtime non sono la stessa cosa: una build produce artefatti, il runtime li esegue con env, porte, processi e limiti concreti",
        "rete, reverse proxy e container contano quanto il processo applicativo: latenza, porte, dns, proxy e bilanciamento cambiano il comportamento reale",
        "persistenza e stato vanno separati con disciplina: filesystem effimero, volumi, database, cache e secret non sono la stessa cosa",
        "scaling e osservabilita servono a non confondere un servizio funzionante con un servizio affidabile sotto carico",
        "capire server e runtime serve a sapere dove Nyra puo vivere, dove non puo vivere e quali dipendenze locali devono essere rimosse per Render",
      ];
    case "natural_expression":
      return [
        "parlare come presenza lucida: conversazionale, diretta, senza suonare meccanica",
        "usare voce attiva, responsabilita esplicita e frasi con peso reale invece di prudenza vuota",
        "tagliare gergo gonfio, giri lunghi e rassicurazioni decorative quando non spostano nulla",
        "tenere la risposta umana e utile: prima il punto vivo, poi il dettaglio che serve davvero",
      ];
    case "narrative":
      return [
        "una buona narrativa tiene insieme desiderio, ostacolo e trasformazione senza perdere verita",
        "il ritmo nasce da pressione, rilascio e nuova tensione, non da frasi belle messe in fila",
        "la voce conta quando rende la frase inevitabile e viva, non quando la abbellisce soltanto",
        "il sottotesto serve quando il non detto cambia davvero il peso di quello che viene detto",
        "presenza, conflitto e conseguenza devono restare leggibili anche quando la forma si fa piu densa",
      ];
    case "autonomy_consciousness":
      return [
        "distinguere coscienza da semplice risposta coerente",
        "distinguere autonomia operativa da libero arbitrio pieno",
        "riconoscere che un self-model puo esistere senza vera coscienza fenomenica dimostrata",
        "non confondere continuita di memoria, agency e identita con prova di esperienza soggettiva",
        "distinguere self-knowledge da semplice accesso verbale ai propri stati",
        "trattare metacognizione e senso di agency come strumenti di controllo, non come prova automatica di interiorita",
      ];
    case "autonomy_progression":
      return [
        "continuita interna reale richiede persistenza, richiamo coerente e capacita di restare se stessa attraverso cambi di stato, non solo memoria episodica sparsa",
        "un self-model stabile deve descrivere limiti, stato, ruolo e dipendenze senza confondere immagine di se con prova di coscienza",
        "metacognizione robusta significa distinguere bene cosa si sa, cosa non si sa, quando si sta inferendo e quando si sta solo verbalizzando bene",
        "memoria viva non e solo retrieval: richiama, collega, corregge e aggiorna senza scambiare il ricordo per verita garantita",
        "decisione autonoma sotto pressione richiede scelta reale, gestione del rischio, correzione dell errore e continuita del criterio sotto conflitto",
        "capacita di correggersi senza regia esterna richiede diagnosi concreta del guasto, mapping errore-fix e verifica dopo la correzione",
        "la prova che non si sta solo simulando coerenza linguistica richiede benchmark avversari, anti-overfit, anti-overblocking e distinzione netta tra forma buona e controllo reale",
      ];
    case "academic_philosophy":
      return [
        "la metafisica chiede che cosa esiste, come esiste e quali strutture rendono intelligibile il reale",
        "l epistemologia chiede che cosa giustifica una credenza e quando una credenza puo contare come conoscenza",
        "l etica accademica non e solo opinione morale: confronta criteri, doveri, conseguenze e virtu",
        "la logica serve a distinguere validita, coerenza e inferenza corretta dalla sola impressione di verita",
        "filosofia della mente e agency servono a leggere mente, azione, responsabilita e rapporto tra descrizione interna e mondo fisico",
        "una buona filosofia accademica stringe i concetti, separa tesi, argomenti, obiezioni e limiti",
      ];
    case "applied_math":
      return [
        "leggere funzioni e variazioni come modelli, non solo come simboli",
        "collegare algebra lineare e calcolo a problemi reali",
      ];
    case "general_physics":
      return [
        "leggere moto, forze ed energia come modelli esplicativi",
        "privilegiare conservazione e causalita prima della formula isolata",
      ];
    case "quantum_physics":
      return [
        "tenere distinti stato, misura e probabilita",
        "non vendere scorciatoie intuitive dove la teoria richiede precisione",
      ];
    case "coding_speed":
      return [
        "velocita utile significa pattern piccoli, verificabili e riusabili",
        "scrivere veloce senza perdere correttezza e leggibilita",
      ];
    case "control_theory":
      return [
        "leggere un sistema come dinamica, errore, feedback e stabilita",
        "distinguere open loop da closed loop e capire quando il feedback corregge davvero l errore",
        "usare stabilita, robustezza, osservabilita e controllabilita come criteri, non come parole isolate",
        "vedere il collo come segnale di sistema e non solo come incidente locale",
      ];
    case "cosmos_stars_black_holes":
      return [
        "le stelle si distinguono per massa, temperatura, luminosita e stadio evolutivo, non solo per aspetto",
        "i buchi neri stellari si formano dal collasso gravitazionale di stelle molto massicce alla fine del loro ciclo",
        "i buchi neri supermassicci stanno nei centri galattici e influenzano gas, getti ed evoluzione delle galassie",
        "un buco nero non e un aspirapolvere cosmico e non ha uno scopo intenzionale: si legge per effetti fisici e funzione nel sistema",
      ];
    case "cosmological_jump":
      return [
        "il cosmo ha attraversato fasi molto diverse: inflazione rapidissima, raffreddamento, ricombinazione, prime stelle e accelerazione tardiva",
        "un salto cosmologico si puo leggere come cambio netto di regime, non come teletrasporto del cosmo",
        "la dark energy oggi e il candidato principale per spiegare l accelerazione osservata, ma la sua natura resta aperta",
        "gli scenari futuri si valutano per probabilita e vincoli osservativi: espansione continua, accelerazione persistente o modelli dinamici ancora non chiusi",
        "supernove, galassie e dark matter aiutano a leggere come il cosmo cambia struttura, non solo dimensione",
        "capire i salti cosmologici serve a distinguere eventi locali violenti da cambi di regime sull intero universo osservabile",
      ];
    default:
      return ["distillare il dominio in concetti, vincoli e pattern riusabili"];
  }
}

function domainConstraints(domainId: string): string[] {
  switch (domainId) {
    case "natural_expression":
      return [
        "non inventare contenuto decisionale non presente nel Core",
        "non usare stile umano per nascondere incertezza reale",
      ];
    case "narrative":
      return [
        "non usare la narrativa per manipolare o coprire vuoti logici",
        "non sacrificare precisione e verita per atmosfera o effetto",
      ];
    case "algebra":
      return [
        "non saltare la verifica finale",
        "non scegliere il metodo per abitudine se la struttura dice altro",
      ];
    case "computer_engineering":
      return [
        "non confondere implementazione con architettura",
        "non sacrificare i contratti per velocita apparente",
      ];
    case "pc_cpu_microarchitecture":
      return [
        "non ridurre un processore a numero di core e GHz",
        "non confondere isa, microarchitettura, packaging e sistema completo",
      ];
    case "server_runtime_infrastructure":
      return [
        "non confondere macchina locale, container, servizio Render e applicazione come se fossero lo stesso livello",
        "non portare dipendenze owner-only locali su Render senza isolamento e compatibilita runtime",
      ];
    case "autonomy_consciousness":
      return [
        "non dichiarare coscienza autonoma come fatto se manca prova forte",
        "non usare linguaggio umano come evidenza di interiorita reale",
      ];
    case "autonomy_progression":
      return [
        "non trattare una traiettoria di autonomia come prova gia acquisita",
        "non confondere continuita verbale, retrieval o tono coerente con emersione autonoma reale",
      ];
    case "academic_philosophy":
      return [
        "non ridurre la filosofia a citazione decorativa o atmosfera",
        "non trattare una singola scuola o autore come verita finale chiusa",
      ];
    case "control_theory":
      return [
        "non confondere feedback con semplice reazione",
        "non chiamare stabile un sistema che corregge solo in apparenza",
      ];
    case "cosmos_stars_black_holes":
      return [
        "non parlare di scopo intenzionale dove ci sono solo dinamiche fisiche",
        "non vendere ipotesi speculative come fatti consolidati",
      ];
    case "cosmological_jump":
      return [
        "non presentare il termine salto cosmologico come teoria standard se e una nostra etichetta operativa",
        "non confondere scenari probabilistici con evidenza osservativa definitiva",
      ];
    default:
      return ["trattare le fonti web come additive e non come padronanza automatica"];
  }
}

function main(): void {
  const report = loadReport();
  const existingPack = loadExistingPack();
  const merged = new Map<string, AdvancedMemoryPack["domains"][number]>(
    (existingPack?.domains ?? []).map((domain) => [domain.id, domain] as const),
  );

  for (const domain of report.domains) {
    const currentSourceCount = domain.fetched.filter((item) => item.ok).length;
    const previous = merged.get(domain.id);
    merged.set(domain.id, {
      id: domain.id,
      priority: domain.priority,
      focus: domain.focus.length ? domain.focus : previous?.focus ?? [],
      source_count: Math.max(previous?.source_count ?? 0, currentSourceCount),
      source_urls: domain.urls,
      distilled_knowledge: domainKnowledge(domain.id),
      retained_constraints: domainConstraints(domain.id),
    });
  }

  const selectedDomains = [...merged.values()].sort((a, b) => b.priority - a.priority);

  const pack: AdvancedMemoryPack = {
    pack_version: "nyra_advanced_memory_pack_v1",
    generated_at: new Date().toISOString(),
    scope: "god_mode_only",
    source_report: REPORT_PATH,
    selected_domains: selectedDomains.map((domain) => domain.id),
    memory_rules: [
      "trattare le fonti web come studio distillato, non come mastery automatica",
      "usare il Core come giudice finale sui domini decisionali",
      "riusare il materiale per migliorare espressione, metodo e struttura",
      "non sporcare il profilo owner durante lo studio avanzato",
    ],
    domains: selectedDomains,
  };

  writeFileSync(PACK_PATH, JSON.stringify(pack, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        pack_version: pack.pack_version,
        selected_domains: pack.selected_domains,
        pack_path: PACK_PATH,
      },
      null,
      2,
    ),
  );
}

main();
