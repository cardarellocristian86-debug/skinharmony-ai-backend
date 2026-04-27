import type { NyraConversationState, NyraDomain } from "./nyra-conversation-state.ts";

export function resolveDomainWithState(input: {
  intent: string;
  raw_domain?: NyraDomain;
  state: NyraConversationState;
}): NyraDomain {
  const { intent, raw_domain, state } = input;

  if (intent === "open") {
    if (raw_domain && (state.active_domain === "general" || state.active_domain === "unknown")) {
      return raw_domain;
    }
    return state.active_domain !== "unknown"
      ? state.active_domain
      : "general";
  }

  if (intent === "followup") {
    return state.active_domain;
  }

  if (raw_domain) {
    return raw_domain;
  }

  return state.active_domain;
}
