import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type NyraDomain =
  | "general"
  | "strategy"
  | "mail"
  | "runtime"
  | "engineering"
  | "unknown";

export type NyraConversationState = {
  active_domain: NyraDomain;
  active_problem?: string;
  last_action?: string;
  risk_level: "low" | "medium" | "high";
  pending_goal?: string;
  return_anchor?: string;
  turn_count: number;
};

export function initConversationState(): NyraConversationState {
  return {
    active_domain: "general",
    risk_level: "low",
    turn_count: 0,
  };
}

export function loadConversationState(path: string): NyraConversationState {
  try {
    if (!existsSync(path)) return initConversationState();
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<NyraConversationState>;
    return {
      active_domain: parsed.active_domain ?? "general",
      active_problem: parsed.active_problem,
      last_action: parsed.last_action,
      risk_level: parsed.risk_level ?? "low",
      pending_goal: parsed.pending_goal,
      return_anchor: parsed.return_anchor,
      turn_count: Number(parsed.turn_count ?? 0),
    };
  } catch {
    return initConversationState();
  }
}

export function saveConversationState(path: string, state: NyraConversationState): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2));
}

export function updateConversationState(
  state: NyraConversationState,
  input: {
    user_text: string;
    intent: string;
    detected_domain?: NyraDomain;
    risk?: number;
    last_action?: string;
  },
): NyraConversationState {
  const next = { ...state };

  next.turn_count += 1;

  if (
    input.detected_domain &&
    (
      (input.intent !== "open" && input.intent !== "relational") ||
      state.active_domain === "general" ||
      state.active_domain === "unknown"
    )
  ) {
    next.active_domain = input.detected_domain;
  }

  if (input.risk !== undefined) {
    if (input.risk > 0.7) next.risk_level = "high";
    else if (input.risk > 0.4) next.risk_level = "medium";
    else next.risk_level = "low";
  }

  if (input.intent === "operational" || input.intent === "priority") {
    next.active_problem = input.user_text;
    next.pending_goal = input.user_text;
  }

  if (!next.active_problem && input.detected_domain && input.detected_domain !== "general" && input.detected_domain !== "unknown") {
    next.active_problem = input.user_text;
    next.pending_goal = input.user_text;
  }

  if (input.intent === "relational") {
    next.active_domain = "general";
    next.return_anchor = undefined;
  }

  if ((input.intent === "followup" || input.intent === "open") && state.active_problem && !next.return_anchor) {
    next.return_anchor = state.active_problem;
  }

  if (input.intent === "open") {
    next.return_anchor = state.active_problem;
  }

  if (input.last_action) {
    next.last_action = input.last_action;
  }

  return next;
}
