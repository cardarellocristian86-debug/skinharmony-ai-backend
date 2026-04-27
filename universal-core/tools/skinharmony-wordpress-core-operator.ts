import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runUniversalCore } from "../packages/core/src/index.ts";
import type { UniversalCoreInput, UniversalSignal } from "../packages/contracts/src/index.ts";

type Variant = {
  id: string;
  label: string;
  description: string;
  impact: number;
  speed: number;
  risk: number;
  reversibility: number;
  dataNeed: number;
  commercialValue: number;
  brandSafety: number;
  implementationScope: "small" | "medium" | "large";
};

const REPORT_DIR = join(process.cwd(), "reports", "universal-core", "wordpress-operator");
const REPORT_PATH = join(REPORT_DIR, "skinharmony_wordpress_core_operator_latest.json");

const variants: Variant[] = [
  {
    id: "place_conversion_shortcodes",
    label: "Inserire shortcode conversione nelle pagine chiave",
    description: "Aggiungere trial bridge e lead form nelle pagine Smart Desk, Trial, Tecnologie e Contatti.",
    impact: 88,
    speed: 86,
    risk: 22,
    reversibility: 92,
    dataNeed: 18,
    commercialValue: 92,
    brandSafety: 84,
    implementationScope: "small",
  },
  {
    id: "lead_pipeline_states",
    label: "Rendere Lead Intelligence un mini CRM",
    description: "Aggiungere stati lead, note, export CSV, reminder e priorita manuale/automatica.",
    impact: 84,
    speed: 58,
    risk: 32,
    reversibility: 78,
    dataNeed: 34,
    commercialValue: 90,
    brandSafety: 88,
    implementationScope: "medium",
  },
  {
    id: "multinational_benchmark_pack",
    label: "Benchmark multinazionali senza copiare contenuti",
    description: "Studiare pattern pubblici di grandi aziende: navigazione, trust, compliance, lead funnel, localizzazione.",
    impact: 78,
    speed: 52,
    risk: 26,
    reversibility: 94,
    dataNeed: 66,
    commercialValue: 76,
    brandSafety: 90,
    implementationScope: "medium",
  },
  {
    id: "translation_manager_v2",
    label: "Potenziare Translation Manager",
    description: "Aggiungere filtro mancanti, import/export CSV, approvazione massiva e copia sorgente.",
    impact: 66,
    speed: 62,
    risk: 20,
    reversibility: 86,
    dataNeed: 30,
    commercialValue: 62,
    brandSafety: 94,
    implementationScope: "medium",
  },
  {
    id: "local_translation_service",
    label: "Servizio traduzione locale self-hosted",
    description: "Creare microservizio separato per traduzioni senza OpenAI, collegato al provider local_service.",
    impact: 72,
    speed: 34,
    risk: 48,
    reversibility: 74,
    dataNeed: 72,
    commercialValue: 64,
    brandSafety: 80,
    implementationScope: "large",
  },
  {
    id: "seo_local_pages_batch",
    label: "Generare batch bozze SEO locali",
    description: "Creare pagine locali/settoriali in bozza per estetica, parrucchieri, barber e tecnologie.",
    impact: 70,
    speed: 76,
    risk: 58,
    reversibility: 68,
    dataNeed: 54,
    commercialValue: 74,
    brandSafety: 54,
    implementationScope: "medium",
  },
];

function nowIso(): string {
  return new Date().toISOString();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function signal(variant: Variant): UniversalSignal {
  const scopePenalty = variant.implementationScope === "large" ? 18 : variant.implementationScope === "medium" ? 8 : 0;
  const value = clamp(
    variant.impact * 0.22 +
      variant.speed * 0.14 +
      variant.commercialValue * 0.24 +
      variant.brandSafety * 0.18 +
      variant.reversibility * 0.10 -
      variant.risk * 0.14 -
      variant.dataNeed * 0.06 -
      scopePenalty,
  );

  return {
    id: `wordpress:${variant.id}`,
    source: "skinharmony_wordpress_core_operator",
    category: "wordpress_next_action",
    label: variant.label,
    value,
    normalized_score: value,
    severity_hint: clamp(variant.impact),
    confidence_hint: clamp(100 - variant.dataNeed * 0.42),
    reliability_hint: clamp(variant.brandSafety),
    friction_hint: clamp(variant.risk + scopePenalty),
    risk_hint: clamp(variant.risk + Math.max(0, variant.dataNeed - 45) * 0.25 + scopePenalty),
    reversibility_hint: variant.reversibility,
    expected_value_hint: clamp(variant.commercialValue * 0.60 + variant.impact * 0.40),
    evidence: [
      { label: "variant_id", value: variant.id },
      { label: "description", value: variant.description },
      { label: "scope", value: variant.implementationScope },
    ],
    tags: ["wordpress", "skinharmony", "operator", variant.implementationScope],
  };
}

function input(): UniversalCoreInput {
  return {
    request_id: `skinharmony-wordpress-operator:${Date.now()}`,
    generated_at: nowIso(),
    domain: "marketing",
    context: {
      actor_id: "codex",
      mode: "wordpress_operational_engine",
      locale: "it",
      metadata: {
        owner_request: "usa Universal Core/Nyra come motore operativo per decidere il prossimo lavoro WordPress",
        nyra_boundary: "Nyra/Core assistono selezione; Codex implementa e verifica",
      },
    },
    signals: variants.map(signal),
    data_quality: {
      score: 82,
      completeness: 78,
      freshness: 86,
      consistency: 84,
      reliability: 82,
      missing_fields: ["benchmark multinazionali non ancora studiato nel dettaglio"],
    },
    constraints: {
      allow_automation: false,
      require_confirmation: false,
      max_control_level: "suggest",
      safety_mode: false,
      blocked_action_rules: [
        {
          scope: "copy_exact_multinational_content",
          reason_code: "no_content_copy_or_brand_impersonation",
          severity: 82,
          blocks_execution: false,
        },
      ],
    },
  };
}

function main(): void {
  mkdirSync(REPORT_DIR, { recursive: true });
  const coreInput = input();
  const output = runUniversalCore(coreInput);
  const ranking = output.recommended_actions.map((action) => {
    const variantId = String(action.id).replace("action:wordpress:", "");
    const variant = variants.find((item) => item.id === variantId);
    return {
      action_id: action.id,
      variant_id: variantId,
      label: action.label,
      final_priority_score: action.final_priority_score,
      risk_score: action.risk_score,
      control_level: action.control_level,
      blocked: action.blocked,
      variant,
    };
  });

  const report = {
    runner: "skinharmony_wordpress_core_operator",
    generated_at: nowIso(),
    report_path: REPORT_PATH,
    core_state: output.state,
    core_control_level: output.control_level,
    core_risk: output.risk,
    winner: ranking[0] ?? null,
    ranking,
    boundary: {
      nyra_claim: "operational_selector_only",
      no_consciousness_claim: true,
      no_blind_execution: true,
      codex_must_verify_live: true,
    },
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main();
