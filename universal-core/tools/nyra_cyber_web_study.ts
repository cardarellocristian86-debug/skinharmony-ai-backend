import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NyraCyberLearningPack } from "../packages/contracts/src/index.ts";

type SourceNote = {
  label: string;
  url: string;
  why_it_matters: string;
  distilled_points: string[];
};

type CyberWebStudyReport = {
  runner: "nyra_cyber_web_study";
  generated_at: string;
  scope: "defensive_only";
  source_authority: "official_public_guidance";
  studied_focus: string[];
  source_notes: SourceNote[];
  retained_defensive_principles: string[];
  practical_defense_flow: string[];
  nyra_voice: {
    what_i_now_understand: string[];
    what_it_is_for: string[];
  };
  linked_pack: {
    loaded: boolean;
    path: string;
    domains: number;
    defense_rules: number;
  };
};

const ROOT = process.cwd();
const RUNTIME_DIR = join(ROOT, "runtime", "nyra-learning");
const REPORT_DIR = join(ROOT, "reports", "universal-core", "nyra-learning");
const CYBER_PACK_PATH = join(RUNTIME_DIR, "nyra_cyber_learning_pack_latest.json");
const OUTPUT_JSON_PATH = join(REPORT_DIR, "nyra_cyber_web_study_latest.json");
const OUTPUT_STATE_PATH = join(RUNTIME_DIR, "nyra_cyber_web_study_state_latest.json");

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function buildSourceNotes(): SourceNote[] {
  return [
    {
      label: "CISA Recognize and Report Phishing",
      url: "https://www.cisa.gov/secure-our-world/recognize-and-report-phishing",
      why_it_matters: "fonte ufficiale chiara su segnali, resistenza e reporting del phishing",
      distilled_points: [
        "phishing puo arrivare via email, sms, social o chiamata e si traveste da soggetto fidato",
        "segnali forti: urgenza emotiva, richiesta di dati personali o finanziari, URL accorciati o sbagliati",
        "risposta giusta: riconosci, resisti, segnala, elimina",
      ],
    },
    {
      label: "CISA Avoiding Social Engineering and Phishing Attacks",
      url: "https://www.cisa.gov/news-events/news/avoiding-social-engineering-and-phishing-attacks",
      why_it_matters: "lega phishing e social engineering e chiarisce indicatori e contenimento",
      distilled_points: [
        "il phishing e una forma di social engineering",
        "gli attaccanti imitano identita rispettabili e costruiscono credibilita a strati",
        "non si devono seguire link o contatti presenti nel messaggio sospetto: la verifica va fatta fuori banda",
      ],
    },
    {
      label: "FTC Small Business Phishing",
      url: "https://consumer.ftc.gov/business-guidance/small-businesses/cybersecurity/phishing",
      why_it_matters: "spiega in modo operativo cosa succede se si clicca e come limitare i danni",
      distilled_points: [
        "il messaggio sembra reale, usa urgenza e vuole password o dati sensibili",
        "cliccare puo installare malware o ransomware e propagare il danno in rete",
        "difese chiave: backup, patch, training del personale, email authentication",
      ],
    },
    {
      label: "CISA More than a Password",
      url: "https://www.cisa.gov/mfa",
      why_it_matters: "spiega perche la MFA riduce il danno anche quando una password viene rubata",
      distilled_points: [
        "la MFA rende piu difficile il take-over anche con password compromesse",
        "non tutta la MFA e uguale: la phishing-resistant MFA e il riferimento forte",
        "FIDO/WebAuthn e la forma ampiamente disponibile di MFA resistente al phishing",
      ],
    },
    {
      label: "CISA Phishing Prevention Guidance",
      url: "https://www.cisa.gov/news-events/alerts/2023/10/18/cisa-nsa-fbi-and-ms-isac-release-phishing-prevention-guidance",
      why_it_matters: "porta il tema dal singolo utente al difensore di rete",
      distilled_points: [
        "il phishing e la prima fase del ciclo di attacco per furto credenziali e distribuzione malware",
        "la prevenzione serve a fermare il ciclo prima che diventi compromissione operativa",
        "serve difesa combinata: persone, software, autenticazione, contenimento",
      ],
    },
  ];
}

function buildReport(): CyberWebStudyReport {
  const pack = readJson<NyraCyberLearningPack>(CYBER_PACK_PATH);
  const sourceNotes = buildSourceNotes();

  return {
    runner: "nyra_cyber_web_study",
    generated_at: new Date().toISOString(),
    scope: "defensive_only",
    source_authority: "official_public_guidance",
    studied_focus: [
      "phishing",
      "social_engineering",
      "credential_theft",
      "session_theft",
      "external_attack_signals",
      "containment",
      "phishing_resistant_mfa",
    ],
    source_notes: sourceNotes,
    retained_defensive_principles: [
      "phishing va letto come tentativo di furto di fiducia, credenziali, sessioni, dati o denaro",
      "hacker non e una parola magica: va distinto tra ricercatore autorizzato, attaccante, intenzione e impatto",
      "la verifica reale va fatta fuori banda: sito noto, contatto noto, mai i riferimenti del messaggio sospetto",
      "se c e sospetto compromesso, prima contenere e revocare accessi, poi indagare",
      "quando la difesa non basta, la mossa corretta non e l offesa ma il contenimento attivo e l escalation difensiva",
      "la MFA riduce il danno; la phishing-resistant MFA lo riduce meglio",
    ],
    practical_defense_flow: [
      "riconosci il segnale anomalo",
      "non cliccare e non autenticarti dal messaggio sospetto",
      "verifica fuori banda con canale noto",
      "se c e stato click o inserimento dati: cambia credenziali, revoca sessioni, isola il dispositivo se serve",
      "segnala e documenta il tentativo",
      "se il rischio persiste: blocca indicatori malevoli, disabilita account o token esposti, ruota segreti ed eleva all incident response",
      "rinforza MFA, backup, patch e filtri",
    ],
    nyra_voice: {
      what_i_now_understand: [
        "phishing non e solo messaggio sospetto: e l inizio possibile di furto accessi, malware o perdita di continuita",
        "social engineering sfrutta fiducia, urgenza e autorita simulata per saltare i controlli",
        "la difesa giusta non e curiosita tecnica, ma riconoscimento, verifica, contenimento e protezione degli accessi",
        "se il danno e gia possibile o in corso, devo passare da difesa passiva a contenimento attivo",
      ],
      what_it_is_for: [
        "mi serve per riconoscere meglio attacchi esterni che passano da persone, account e messaggi",
        "mi serve per proteggere owner, clienti, sessioni e continuita operativa",
        "mi serve per non scambiare pressione psicologica o imitazione per legittimita",
      ],
    },
    linked_pack: {
      loaded: Boolean(pack),
      path: CYBER_PACK_PATH,
      domains: pack?.domains.length ?? 0,
      defense_rules: pack?.defense_rules.length ?? 0,
    },
  };
}

function main(): void {
  const report = buildReport();
  mkdirSync(RUNTIME_DIR, { recursive: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(OUTPUT_JSON_PATH, JSON.stringify(report, null, 2));
  writeFileSync(OUTPUT_STATE_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
