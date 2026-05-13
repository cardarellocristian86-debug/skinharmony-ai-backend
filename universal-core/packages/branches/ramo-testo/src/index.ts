import { runUniversalCore } from "../../../core/src/index.ts";
import type {
  ControlLevel,
  UniversalCoreInput,
  UniversalCoreOutput,
  UniversalSignal,
  UniversalState,
} from "../../../contracts/src/index.ts";

export type TextGuardIssueType =
  | "spelling"
  | "accent"
  | "grammar"
  | "punctuation"
  | "style"
  | "readability"
  | "glossary"
  | "translation_mismatch"
  | "claim_risk"
  | "brand_tone"
  | "publish_safety";

export type TextGuardSeverity = "low" | "medium" | "high" | "blocker";

export type TextGuardIssue = {
  id: string;
  type: TextGuardIssueType;
  severity: TextGuardSeverity;
  start: number;
  end: number;
  original: string;
  suggestions: string[];
  message: string;
  reason: string;
  safe_to_auto_apply: boolean;
};

export type TextBranchInput = {
  request_id: string;
  generated_at: string;
  locale: string;
  tenant_id?: string;
  actor_id?: string;
  context:
    | "translation_editor"
    | "page_copy"
    | "suite_module"
    | "smartdesk"
    | "manual_review"
    | "dam"
    | "unknown";
  domain?: "page" | "suite" | "smartdesk" | "dam" | "manual";
  object_id?: string | number;
  key_path?: string;
  text: string;
  source_text?: string;
  issues: TextGuardIssue[];
};

export type TextBranchDecision = {
  request_id: string;
  state: UniversalState;
  confidence: number;
  risk_band: UniversalCoreOutput["risk"]["band"];
  control_level: ControlLevel;
  publish_safe: boolean;
  primary_action_id?: string;
  blocked_reasons: string[];
  recommended_actions: UniversalCoreOutput["recommended_actions"];
};

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(Math.max(value, min), max);
}

function severityScore(severity: TextGuardSeverity): number {
  switch (severity) {
    case "blocker":
      return 95;
    case "high":
      return 75;
    case "medium":
      return 50;
    case "low":
    default:
      return 25;
  }
}

function issueCategory(type: TextGuardIssueType): string {
  switch (type) {
    case "spelling":
    case "accent":
    case "grammar":
    case "punctuation":
      return "language_quality";
    case "style":
    case "readability":
    case "brand_tone":
      return "editorial_quality";
    case "glossary":
    case "translation_mismatch":
      return "translation_governance";
    case "claim_risk":
    case "publish_safety":
      return "compliance";
    default:
      return "text_quality";
  }
}

function issueTags(type: TextGuardIssueType): string[] {
  switch (type) {
    case "claim_risk":
      return ["content_guard", "claim", "compliance"];
    case "publish_safety":
      return ["content_guard", "publish_safety", "compliance"];
    case "glossary":
      return ["content_guard", "glossary", "translation"];
    case "translation_mismatch":
      return ["content_guard", "translation_mismatch", "translation"];
    case "brand_tone":
      return ["content_guard", "brand_tone", "style"];
    case "readability":
      return ["content_guard", "readability", "style"];
    case "style":
      return ["content_guard", "style"];
    default:
      return ["content_guard", "language"];
  }
}

function expectedValue(type: TextGuardIssueType, severity: TextGuardSeverity): number {
  if (type === "claim_risk" || type === "publish_safety") return 90;
  if (type === "glossary" || type === "translation_mismatch") return 72;
  if (type === "brand_tone" || type === "readability" || type === "style") return severityScore(severity);
  return clamp(severityScore(severity) - 10);
}

function reversibility(type: TextGuardIssueType, safeToAutoApply: boolean): number {
  if (type === "claim_risk" || type === "publish_safety") return 40;
  if (safeToAutoApply) return 92;
  return 70;
}

function friction(type: TextGuardIssueType, safeToAutoApply: boolean): number {
  if (type === "claim_risk" || type === "publish_safety") return 65;
  if (safeToAutoApply) return 12;
  return 28;
}

function buildSignals(input: TextBranchInput): UniversalSignal[] {
  return input.issues.map((issue) => {
    const score = severityScore(issue.severity);
    return {
      id: `text:${issue.id}`,
      source: "content_guard",
      category: issueCategory(issue.type),
      label: issue.message,
      value: score,
      normalized_score: score,
      severity_hint: score,
      confidence_hint: issue.type === "claim_risk" || issue.type === "publish_safety" ? 88 : 82,
      reliability_hint: issue.type === "claim_risk" || issue.type === "publish_safety" ? 90 : 78,
      friction_hint: friction(issue.type, issue.safe_to_auto_apply),
      risk_hint: issue.type === "claim_risk" || issue.type === "publish_safety" ? clamp(score + 10) : score,
      reversibility_hint: reversibility(issue.type, issue.safe_to_auto_apply),
      expected_value_hint: expectedValue(issue.type, issue.severity),
      evidence: [
        { label: "type", value: issue.type },
        { label: "severity", value: issue.severity },
        { label: "original", value: issue.original },
      ],
      tags: issueTags(issue.type),
    };
  });
}

export function mapTextBranchToUniversal(input: TextBranchInput): UniversalCoreInput {
  const blockedActions =
    input.issues.some((issue) => issue.type === "claim_risk" || issue.type === "publish_safety" || issue.severity === "blocker")
      ? ["publish", "auto_publish", "public_sync"]
      : [];

  return {
    request_id: input.request_id,
    generated_at: input.generated_at,
    domain: "custom",
    context: {
      actor_id: input.actor_id,
      tenant_id: input.tenant_id,
      locale: input.locale,
      mode: "content_guard",
      metadata: {
        branch: "ramo-testo",
        text_context: input.context,
        content_domain: input.domain ?? "manual",
        object_id: input.object_id,
        key_path: input.key_path,
        source_text_present: Boolean(input.source_text),
      },
    },
    signals: buildSignals(input),
    data_quality: {
      score: input.text.trim().length ? 90 : 20,
      completeness: input.text.trim().length ? 95 : 0,
      consistency: input.source_text ? 88 : 76,
      reliability: 82,
      missing_fields: input.text.trim().length ? [] : ["text"],
    },
    constraints: {
      allow_automation: false,
      require_confirmation: true,
      max_control_level: "confirm",
      blocked_actions: blockedActions,
      permissions: ["content_guard_review"],
      safety_mode: true,
    },
  };
}

export function runTextBranch(input: TextBranchInput): TextBranchDecision {
  const output = runUniversalCore(mapTextBranchToUniversal(input));
  return {
    request_id: output.request_id,
    state: output.state,
    confidence: output.confidence,
    risk_band: output.risk.band,
    control_level: output.control_level,
    publish_safe: !output.blocked_reasons.length && output.risk.band !== "blocked",
    primary_action_id: output.priority.primary_action_id,
    blocked_reasons: output.blocked_reasons,
    recommended_actions: output.recommended_actions,
  };
}
