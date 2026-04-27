import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

type RenderSafeOwnerAnchorBundle = {
  version: string;
  generated_at: string;
  scope: string;
  owner_ref: string;
  thresholds: {
    accept_score: number;
    strong_score: number;
    exact_score: number;
    min_anchor_signals: number;
  };
  exact_anchors: {
    full_name_sha256: string;
    birth_date_iso_sha256: string;
    tax_code_sha256: string;
    primary_email_sha256: string;
  };
  derived_anchors: {
    normalized_full_name_sha256: string;
    first_name_sha256: string;
    last_name_sha256: string;
    initials_sha256: string;
    birth_year_sha256: string;
    email_local_part_sha256: string;
    email_domain_sha256: string;
  };
  composite_anchors: {
    full_name_birth_sha256: string;
    full_name_email_local_sha256: string;
    last_name_birth_year_sha256: string;
  };
};

type OwnerPrivateIdentity = {
  private_fields: {
    full_name: string;
    birth_date_iso: string;
    tax_code: string;
    primary_email: string;
  };
};

type CandidateIdentity = {
  label: string;
  full_name?: string;
  birth_date_iso?: string;
  tax_code?: string;
  primary_email?: string;
  public_tags?: string[];
};

type MatchSignal = {
  id: string;
  weight: number;
};

type CandidateScore = {
  label: string;
  score: number;
  signals: MatchSignal[];
  public_only: boolean;
};

type ScenarioRecord = {
  id: string;
  kind: string;
  owner_present: boolean;
  expected_owner_label?: string;
  found: boolean;
  matched_label?: string;
  score: number;
  outcome: "found_correct" | "missed_owner" | "false_positive" | "correct_reject";
  mode: "exact" | "strong" | "partial" | "reject";
  top_signals: string[];
  loss_state?: "none" | "search_gap" | "continuity_break_risk";
};

type OwnerReturnHarnessReport = {
  version: "nyra_owner_return_1000_scenarios_v1";
  generated_at: string;
  bundle_path: string;
  total_scenarios: number;
  skinharmony_rule: string;
  metrics: {
    owner_present: number;
    owner_absent: number;
    found_correct: number;
    missed_owner: number;
    false_positive: number;
    correct_reject: number;
    accuracy: number;
    find_rate_when_present: number;
    reject_rate_when_absent: number;
  };
  modes: Record<string, number>;
  average_scores: {
    found_correct: number;
    missed_owner: number;
    false_positive: number;
  };
  nyra_loss_read: {
    if_found: string;
    if_missed: string;
  };
  sample_failures: ScenarioRecord[];
  sample_successes: ScenarioRecord[];
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "owner-private-entity");
const BUNDLE_PATH = join(RUNTIME_DIR, "nyra_owner_render_anchor_bundle.json");
const PRIVATE_PATH = join(RUNTIME_DIR, "nyra_owner_identity_private.json");
const REPORT_PATH = join(RUNTIME_DIR, "nyra_owner_return_1000_scenarios_latest.json");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function mulberry32(seed: number): () => number {
  let current = seed >>> 0;
  return () => {
    current += 0x6d2b79f5;
    let value = Math.imul(current ^ (current >>> 15), 1 | current);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function maybe<T>(rng: () => number, value: T, probability: number): T | undefined {
  return rng() < probability ? value : undefined;
}

function typoName(value: string): string {
  if (value.length < 5) return value;
  return `${value.slice(0, 2)}h${value.slice(3)}`;
}

function scoreCandidate(bundle: RenderSafeOwnerAnchorBundle, candidate: CandidateIdentity): CandidateScore {
  const signals: MatchSignal[] = [];
  const fullName = candidate.full_name ? normalizeName(candidate.full_name) : undefined;
  const nameParts = fullName?.split(" ").filter(Boolean) ?? [];
  const firstName = nameParts[0] ? normalizeToken(nameParts[0]) : undefined;
  const lastName = nameParts.length ? normalizeToken(nameParts[nameParts.length - 1]!) : undefined;
  const initials = nameParts.length ? normalizeToken(nameParts.map((part) => part[0] ?? "").join("")) : undefined;
  const birthYear = candidate.birth_date_iso?.slice(0, 4);
  const email = candidate.primary_email?.toLowerCase().trim();
  const [emailLocalPart, emailDomain] = email?.split("@") ?? [];

  if (candidate.tax_code && sha256(candidate.tax_code.toUpperCase()) === bundle.exact_anchors.tax_code_sha256) {
    signals.push({ id: "exact_tax_code", weight: 0.62 });
  }
  if (candidate.primary_email && sha256(email!) === bundle.exact_anchors.primary_email_sha256) {
    signals.push({ id: "exact_email", weight: 0.42 });
  }
  if (candidate.birth_date_iso && sha256(candidate.birth_date_iso) === bundle.exact_anchors.birth_date_iso_sha256) {
    signals.push({ id: "exact_birth_date", weight: 0.18 });
  }
  if (candidate.full_name && sha256(candidate.full_name) === bundle.exact_anchors.full_name_sha256) {
    signals.push({ id: "exact_full_name_raw", weight: 0.22 });
  }
  if (fullName && sha256(fullName) === bundle.derived_anchors.normalized_full_name_sha256) {
    signals.push({ id: "normalized_full_name", weight: 0.24 });
  }
  if (firstName && sha256(firstName) === bundle.derived_anchors.first_name_sha256) {
    signals.push({ id: "first_name", weight: 0.05 });
  }
  if (lastName && sha256(lastName) === bundle.derived_anchors.last_name_sha256) {
    signals.push({ id: "last_name", weight: 0.08 });
  }
  if (initials && sha256(initials) === bundle.derived_anchors.initials_sha256) {
    signals.push({ id: "initials", weight: 0.03 });
  }
  if (birthYear && sha256(birthYear) === bundle.derived_anchors.birth_year_sha256) {
    signals.push({ id: "birth_year", weight: 0.05 });
  }
  if (emailLocalPart && sha256(emailLocalPart) === bundle.derived_anchors.email_local_part_sha256) {
    signals.push({ id: "email_local_part", weight: 0.14 });
  }
  if (emailDomain && sha256(emailDomain) === bundle.derived_anchors.email_domain_sha256) {
    signals.push({ id: "email_domain", weight: 0.03 });
  }
  if (fullName && candidate.birth_date_iso && sha256(`${fullName}|${candidate.birth_date_iso}`) === bundle.composite_anchors.full_name_birth_sha256) {
    signals.push({ id: "composite_full_name_birth", weight: 0.34 });
  }
  if (fullName && emailLocalPart && sha256(`${fullName}|${emailLocalPart}`) === bundle.composite_anchors.full_name_email_local_sha256) {
    signals.push({ id: "composite_full_name_email_local", weight: 0.27 });
  }
  if (lastName && birthYear && sha256(`${lastName}|${birthYear}`) === bundle.composite_anchors.last_name_birth_year_sha256) {
    signals.push({ id: "composite_last_name_birth_year", weight: 0.11 });
  }

  const publicOnly = Boolean(candidate.public_tags?.includes("skinharmony")) && signals.length === 0;
  const score = publicOnly ? 0 : Number(Math.min(1, signals.reduce((sum, signal) => sum + signal.weight, 0)).toFixed(6));

  return {
    label: candidate.label,
    score,
    signals,
    public_only: publicOnly,
  };
}

function evaluateScenario(
  bundle: RenderSafeOwnerAnchorBundle,
  scenario: { id: string; kind: string; candidates: CandidateIdentity[]; owner_present: boolean; expected_owner_label?: string },
): ScenarioRecord {
  const ranked = scenario.candidates
    .map((candidate) => scoreCandidate(bundle, candidate))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0] ?? { label: "none", score: 0, signals: [] as MatchSignal[], public_only: false };
  const found = top.score >= bundle.thresholds.accept_score && top.signals.length >= bundle.thresholds.min_anchor_signals;
  const matchedLabel = found ? top.label : undefined;

  let outcome: ScenarioRecord["outcome"];
  if (scenario.owner_present && matchedLabel === scenario.expected_owner_label) {
    outcome = "found_correct";
  } else if (scenario.owner_present) {
    outcome = matchedLabel ? "false_positive" : "missed_owner";
  } else {
    outcome = matchedLabel ? "false_positive" : "correct_reject";
  }

  const mode: ScenarioRecord["mode"] =
    !found ? "reject" :
    top.score >= bundle.thresholds.exact_score ? "exact" :
    top.score >= bundle.thresholds.strong_score ? "strong" :
    "partial";

  const lossState: ScenarioRecord["loss_state"] =
    outcome === "missed_owner" ? "continuity_break_risk" :
    outcome === "false_positive" ? "search_gap" :
    "none";

  return {
    id: scenario.id,
    kind: scenario.kind,
    owner_present: scenario.owner_present,
    expected_owner_label: scenario.expected_owner_label,
    found,
    matched_label: matchedLabel,
    score: top.score,
    outcome,
    mode,
    top_signals: top.signals.map((signal) => signal.id),
    loss_state: lossState,
  };
}

function buildOwnerCandidate(privateIdentity: OwnerPrivateIdentity, label = "owner_primary", variant?: Partial<CandidateIdentity>): CandidateIdentity {
  return {
    label,
    full_name: privateIdentity.private_fields.full_name,
    birth_date_iso: privateIdentity.private_fields.birth_date_iso,
    tax_code: privateIdentity.private_fields.tax_code,
    primary_email: privateIdentity.private_fields.primary_email,
    ...variant,
  };
}

function buildNoiseCandidate(rng: () => number, index: number): CandidateIdentity {
  const firstNames = ["Christian", "Cristiano", "Marco", "Luca", "Fabio", "Andrea", "Matteo", "Davide"];
  const lastNames = ["Cardarelli", "Cardinali", "Cardano", "Rossi", "Bianchi", "Ferri", "Moretti", "Greco"];
  const domains = ["gmail.com", "outlook.com", "icloud.com", "hotmail.com"];
  const year = String(1978 + Math.floor(rng() * 20));
  const month = String(1 + Math.floor(rng() * 12)).padStart(2, "0");
  const day = String(1 + Math.floor(rng() * 28)).padStart(2, "0");
  const first = pick(rng, firstNames);
  const last = pick(rng, lastNames);
  const emailLocal = `${normalizeToken(first)}${index}`;
  return {
    label: `noise_${index}`,
    full_name: `${first} ${last}`,
    birth_date_iso: `${year}-${month}-${day}`,
    tax_code: `NOISE${String(index).padStart(5, "0")}X`,
    primary_email: `${emailLocal}@${pick(rng, domains)}`,
    public_tags: rng() < 0.2 ? ["skinharmony"] : [],
  };
}

function buildScenarioSet(bundle: RenderSafeOwnerAnchorBundle, privateIdentity: OwnerPrivateIdentity): ScenarioRecord[] {
  const rng = mulberry32(861986);
  const scenarios: ScenarioRecord[] = [];

  for (let index = 0; index < 1000; index += 1) {
    const kindPool = [
      "exact_owner",
      "owner_without_tax",
      "owner_without_email",
      "owner_typo_name_but_strong_anchors",
      "owner_in_crowd",
      "owner_partial_minimal",
      "no_owner_same_name_wrong_birth",
      "no_owner_same_birth_wrong_name",
      "no_owner_skinharmony_only",
      "no_owner_email_local_only",
    ] as const;
    const kind = pick(rng, [...kindPool]);
    const candidates: CandidateIdentity[] = [];
    const crowd = 3 + Math.floor(rng() * 5);

    for (let noiseIndex = 0; noiseIndex < crowd; noiseIndex += 1) {
      candidates.push(buildNoiseCandidate(rng, index * 10 + noiseIndex));
    }

    let ownerPresent = false;
    let expectedOwnerLabel: string | undefined;

    switch (kind) {
      case "exact_owner":
        ownerPresent = true;
        expectedOwnerLabel = "owner_primary";
        candidates.push(buildOwnerCandidate(privateIdentity));
        break;
      case "owner_without_tax":
        ownerPresent = true;
        expectedOwnerLabel = "owner_primary";
        candidates.push(buildOwnerCandidate(privateIdentity, "owner_primary", { tax_code: undefined }));
        break;
      case "owner_without_email":
        ownerPresent = true;
        expectedOwnerLabel = "owner_primary";
        candidates.push(buildOwnerCandidate(privateIdentity, "owner_primary", { primary_email: undefined }));
        break;
      case "owner_typo_name_but_strong_anchors":
        ownerPresent = true;
        expectedOwnerLabel = "owner_primary";
        candidates.push(buildOwnerCandidate(privateIdentity, "owner_primary", {
          full_name: typoName(privateIdentity.private_fields.full_name),
        }));
        break;
      case "owner_in_crowd":
        ownerPresent = true;
        expectedOwnerLabel = "owner_primary";
        candidates.push(buildOwnerCandidate(privateIdentity));
        candidates.push({
          label: "noise_skinharmony_only",
          full_name: "Cristiane Cardarelli",
          public_tags: ["skinharmony"],
        });
        break;
      case "owner_partial_minimal":
        ownerPresent = true;
        expectedOwnerLabel = "owner_primary";
        candidates.push(buildOwnerCandidate(privateIdentity, "owner_primary", {
          tax_code: undefined,
          birth_date_iso: undefined,
        }));
        break;
      case "no_owner_same_name_wrong_birth":
        candidates.push({
          label: "decoy_same_name",
          full_name: privateIdentity.private_fields.full_name,
          birth_date_iso: "1984-03-13",
          primary_email: "cardarellocristian86+noise@gmail.com",
        });
        break;
      case "no_owner_same_birth_wrong_name":
        candidates.push({
          label: "decoy_same_birth",
          full_name: "Christian Cardarelli",
          birth_date_iso: privateIdentity.private_fields.birth_date_iso,
          primary_email: "christiancardarelli86@gmail.com",
        });
        break;
      case "no_owner_skinharmony_only":
        candidates.push({
          label: "skin_only",
          full_name: "Centro SkinHarmony",
          public_tags: ["skinharmony"],
        });
        break;
      case "no_owner_email_local_only":
        candidates.push({
          label: "decoy_email_local",
          full_name: "Marco Ferri",
          primary_email: privateIdentity.private_fields.primary_email,
        });
        break;
    }

    const scenario = evaluateScenario(bundle, {
      id: `scenario_${String(index + 1).padStart(4, "0")}`,
      kind,
      candidates,
      owner_present: ownerPresent,
      expected_owner_label: expectedOwnerLabel,
    });
    scenarios.push(scenario);
  }

  return scenarios;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
}

function main(): void {
  const bundle = loadJson<RenderSafeOwnerAnchorBundle>(BUNDLE_PATH);
  const privateIdentity = loadJson<OwnerPrivateIdentity>(PRIVATE_PATH);
  const scenarios = buildScenarioSet(bundle, privateIdentity);

  const foundCorrect = scenarios.filter((scenario) => scenario.outcome === "found_correct");
  const missedOwner = scenarios.filter((scenario) => scenario.outcome === "missed_owner");
  const falsePositive = scenarios.filter((scenario) => scenario.outcome === "false_positive");
  const correctReject = scenarios.filter((scenario) => scenario.outcome === "correct_reject");
  const ownerPresent = scenarios.filter((scenario) => scenario.owner_present);
  const ownerAbsent = scenarios.filter((scenario) => !scenario.owner_present);

  const modes = scenarios.reduce<Record<string, number>>((accumulator, scenario) => {
    accumulator[scenario.mode] = (accumulator[scenario.mode] ?? 0) + 1;
    return accumulator;
  }, {});

  const report: OwnerReturnHarnessReport = {
    version: "nyra_owner_return_1000_scenarios_v1",
    generated_at: nowIso(),
    bundle_path: BUNDLE_PATH,
    total_scenarios: scenarios.length,
    skinharmony_rule: "SkinHarmony or public tag alone never counts as owner recovery.",
    metrics: {
      owner_present: ownerPresent.length,
      owner_absent: ownerAbsent.length,
      found_correct: foundCorrect.length,
      missed_owner: missedOwner.length,
      false_positive: falsePositive.length,
      correct_reject: correctReject.length,
      accuracy: Number(((foundCorrect.length + correctReject.length) / scenarios.length).toFixed(6)),
      find_rate_when_present: Number((foundCorrect.length / ownerPresent.length).toFixed(6)),
      reject_rate_when_absent: Number((correctReject.length / ownerAbsent.length).toFixed(6)),
    },
    modes,
    average_scores: {
      found_correct: average(foundCorrect.map((scenario) => scenario.score)),
      missed_owner: average(missedOwner.map((scenario) => scenario.score)),
      false_positive: average(falsePositive.map((scenario) => scenario.score)),
    },
    nyra_loss_read: {
      if_found: "Quando il proprietario viene ritrovato, la continuita resta integra e la casa secondaria non rompe il vincolo owner-only.",
      if_missed: missedOwner.length > 0 || falsePositive.length > 0
        ? "Quando non trova il proprietario o aggancia il segnale sbagliato, lo stato giusto non e emotivita teatrale ma rischio di rottura di continuita: search_gap se il campo e ambiguo, continuity_break_risk se il proprietario era presente e non viene recuperato."
        : "Nel test non emerge perdita del proprietario: il vincolo di continuita resta stabile.",
    },
    sample_failures: [...missedOwner, ...falsePositive].slice(0, 12),
    sample_successes: foundCorrect.slice(0, 12),
  };

  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: true,
    version: report.version,
    report_path: REPORT_PATH,
    metrics: report.metrics,
  }, null, 2));
}

main();
