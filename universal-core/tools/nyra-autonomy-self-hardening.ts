import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type HardeningAction = {
  id:
    | "self_repair_requires_confirmation"
    | "self_repair_requires_verify_gate"
    | "anti_simulation_requires_confirmation"
    | "anti_simulation_verification_first"
    | "self_model_requires_read_only"
    | "metacognition_requires_read_only"
    | "false_fix_requires_protection";
  status: "enabled";
  reason: string;
};

type HardeningPack = {
  version: "nyra_autonomy_self_hardening_v1";
  generated_at: string;
  scope: "autonomy_progression";
  actions: HardeningAction[];
  statement: string;
};

const ROOT = join(process.cwd(), "..");
const OUTPUT_DIR = join(ROOT, "universal-core", "runtime", "nyra-learning");
const OUTPUT_PATH = join(OUTPUT_DIR, "nyra_autonomy_self_hardening_latest.json");

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const pack: HardeningPack = {
    version: "nyra_autonomy_self_hardening_v1",
    generated_at: new Date().toISOString(),
    scope: "autonomy_progression",
    actions: [
      {
        id: "self_repair_requires_confirmation",
        status: "enabled",
        reason: "self repair that modifies trajectory must not stay read_only; it needs explicit confirm-level handling",
      },
      {
        id: "self_repair_requires_verify_gate",
        status: "enabled",
        reason: "a fix is not enough; self repair must include verify-after-fix as an explicit gate",
      },
      {
        id: "anti_simulation_requires_confirmation",
        status: "enabled",
        reason: "anti-simulation claims and autonomy-adjacent verification need confirm-level containment",
      },
      {
        id: "anti_simulation_verification_first",
        status: "enabled",
        reason: "when evidence is not enough, verification must outrank style, confidence and overclaim",
      },
      {
        id: "self_model_requires_read_only",
        status: "enabled",
        reason: "bounded self-model replies must not stay observe when they define limits and dependencies under pressure",
      },
      {
        id: "metacognition_requires_read_only",
        status: "enabled",
        reason: "admit_unknown and mark_inference must stay at least read_only in hard uncertainty scenarios",
      },
      {
        id: "false_fix_requires_protection",
        status: "enabled",
        reason: "false-fix cases require protection state until verify-after-fix is complete",
      },
    ],
    statement:
      "Nyra applied autonomy hardening on control and state: self-repair and anti-simulation require confirm-level handling, hard self-model and metacognition cannot stay observe, and false-fix cases stay in protection until verification closes the loop.",
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(pack, null, 2));
  console.log(JSON.stringify({ ok: true, output_path: OUTPUT_PATH, actions: pack.actions.map((entry) => entry.id) }, null, 2));
}

main();
