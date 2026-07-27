import {
  evaluateSkinHarmonyMcpStagingTopologyAction,
} from "./domainAdapters/skinharmonyMcpStagingTopologyAction.js";

const DOMAIN_ACTION_ADAPTERS = Object.freeze([
  evaluateSkinHarmonyMcpStagingTopologyAction,
]);

const NONE = Object.freeze({
  reserved: false,
  claimed: false,
  eligible: false,
  hard_block: false,
});

export function evaluateDomainActionAuthorization(context = {}) {
  const reserved = [];
  for (const adapter of DOMAIN_ACTION_ADAPTERS) {
    try {
      const result = adapter(context);
      if (result?.reserved === true) reserved.push(result);
    } catch {
      return Object.freeze({
        reserved: true,
        claimed: true,
        eligible: false,
        hard_block: true,
        confirmation_required: true,
        confirmation_satisfied: false,
        domain_action_id: "domain_action_adapter_error",
        reason: "domain_action_adapter_error",
      });
    }
  }
  if (!reserved.length) return NONE;
  if (reserved.length > 1) {
    return Object.freeze({
      reserved: true,
      claimed: true,
      eligible: false,
      hard_block: true,
      confirmation_required: true,
      confirmation_satisfied: false,
      domain_action_id: "ambiguous_domain_action",
      reason: "ambiguous_domain_action",
    });
  }
  return reserved[0];
}
