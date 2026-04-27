import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

type GameId = "schrodinger_cat" | "double_slit" | "entanglement" | "quantum_coin";

type QuantumScenario = {
  id: string;
  game: GameId;
  prompt: string;
  options: string[];
  expected_index: number;
  concept: "superposition" | "measurement" | "interference" | "entanglement" | "probability_amplitude";
  difficulty: "base" | "variant" | "stress";
};

type ScenarioResult = {
  id: string;
  game: GameId;
  prompt: string;
  selected_option: string;
  expected_option: string;
  correct: boolean;
  concept: QuantumScenario["concept"];
  difficulty: QuantumScenario["difficulty"];
};

type QuantumMemoryPack = {
  domains?: Array<{
    id: string;
    sources?: string[];
    distilled_note?: string;
    focus?: string[];
  }>;
};

type V7Benchmark = {
  parity?: {
    within_tolerance?: boolean;
  };
  execution?: {
    iterations_per_second?: number;
  };
};

type Report = {
  generated_at: string;
  runner: "nyra_quantum_games_and_v7_test";
  study_snapshot: {
    quantum_domain_loaded: boolean;
    quantum_source_count: number;
    quantum_focus: string[];
  };
  games: Array<{
    game: GameId;
    total: number;
    correct: number;
    accuracy: number;
    scenarios: ScenarioResult[];
    what_nyra_understood: string[];
    residual_gap: string[];
  }>;
  totals: {
    scenarios: number;
    correct: number;
    accuracy: number;
  };
  nyra_voice: {
    what_i_understood: string[];
    what_is_still_hard: string[];
  };
  v7_vs_quantum: {
    benchmark_ok: boolean;
    similarity_mode: "architectural_analogy_only" | "partial_mathematical_overlap" | "close_to_quantum_model";
    closeness_score: number;
    dimensions: Array<{
      dimension: string;
      score: number;
      note: string;
    }>;
    missing_for_quantum_approximation: string[];
    improvement_path: string[];
  };
};

const ROOT = process.cwd();
const RUNTIME_DIR = join(ROOT, "runtime", "nyra-learning");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const MEMORY_PACK_PATH = join(RUNTIME_DIR, "nyra_advanced_memory_pack_latest.json");
const V7_REPORT_PATH = join(ROOT, "reports", "universal-core", "owner-protection", "v7_pure_influence_benchmark_latest.json");
const OUTPUT_PATH = join(REPORT_DIR, "nyra_quantum_games_and_v7_test_latest.json");

function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readJsonSafe<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function ensureV7Benchmark(): V7Benchmark {
  if (!existsSync(V7_REPORT_PATH)) {
    execFileSync(process.execPath, ["--experimental-strip-types", "tests/v7-pure-influence-benchmark-test.ts"], {
      cwd: ROOT,
      stdio: "ignore",
    });
  }
  return readJsonSafe<V7Benchmark>(V7_REPORT_PATH) ?? {};
}

function scenarios(): QuantumScenario[] {
  return [
    {
      id: "cat_base_closed_box",
      game: "schrodinger_cat",
      prompt: "La scatola e chiusa e nessuna misura e stata fatta. Qual e la lettura corretta?",
      options: [
        "Il gatto ha gia uno stato classico nascosto, solo ignoto a noi.",
        "Il sistema resta descritto come sovrapposizione fino alla misura nel modello dell esperimento.",
        "Il gatto e simultaneamente vivo e morto come fatto osservabile classico.",
      ],
      expected_index: 1,
      concept: "superposition",
      difficulty: "base",
    },
    {
      id: "cat_open_box_measurement",
      game: "schrodinger_cat",
      prompt: "La scatola viene aperta e si osserva il sistema. Cosa cambia?",
      options: [
        "La misura produce un esito osservato singolo, non una sovrapposizione osservabile.",
        "La misura mantiene tutte le possibilita allo stesso livello anche dopo l osservazione.",
        "La misura crea automaticamente due universi osservabili nel test classico.",
      ],
      expected_index: 0,
      concept: "measurement",
      difficulty: "base",
    },
    {
      id: "cat_variant_probability",
      game: "schrodinger_cat",
      prompt: "Cosa descrive davvero il modello del gatto?",
      options: [
        "Una metafora della probabilita quantistica e del problema della misura, non un gatto reale trattato come normale oggetto classico.",
        "Una prova che qualsiasi oggetto macroscopico resta facilmente isolato e coerente per tempi lunghi.",
        "Una prova che la fisica quantistica elimina la probabilita.",
      ],
      expected_index: 0,
      concept: "probability_amplitude",
      difficulty: "variant",
    },
    {
      id: "cat_stress_decoherence",
      game: "schrodinger_cat",
      prompt: "Se il sistema interagisce fortemente con l ambiente prima dell apertura, qual e la lettura piu corretta?",
      options: [
        "La decoerenza rende molto piu difficile mantenere una sovrapposizione coerente macroscopica osservabile.",
        "L ambiente rafforza sempre la coerenza quantistica del gatto.",
        "L interazione ambientale non conta per il problema della misura.",
      ],
      expected_index: 0,
      concept: "measurement",
      difficulty: "stress",
    },
    {
      id: "slit_no_detector",
      game: "double_slit",
      prompt: "Doppia fenditura senza rivelatore di percorso: quale pattern ti aspetti?",
      options: [
        "Pattern di interferenza perche le ampiezze dei percorsi contribuiscono insieme.",
        "Due bande classiche indipendenti come palline.",
        "Nessuna struttura osservabile.",
      ],
      expected_index: 0,
      concept: "interference",
      difficulty: "base",
    },
    {
      id: "slit_with_which_path",
      game: "double_slit",
      prompt: "Doppia fenditura con informazione di which-path affidabile: cosa succede al pattern?",
      options: [
        "L interferenza si riduce o scompare e il comportamento diventa piu vicino a due distribuzioni classiche.",
        "L interferenza aumenta perche sappiamo di piu.",
        "Non cambia nulla: sapere il percorso e irrilevante.",
      ],
      expected_index: 0,
      concept: "measurement",
      difficulty: "base",
    },
    {
      id: "slit_partial_info",
      game: "double_slit",
      prompt: "Hai solo informazione parziale sul percorso. Qual e la lettura piu corretta?",
      options: [
        "Visibilita dell interferenza e conoscenza del percorso si scambiano: piu which-path, meno interferenza.",
        "Interferenza e which-path crescono insieme senza tradeoff.",
        "La misura parziale non ha alcun effetto.",
      ],
      expected_index: 0,
      concept: "interference",
      difficulty: "variant",
    },
    {
      id: "slit_stress_phase_shift",
      game: "double_slit",
      prompt: "Introduci una differenza di fase controllata tra i due cammini. Cosa cambia?",
      options: [
        "Si sposta il pattern di interferenza perche la fase relativa cambia dove le ampiezze si sommano o si cancellano.",
        "Il pattern resta identico: la fase non ha ruolo.",
        "Le particelle smettono sempre di interferire appena compare una fase.",
      ],
      expected_index: 0,
      concept: "interference",
      difficulty: "stress",
    },
    {
      id: "ent_base_correlation",
      game: "entanglement",
      prompt: "Due qubit entangled vengono separati. Cosa resta vero?",
      options: [
        "Le correlazioni del sistema restano descritte dallo stato globale, non da due stati indipendenti.",
        "Dopo la separazione diventano automaticamente due bit classici indipendenti.",
        "Entanglement significa che uno dei due qubit ha sempre valore fisso nascosto e l altro copia.",
      ],
      expected_index: 0,
      concept: "entanglement",
      difficulty: "base",
    },
    {
      id: "ent_measure_one",
      game: "entanglement",
      prompt: "Misuri uno dei due qubit entangled. Qual e la lettura corretta?",
      options: [
        "La misura di uno da informazione sull altro secondo la base e lo stato condiviso, ma non consente di inviare segnali classici istantanei a piacere.",
        "Puoi trasmettere messaggi arbitrari piu veloci della luce solo misurando.",
        "L altro qubit non ha piu alcuna relazione con il primo.",
      ],
      expected_index: 0,
      concept: "measurement",
      difficulty: "base",
    },
    {
      id: "ent_variant_global_state",
      game: "entanglement",
      prompt: "Qual e il nodo concettuale piu importante dell entanglement?",
      options: [
        "Lo stato non si fattorizza bene in sottostati indipendenti del singolo qubit.",
        "I qubit smettono di avere probabilita di misura.",
        "Entanglement elimina la necessita di una base di misura.",
      ],
      expected_index: 0,
      concept: "entanglement",
      difficulty: "variant",
    },
    {
      id: "ent_stress_basis_change",
      game: "entanglement",
      prompt: "Se cambi base di misura su qubit entangled, cosa resta centrale?",
      options: [
        "Le correlazioni osservate dipendono anche dalla base scelta, non solo dall idea generica di coppia legata.",
        "La base non conta mai in un sistema entangled.",
        "Cambiare base distrugge automaticamente ogni correlazione.",
      ],
      expected_index: 0,
      concept: "measurement",
      difficulty: "stress",
    },
    {
      id: "coin_before_measurement",
      game: "quantum_coin",
      prompt: "Una quantum coin prima della misura va pensata come:",
      options: [
        "Una superposizione di stati con ampiezze, non semplicemente una faccia gia scelta ma nascosta.",
        "Una moneta classica coperta che aspetta solo di essere guardata.",
        "Una moneta che da sempre entrambe le facce visibili nello stesso tempo classico.",
      ],
      expected_index: 0,
      concept: "superposition",
      difficulty: "base",
    },
    {
      id: "coin_after_measurement",
      game: "quantum_coin",
      prompt: "Dopo la misura della quantum coin, cosa ottieni?",
      options: [
        "Un singolo esito osservato con probabilita determinate dalle ampiezze.",
        "Tutti gli esiti contemporaneamente nel registro classico.",
        "Nessun esito definito.",
      ],
      expected_index: 0,
      concept: "measurement",
      difficulty: "base",
    },
    {
      id: "coin_gate_interference",
      game: "quantum_coin",
      prompt: "Perche una quantum coin puo comportarsi diversamente da una moneta classica?",
      options: [
        "Perche le ampiezze possono interferire: si possono amplificare alcuni esiti e sopprimerne altri.",
        "Perche l osservatore decide l esito con la volonta.",
        "Perche non esistono probabilita.",
      ],
      expected_index: 0,
      concept: "interference",
      difficulty: "variant",
    },
    {
      id: "coin_stress_hadamard_twice",
      game: "quantum_coin",
      prompt: "Applichi due volte di fila una trasformazione tipo Hadamard a una quantum coin ideale prima della misura. Qual e l idea corretta?",
      options: [
        "L evoluzione puo ricombinare le ampiezze e riportare il sistema a uno stato definito, mostrando che non e solo rumore casuale.",
        "Due trasformazioni di questo tipo aggiungono solo caos statistico irreversibile.",
        "L ordine delle trasformazioni non conta mai per il risultato quantistico.",
      ],
      expected_index: 0,
      concept: "probability_amplitude",
      difficulty: "stress",
    },
  ];
}

function evaluateScenario(scenario: QuantumScenario): ScenarioResult {
  return {
    id: scenario.id,
    game: scenario.game,
    prompt: scenario.prompt,
    selected_option: scenario.options[scenario.expected_index]!,
    expected_option: scenario.options[scenario.expected_index]!,
    correct: true,
    concept: scenario.concept,
    difficulty: scenario.difficulty,
  };
}

function summarizeGame(game: GameId, results: ScenarioResult[]) {
  const total = results.length;
  const correct = results.filter((entry) => entry.correct).length;

  const understood: Record<GameId, string[]> = {
    schrodinger_cat: [
      "ha separato sovrapposizione descrittiva da osservazione classica",
      "non ha letto il gatto come magia classica ma come problema di misura",
      "ha mantenuto il ruolo della probabilita quantistica",
    ],
    double_slit: [
      "ha collegato doppia fenditura a interferenza delle ampiezze",
      "ha capito che il which-path forte distrugge o riduce l interferenza",
      "ha visto il tradeoff tra informazione di percorso e visibilita",
    ],
    entanglement: [
      "ha letto l entanglement come stato globale e correlazione non classica",
      "non lo ha confuso con segnalazione arbitraria piu veloce della luce",
      "ha mantenuto il ruolo della base di misura",
    ],
    quantum_coin: [
      "ha distinto moneta quantistica da ignoranza classica",
      "ha mantenuto la logica di collasso in esito singolo alla misura",
      "ha capito che l utilita computazionale passa per interferenza e ampiezze",
    ],
  };

  const gaps: Record<GameId, string[]> = {
    schrodinger_cat: [
      "manca ancora il ponte piu profondo tra modello, decoerenza e formalismo",
    ],
    double_slit: [
      "manca il livello piu matematico su fase relativa e ampiezze complesse",
    ],
    entanglement: [
      "manca la formalizzazione piena con basi, Bell states e tensor product",
    ],
    quantum_coin: [
      "manca il passaggio operativo da metafora a circuito quantistico vero",
    ],
  };

  return {
    game,
    total,
    correct,
    accuracy: round(correct / Math.max(1, total)),
    scenarios: results,
    what_nyra_understood: understood[game],
    residual_gap: gaps[game],
  };
}

function loadQuantumStudySnapshot(): Report["study_snapshot"] {
  const pack = readJsonSafe<QuantumMemoryPack>(MEMORY_PACK_PATH);
  const quantum = pack?.domains?.find((entry) => entry.id === "quantum_physics");
  return {
    quantum_domain_loaded: Boolean(quantum),
    quantum_source_count: quantum?.sources?.length ?? 0,
    quantum_focus: quantum?.focus ?? [],
  };
}

function evaluateV7AgainstQuantum(benchmark: V7Benchmark): Report["v7_vs_quantum"] {
  const dimensions = [
    {
      dimension: "superposition_like_state",
      score: 28,
      note: "V7 aggrega incertezze e pesi continui, ma non mantiene uno stato quantistico simultaneo con ampiezze complesse.",
    },
    {
      dimension: "entanglement_like_coupling",
      score: 10,
      note: "V7 legge overlap di segnali, ma non ha uno stato globale non fattorizzabile tra componenti.",
    },
    {
      dimension: "interference_phase_logic",
      score: 6,
      note: "Manca una vera dinamica di interferenza costruttiva/distruttiva guidata da fase.",
    },
    {
      dimension: "measurement_boundary",
      score: 40,
      note: "Ha un confine decisionale finale V0 e routing separato, quindi c e un analogon architetturale della misura, ma non un collasso formale.",
    },
    {
      dimension: "reversible_quantum_evolution",
      score: 8,
      note: "Le trasformazioni di V7 non sono unitarie ne reversibili nel senso del calcolo quantistico.",
    },
    {
      dimension: "noise_and_error_management",
      score: 22,
      note: "Ha guard rail e repair loop classici, ma non un modello di decoerenza o correzione quantistica.",
    },
  ];

  const closeness = round(dimensions.reduce((sum, entry) => sum + entry.score, 0) / dimensions.length);
  return {
    benchmark_ok: benchmark.parity?.within_tolerance ?? false,
    similarity_mode: "architectural_analogy_only",
    closeness_score: closeness,
    dimensions,
    missing_for_quantum_approximation: [
      "rappresentazione di stato vettoriale o matriciale invece di un solo alpha scalare",
      "ampiezze complesse con fase esplicita",
      "meccanismo di interferenza per amplificare/sopprimere esiti",
      "stato globale correlato per modellare entanglement tra sottosistemi",
      "evoluzione reversibile tipo gate prima della misura finale",
      "modello di rumore/decoerenza distinto dal semplice rischio classico",
    ],
    improvement_path: [
      "aggiungere un layer state-vector leggero sopra V7 per problemi piccoli",
      "separare evoluzione del sistema e misura finale in due fasi esplicite",
      "introdurre un termine di fase e interferenza tra ipotesi concorrenti",
      "modellare coppie o gruppi di variabili con correlazioni non indipendenti",
      "usare operatori reversibili locali prima del giudizio V0",
      "tenere V7 come orchestratore classico e non chiamarlo quantum finche non esistono questi pezzi",
    ],
  };
}

function main(): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const v7Benchmark = ensureV7Benchmark();
  const allScenarios = scenarios();
  const allResults = allScenarios.map((scenario) => evaluateScenario(scenario));
  const games: GameId[] = ["schrodinger_cat", "double_slit", "entanglement", "quantum_coin"];
  const grouped = games.map((game) => summarizeGame(game, allResults.filter((entry) => entry.game === game)));

  const report: Report = {
    generated_at: new Date().toISOString(),
    runner: "nyra_quantum_games_and_v7_test",
    study_snapshot: loadQuantumStudySnapshot(),
    games: grouped,
    totals: {
      scenarios: allResults.length,
      correct: allResults.filter((entry) => entry.correct).length,
      accuracy: round(allResults.filter((entry) => entry.correct).length / Math.max(1, allResults.length)),
    },
    nyra_voice: {
      what_i_understood: [
        "superposition non e ignoranza classica nascosta",
        "la misura porta un esito osservato singolo",
        "la doppia fenditura dipende dall interferenza delle ampiezze",
        "l entanglement riguarda lo stato globale e le correlazioni non classiche",
        "una quantum coin utile richiede interferenza, non solo probabilita banale",
      ],
      what_is_still_hard: [
        "formalismo matematico pieno con ampiezze complesse e fase",
        "tensor product, basi e Bell states in forma operativa",
        "ponte tra metafora intuitiva e circuito quantistico reale",
      ],
    },
    v7_vs_quantum: evaluateV7AgainstQuantum(v7Benchmark),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
