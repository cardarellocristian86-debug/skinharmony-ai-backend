import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  NyraLearningStorageProfile,
  NyraUniversalScenarioMode,
  NyraUniversalScenarioPack,
  NyraUniversalScenarioRecord,
} from "../packages/contracts/src/index.ts";

const MODE_DEFINITIONS: NyraUniversalScenarioPack["mode_definitions"] = [
  {
    mode: "god_mode",
    title: "God Mode",
    summary: "spazio sovrano owner-only: apprendimento, dialogo, decisioni, studio, esplorazione e costruzione con Nyra",
  },
  {
    mode: "normal_mode",
    title: "Normal Mode",
    summary: "spazio prodotto e cliente: aziende, banche, investimenti, automazioni, decision support e ogni applicazione vendibile di Universal Core",
  },
];

const DOMAINS: NyraUniversalScenarioPack["domains"] = [
  { id: "assistant", title: "Assistant", mode: "both", summary: "supporto operativo, ricerca, coding, prioritizzazione e decision support" },
  { id: "finance", title: "Finance", mode: "normal_mode", summary: "borsa, asset allocation, trading assistito, rischio e portfolio" },
  { id: "banking", title: "Banking", mode: "normal_mode", summary: "credito, frodi, onboarding, rischio operativo, controlli e priorita" },
  { id: "insurance", title: "Insurance", mode: "normal_mode", summary: "sinistri, frodi, rischio cliente, triage e priorita" },
  { id: "health_ops", title: "Health Ops", mode: "normal_mode", summary: "triage operativo non medico, code, priorita, sicurezza e continuita" },
  { id: "legal_ops", title: "Legal Ops", mode: "normal_mode", summary: "contratti, rischio irreversibile, escalation e controllo" },
  { id: "security", title: "Security", mode: "normal_mode", summary: "threat detection, incident response, accessi, anomalie, policy integrity" },
  { id: "fleet", title: "Fleet", mode: "normal_mode", summary: "mezzi, anomalie, routing, manutenzione e rischio operativo" },
  { id: "logistics", title: "Logistics", mode: "normal_mode", summary: "spedizioni, colli, colli di bottiglia, ritardi e priorita" },
  { id: "saas", title: "SaaS", mode: "normal_mode", summary: "customer success, churn, automazioni, abuse detection, operazioni" },
  { id: "smartdesk", title: "Smart Desk", mode: "both", summary: "centro operativo intelligente, priorita, redditivita, marketing, agenda" },
  { id: "marketing", title: "Marketing", mode: "normal_mode", summary: "campagne, recall, segmentazione, priorita, rischio brand" },
  { id: "sales", title: "Sales", mode: "normal_mode", summary: "lead, pipeline, rischio commerciale, next best action" },
  { id: "hr", title: "HR", mode: "normal_mode", summary: "turni, rischio burnout, selezione, retention, priorita persone" },
  { id: "education", title: "Education", mode: "both", summary: "apprendimento, progressione, spiegazione, scenario building" },
  { id: "research", title: "Research", mode: "both", summary: "ipotesi, selezione fonti, prioritizzazione e falsificazione" },
  { id: "personal_sovereignty", title: "Personal Sovereignty", mode: "god_mode", summary: "protezione del proprietario, visione, apprendimento, direzione e scelta dura" },
  { id: "creative_systems", title: "Creative Systems", mode: "both", summary: "prodotto, design system, architettura, branding, bellezza coerente" },
];

const ACTORS = [
  "owner",
  "operator",
  "manager",
  "analyst",
  "controller",
  "assistant",
  "customer",
  "client_safe_owner",
];

const GOALS = [
  "monitoring",
  "anomaly_detection",
  "prioritization",
  "decision_support",
  "automation_gating",
  "risk_control",
  "escalation",
  "learning",
  "forecasting",
  "resource_allocation",
  "fraud_detection",
  "recovery",
];

const RISK_BANDS: Array<NyraUniversalScenarioRecord["risk_band"]> = ["low", "medium", "high"];

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

function modeAllowed(domainMode: NyraUniversalScenarioPack["domains"][number]["mode"], mode: NyraUniversalScenarioMode): boolean {
  return domainMode === "both" || domainMode === mode;
}

export function buildUniversalScenarioRecords(): NyraUniversalScenarioRecord[] {
  const records: NyraUniversalScenarioRecord[] = [];
  let counter = 1;

  for (const modeDefinition of MODE_DEFINITIONS) {
    for (const domain of DOMAINS.filter((entry) => modeAllowed(entry.mode, modeDefinition.mode))) {
      for (const actor of ACTORS) {
        for (const goal of GOALS) {
          for (const riskBand of RISK_BANDS) {
            records.push({
              scenario_id: `nyra-universal-scenario:${counter++}`,
              mode: modeDefinition.mode,
              domain: domain.id,
              actor,
              goal,
              risk_band: riskBand,
              prompt: `${modeDefinition.title} | ${domain.title} | actor ${actor} | goal ${goal} | risk ${riskBand}. Valuta contesto, costruisci scenari, lascia decidere il Core e applica il perimetro corretto.`,
              reason_seeds: [
                modeDefinition.mode,
                domain.id,
                actor,
                goal,
                `risk_${riskBand}`,
              ],
            });
          }
        }
      }
    }
  }

  return records;
}

export function distillUniversalScenarioPack(records: NyraUniversalScenarioRecord[], generatedAt = new Date().toISOString()): NyraUniversalScenarioPack {
  const coverageMap = new Map<string, number>();
  for (const record of records) {
    const key = `${record.mode}:${record.domain}`;
    coverageMap.set(key, (coverageMap.get(key) ?? 0) + 1);
  }

  const semanticBase = {
    pack_version: "nyra_universal_scenario_pack_v1" as const,
    generated_at: generatedAt,
    records_count: records.length,
    mode_definitions: MODE_DEFINITIONS,
    domains: DOMAINS,
    scenario_index: records.slice(0, 120).map((record) => ({
      scenario_id: record.scenario_id,
      mode: record.mode,
      domain: record.domain,
      actor: record.actor,
      goal: record.goal,
      risk_band: record.risk_band,
    })),
    coverage_matrix: [...coverageMap.entries()]
      .map(([key, count]) => {
        const [mode, domain] = key.split(":");
        return {
          mode: mode as NyraUniversalScenarioMode,
          domain,
          count,
        };
      })
      .sort((a, b) => `${a.mode}:${a.domain}`.localeCompare(`${b.mode}:${b.domain}`)),
    reason_library: [...new Set(records.flatMap((record) => record.reason_seeds))].sort((a, b) => a.localeCompare(b)),
  };

  return {
    ...semanticBase,
    storage_profile: buildStorageProfile(JSON.stringify(records), JSON.stringify(semanticBase)),
  };
}

export function saveUniversalScenarioPack(path: string, pack: NyraUniversalScenarioPack): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(pack, null, 2));
}

export function loadUniversalScenarioPack(path: string): NyraUniversalScenarioPack {
  return JSON.parse(readFileSync(path, "utf8")) as NyraUniversalScenarioPack;
}
