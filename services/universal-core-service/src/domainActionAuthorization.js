import { evaluateSkinHarmonyMcpStagingAction } from "./domainAdapters/skinharmonyMcpStagingAction.js";

const DOMAIN_ACTION_ADAPTERS = Object.freeze([
  evaluateSkinHarmonyMcpStagingAction,
]);

const NONE = Object.freeze({
  reserved: false,
  claimed: false,
  eligible: false,
  hard_block: false,
});

export function evaluateDomainActionAuthorization(context = {}) {
  const results = [];
  for (const adapter of DOMAIN_ACTION_ADAPTERS) {
    try {
      results.push(adapter(context));
    } catch {
      return Object.freeze({
        reserved: true,
        claimed: true,
        eligible: false,
        hard_block: true,
        domain_action_id: "domain_action_adapter_error",
      });
    }
  }
  const reserved = results.filter((result) => result?.reserved === true);
  if (!reserved.length) return NONE;
  if (reserved.length > 1) {
    return Object.freeze({
      reserved: true,
      claimed: true,
      eligible: false,
      hard_block: true,
      domain_action_id: "ambiguous_domain_action",
    });
  }
  return reserved[0];
}
