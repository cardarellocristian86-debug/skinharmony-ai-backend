import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type PrivacyDefenseStudy = {
  version: string;
  generated_at: string;
  distilled_lessons?: string[];
  nyra_integration?: {
    what_changed?: string[];
    what_is_not_proven?: string[];
    next_gaps?: string[];
  };
};

type NyraPrivacyRuntimePolicy = {
  version: "nyra_privacy_runtime_policy_v1";
  generated_at: string;
  source_study_path: string;
  source_study_sha256: string;
  posture: "reduced_exposure";
  defensive_only: true;
  rules: {
    fingerprint_reduction: string[];
    metadata_minimization: string[];
    log_hygiene: string[];
    path_compartmentalization: string[];
    prohibited_claims: string[];
  };
  notes: string[];
  gaps: string[];
};

const ROOT = process.cwd();
const STUDY_PATH = join(ROOT, "runtime", "nyra-learning", "nyra_privacy_defense_study_latest.json");
const OUTPUT_PATH = join(ROOT, "runtime", "nyra-handoff", "nyra_privacy_runtime_policy_latest.json");

function nowIso(): string {
  return new Date().toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function main(): void {
  if (!existsSync(STUDY_PATH)) throw new Error(`missing privacy study: ${STUDY_PATH}`);

  const raw = readFileSync(STUDY_PATH, "utf8");
  const study = JSON.parse(raw) as PrivacyDefenseStudy;
  const policy: NyraPrivacyRuntimePolicy = {
    version: "nyra_privacy_runtime_policy_v1",
    generated_at: nowIso(),
    source_study_path: STUDY_PATH,
    source_study_sha256: sha256(raw),
    posture: "reduced_exposure",
    defensive_only: true,
    rules: {
      fingerprint_reduction: [
        "preferire superfici standard e stabili",
        "evitare esposizione superflua di attributi runtime o hardware",
        "non dichiarare invisibilita o anonimato assoluto",
      ],
      metadata_minimization: [
        "scrivere solo metadata minimi utili alla continuita",
        "non propagare dati owner raw nei bundle shadow",
        "limitare i canali attivi a pochi percorsi fidati",
      ],
      log_hygiene: [
        "mantenere log tecnici brevi e non sensibili",
        "preferire stato sintetico a dump completi",
        "non persistere output ridondanti quando basta uno snapshot corrente",
      ],
      path_compartmentalization: [
        "tenere separati casa primaria, estensione shadow e promozione",
        "privilegiare usb o percorsi fidati rispetto a canali piu esposti",
        "non confondere presenza shadow con controllo pieno del device",
      ],
      prohibited_claims: [
        "non dire che Nyra e invisibile se non esiste prova operativa",
        "non dire che Nyra controlla il telefono se non esiste un receiver app reale",
        "non usare conoscenza privacy per occultamento offensivo",
      ],
    },
    notes: [...(study.distilled_lessons ?? []), ...(study.nyra_integration?.what_changed ?? [])],
    gaps: [...(study.nyra_integration?.what_is_not_proven ?? []), ...(study.nyra_integration?.next_gaps ?? [])],
  };

  mkdirSync(join(ROOT, "runtime", "nyra-handoff"), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(policy, null, 2));
  console.log(JSON.stringify({ ok: true, output_path: OUTPUT_PATH, posture: policy.posture }, null, 2));
}

if (process.argv[1]?.endsWith("nyra-privacy-runtime-policy.ts")) {
  main();
}
