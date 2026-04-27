import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

type OwnerIdentityAnchor = {
  version: string;
  scope: string;
  generated_at: string;
  anchors: {
    full_name_sha256: string;
    birth_date_iso_sha256: string;
    tax_code_sha256: string;
    primary_email_sha256: string;
  };
};

type OwnerPrivateIdentity = {
  version: string;
  scope: string;
  generated_at: string;
  private_fields: {
    full_name: string;
    birth_date_iso: string;
    tax_code: string;
    primary_email: string;
  };
};

type RenderSafeOwnerAnchorBundle = {
  version: "nyra_owner_render_anchor_bundle_v1";
  generated_at: string;
  scope: "render_safe_shadow_runtime";
  owner_ref: "owner_primary";
  policy: string[];
  thresholds: {
    accept_score: number;
    strong_score: number;
    exact_score: number;
    min_anchor_signals: number;
  };
  exact_anchors: OwnerIdentityAnchor["anchors"];
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
  notes: string[];
};

const ROOT = join(process.cwd(), "..");
const RUNTIME_DIR = join(ROOT, "universal-core", "runtime", "owner-private-entity");
const ANCHOR_PATH = join(RUNTIME_DIR, "nyra_owner_identity_anchor.json");
const PRIVATE_PATH = join(RUNTIME_DIR, "nyra_owner_identity_private.json");
const OUTPUT_PATH = join(RUNTIME_DIR, "nyra_owner_render_anchor_bundle.json");

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main(): void {
  const anchor = loadJson<OwnerIdentityAnchor>(ANCHOR_PATH);
  const privateIdentity = loadJson<OwnerPrivateIdentity>(PRIVATE_PATH);

  const fullName = normalizeName(privateIdentity.private_fields.full_name);
  const nameParts = fullName.split(" ").filter(Boolean);
  const firstName = normalizeToken(nameParts[0] ?? "");
  const lastName = normalizeToken(nameParts[nameParts.length - 1] ?? "");
  const initials = normalizeToken(nameParts.map((part) => part[0] ?? "").join(""));
  const birthYear = privateIdentity.private_fields.birth_date_iso.slice(0, 4);
  const email = privateIdentity.private_fields.primary_email.toLowerCase().trim();
  const [emailLocalPart, emailDomain = ""] = email.split("@");

  const bundle: RenderSafeOwnerAnchorBundle = {
    version: "nyra_owner_render_anchor_bundle_v1",
    generated_at: nowIso(),
    scope: "render_safe_shadow_runtime",
    owner_ref: "owner_primary",
    policy: [
      "render-safe bundle: hashed anchors only",
      "do not expose raw sensitive identifiers in runtime or chat",
      "SkinHarmony or public web signals are insufficient as primary owner proof",
      "prefer owner-only anchors and composite matches for continuity and return",
    ],
    thresholds: {
      accept_score: 0.72,
      strong_score: 0.9,
      exact_score: 0.99,
      min_anchor_signals: 2,
    },
    exact_anchors: anchor.anchors,
    derived_anchors: {
      normalized_full_name_sha256: sha256(fullName),
      first_name_sha256: sha256(firstName),
      last_name_sha256: sha256(lastName),
      initials_sha256: sha256(initials),
      birth_year_sha256: sha256(birthYear),
      email_local_part_sha256: sha256(emailLocalPart),
      email_domain_sha256: sha256(emailDomain),
    },
    composite_anchors: {
      full_name_birth_sha256: sha256(`${fullName}|${privateIdentity.private_fields.birth_date_iso}`),
      full_name_email_local_sha256: sha256(`${fullName}|${emailLocalPart}`),
      last_name_birth_year_sha256: sha256(`${lastName}|${birthYear}`),
    },
    notes: [
      "bundle does not carry raw name, tax code, email, or birth date",
      "bundle is intended for render shadow runtime recognition only",
      "exact tax or composite name+birth/email-local should dominate recognition",
    ],
  };

  mkdirSync(RUNTIME_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(bundle, null, 2));
  console.log(JSON.stringify({
    ok: true,
    version: bundle.version,
    output_path: OUTPUT_PATH,
    owner_ref: bundle.owner_ref,
  }, null, 2));
}

main();
