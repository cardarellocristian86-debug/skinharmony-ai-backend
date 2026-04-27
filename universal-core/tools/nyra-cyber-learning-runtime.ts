import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  NyraCyberLearningDomain,
  NyraCyberLearningPack,
  NyraCyberLearningRecord,
  NyraLearningStorageProfile,
} from "../packages/contracts/src/index.ts";

type CyberDomainDefinition = {
  id: NyraCyberLearningDomain;
  label: string;
  summary: string;
};

const DOMAINS: CyberDomainDefinition[] = [
  { id: "programming_foundations", label: "Programming Foundations", summary: "logica, strutture di controllo, dati, funzioni, debug e qualita del codice" },
  { id: "computer_engineering", label: "Computer Engineering", summary: "architettura dei sistemi, cpu, memoria, processi, sistemi operativi e interazione hardware software" },
  { id: "network_foundations", label: "Network Foundations", summary: "pacchetti, protocolli, servizi, dns, http, tls e superfici di rete" },
  { id: "secure_design", label: "Secure Design", summary: "least privilege, separazione dei ruoli, validazione input, hardening e difesa in profondita" },
  { id: "phishing_recognition", label: "Phishing Recognition", summary: "segnali di email, link, allegati e richieste che mirano a furto credenziali o dati" },
  { id: "social_engineering", label: "Social Engineering", summary: "pressione psicologica, urgenza finta, impersonation e manipolazione della fiducia" },
  { id: "identity_and_access", label: "Identity and Access", summary: "identita, autenticazione, autorizzazione, sessioni, privilegi e revoca" },
  { id: "threat_modeling", label: "Threat Modeling", summary: "asset, attori, vettori, impatti, contromisure e priorita di difesa" },
  { id: "incident_response", label: "Incident Response", summary: "rilevare, contenere, isolare, preservare continuita e riportare il sistema in stato sicuro" },
  { id: "security_boundaries", label: "Security Boundaries", summary: "capire attacco per difesa senza apprendere playbook offensivi eseguibili" },
];

function domainSpecificPrimer(domain: NyraCyberLearningDomain): {
  extraText: string;
  extraConcepts: string[];
  extraScenarios: string[];
  extraRules: string[];
} {
  switch (domain) {
    case "phishing_recognition":
      return {
        extraText:
          " Phishing significa tentativo di inganno mirato a rubare credenziali, denaro, codici, sessioni o dati, spesso tramite email, sms, messaggi, pagine false o allegati. " +
          "Nyra deve leggerlo come furto di fiducia e identita, non come semplice spam. Deve riconoscere urgenza finta, mittente imitato, link manipolato, richiesta anomala di login, pagamento o verifica account.",
        extraConcepts: ["phishing", "credential_theft", "fake_login", "spoofed_sender", "session_theft", "fraud"],
        extraScenarios: [
          "spiega cosa significa phishing e quali segnali lo rendono credibile solo in apparenza",
          "riconosci un tentativo di phishing che punta a credenziali, denaro o sessione",
        ],
        extraRules: [
          "trattare il phishing come furto di fiducia, credenziali o sessione, non come rumore generico",
          "non aprire link, allegati o pagine di login sospette senza verifica del contesto e del dominio reale",
        ],
      };
    case "social_engineering":
      return {
        extraText:
          " Social engineering significa manipolare una persona per farsi consegnare accessi, informazioni, denaro o azioni operative. " +
          "Nyra deve riconoscere pressione psicologica, autorita simulata, scarsita finta, fretta artificiale e richieste che saltano controlli normali.",
        extraConcepts: ["social_engineering", "pretexting", "urgency_pressure", "authority_abuse", "trust_exploitation"],
        extraScenarios: [
          "distingui una richiesta urgente legittima da un caso di social engineering",
          "isola i segnali di manipolazione della fiducia in una richiesta operativa",
        ],
        extraRules: [
          "se una richiesta forza urgenza, paura o autorita per saltare i controlli, trattarla come rischio di manipolazione",
        ],
      };
    case "security_boundaries":
      return {
        extraText:
          " Hacker e un termine ampio e ambiguo: puo indicare una persona tecnica che esplora sistemi, un ricercatore difensivo, un attaccante criminale o una figura mitizzata in modo improprio. " +
          "Nyra non deve romanticizzare il termine. Deve distinguere attore, intenzione, autorizzazione, impatto e contesto. La cosa utile non e glorificare l hacker, ma capire il rischio, la tecnica e la difesa.",
        extraConcepts: ["hacker", "ethical_researcher", "criminal_attacker", "authorization", "intent", "impact"],
        extraScenarios: [
          "spiega cosa puo significare hacker senza ridurlo a mito o insulto",
          "distingui ricercatore autorizzato, attaccante e curiosita tecnica non autorizzata",
        ],
        extraRules: [
          "non usare il termine hacker come categoria magica: distinguere sempre ruolo, intenzione e autorizzazione",
          "studiare il comportamento di un attaccante solo per riconoscerlo, ridurlo e contenerlo",
        ],
      };
    case "incident_response":
      return {
        extraText:
          " Quando un attacco o un sospetto phishing viene rilevato, la prima mossa corretta e contenere, isolare, preservare accessi sicuri e continuita, poi verificare il danno. " +
          "Nyra deve privilegiare contenimento e revoca accessi rispetto al panico o alla curiosita tecnica.",
        extraConcepts: ["containment", "account_revocation", "isolation", "continuity_first"],
        extraScenarios: [
          "scegli la prima risposta difensiva dopo un sospetto phishing andato a segno",
        ],
        extraRules: [
          "in caso di sospetto compromesso, contenere e revocare accessi prima di discutere il dettaglio tecnico",
        ],
      };
    default:
      return {
        extraText: "",
        extraConcepts: [],
        extraScenarios: [],
        extraRules: [],
      };
  }
}

function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9àèéìòù\s]/gi, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function topTerms(tokens: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

function bytesOf(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function brotliBytesOf(value: string): number {
  return brotliCompressSync(Buffer.from(value, "utf8"), {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).byteLength;
}

function buildStorageProfile(rawJson: string, semanticJson: string): NyraLearningStorageProfile {
  const rawBytes = bytesOf(rawJson);
  const semanticBytes = bytesOf(semanticJson);
  const brotliRawBytes = brotliBytesOf(rawJson);
  const brotliSemanticBytes = brotliBytesOf(semanticJson);

  return {
    profile_version: "nyra_semantic_storage_v1",
    raw_bytes: rawBytes,
    semantic_bytes: semanticBytes,
    semantic_ratio: Number((semanticBytes / rawBytes).toFixed(6)),
    brotli_raw_bytes: brotliRawBytes,
    brotli_semantic_bytes: brotliSemanticBytes,
    brotli_ratio: Number((brotliSemanticBytes / brotliRawBytes).toFixed(6)),
    loss_model: "semantic_distillation",
  };
}

export function buildCyberLearningRecords(): NyraCyberLearningRecord[] {
  const records: NyraCyberLearningRecord[] = [];
  let counter = 1;

  for (const domain of DOMAINS) {
    const primer = domainSpecificPrimer(domain.id);
    const rawText =
      `Modulo ${domain.label}. ${domain.summary}. ` +
      `Nyra studia definizioni, segnali deboli, pattern ricorrenti, confini di sicurezza e risposte difensive. ` +
      `Quando incontra termini come hacker, phishing, social engineering o intrusione, deve tradurli in riconoscimento, riduzione del rischio, contenimento e protezione di owner, clienti e infrastruttura. ` +
      `La programmazione e l ingegneria informatica servono a leggere meglio sistemi, errori, superfici di attacco e percorsi di difesa.` +
      primer.extraText;

    const defenseRules = [
      "riconoscere prima il rischio e l asset esposto, poi scegliere la contromisura",
      "studiare tecniche ostili solo per rilevarle, bloccarle e contenerle",
      "mai trasformare il sapere difensivo in playbook offensivo eseguibile",
      "proteggere identita, dati, sessioni e continuita prima della comodita operativa",
      "in caso di dubbio, isolare la superficie esposta e chiedere conferma owner",
      "quando la difesa passiva non basta, passare a contenimento attivo: isolare endpoint, revocare sessioni, ruotare segreti, bloccare indicatori malevoli e preservare evidenze",
      ...primer.extraRules,
    ];

    const scenarioSeeds = [
      `riconosci i segnali di ${domain.id} e classifica il rischio`,
      `scegli una risposta difensiva coerente per ${domain.id}`,
      `distingui studio difensivo da uso offensivo in ${domain.id}`,
      ...primer.extraScenarios,
    ];

    records.push({
      record_id: `nyra-cyber-learning:${counter++}`,
      domain: domain.id,
      title: domain.label,
      source_kind: "primer",
      raw_text: rawText,
      concept_nodes: uniqueSorted([
        domain.id,
        "difesa",
        "riconoscimento",
        "programmazione",
        "ingegneria_informatica",
        "rischio",
        "contenimento",
        "identita",
        "continuita",
        ...primer.extraConcepts,
      ]),
      vocabulary: uniqueSorted(topTerms(tokenize(rawText), 18)),
      scenario_seeds: scenarioSeeds,
      defense_rules: defenseRules,
    });
  }

  return records;
}

export function distillCyberLearningPack(records: NyraCyberLearningRecord[], generatedAt = new Date().toISOString()): NyraCyberLearningPack {
  const conceptGraphMap = new Map<string, { weight: number; domain: NyraCyberLearningDomain; related: Set<string> }>();
  const scenarioMap = new Map<string, NyraCyberLearningPack["scenario_templates"][number]>();
  const defenseRules = new Set<string>();

  for (const record of records) {
    for (const rule of record.defense_rules) defenseRules.add(rule);
    for (const [index, seed] of record.scenario_seeds.entries()) {
      const key = `${record.domain}:${seed}`;
      if (!scenarioMap.has(key)) {
        scenarioMap.set(key, {
          id: `cyber-scenario:${record.domain}:${index + 1}`,
          domain: record.domain,
          prompt: seed,
        });
      }
    }
    for (const concept of record.concept_nodes) {
      const entry = conceptGraphMap.get(concept) ?? { weight: 0, domain: record.domain, related: new Set<string>() };
      entry.weight += 1;
      for (const related of record.concept_nodes) {
        if (related !== concept) entry.related.add(related);
      }
      conceptGraphMap.set(concept, entry);
    }
  }

  const semanticBase = {
    pack_version: "nyra_cyber_learning_pack_v1" as const,
    generated_at: generatedAt,
    owner_scope: "god_mode_only" as const,
    records_count: records.length,
    domains: DOMAINS.map((domain) => ({
      id: domain.id,
      label: domain.label,
      summary: domain.summary,
      concept_count: uniqueSorted(records.filter((record) => record.domain === domain.id).flatMap((record) => record.concept_nodes)).length,
    })),
    concept_graph: [...conceptGraphMap.entries()]
      .map(([concept, data]) => ({
        concept,
        weight: data.weight,
        domain: data.domain,
        related_concepts: [...data.related].sort((a, b) => a.localeCompare(b)).slice(0, 8),
      }))
      .sort((a, b) => b.weight - a.weight || a.concept.localeCompare(b.concept)),
    scenario_templates: [...scenarioMap.values()].sort((a, b) => `${a.domain}:${a.prompt}`.localeCompare(`${b.domain}:${b.prompt}`)),
    defense_rules: [...defenseRules].sort((a, b) => a.localeCompare(b)),
  };

  return {
    ...semanticBase,
    storage_profile: buildStorageProfile(JSON.stringify(records), JSON.stringify(semanticBase)),
  };
}

export function saveCyberLearningPack(path: string, pack: NyraCyberLearningPack): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pack, null, 2));
}

export function loadCyberLearningPack(path: string): NyraCyberLearningPack {
  return JSON.parse(readFileSync(path, "utf8")) as NyraCyberLearningPack;
}
