import { CausalContinuityError } from "./causalContinuityCanonical.js";
import { validateCausalBranchInvocation } from "./causalBranchContract.js";

const PROJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function verifiedActor(receipt, tenantId, authorityScope = []) {
  if (!receipt || typeof receipt !== "object" || (receipt.tenant_id && receipt.tenant_id !== tenantId)) {
    throw new CausalContinuityError("AGENT_CONTEXT_INVALID");
  }
  const actor_id = String(receipt.agent_id || "").trim();
  const session_fingerprint = String(receipt.session_fingerprint || "").trim();
  const actor_provenance = String(receipt.actor_provenance || "").trim();
  const client_type = String(receipt.client_type || "").trim();
  if (!actor_id || !session_fingerprint || !actor_provenance || !client_type) {
    throw new CausalContinuityError("AGENT_CONTEXT_INVALID");
  }
  return {
    tenant_id: tenantId,
    actor_id,
    actor_role: String(receipt.actor_role || "dtt_agent"),
    authority_scope: [...new Set([...authorityScope.map(String), ...(Array.isArray(receipt.authority_scope) ? receipt.authority_scope.map(String) : [])])].sort(),
    owner_confirmed: receipt.owner_confirmed === true,
    provenance: { session_fingerprint, actor_provenance, client_type },
  };
}
export function createCausalBranchEnforcer({ store, runtime, resolveAgentContext, now = () => new Date() } = {}) {
  if (!store || typeof store.readFeatureFlag !== "function") throw new TypeError("causal branch store required");
  if (!runtime || typeof runtime.causal_context_validate !== "function") throw new TypeError("causal branch runtime required");
  if (typeof resolveAgentContext !== "function") throw new TypeError("causal branch agent resolver required");

  return async function enforce({
    tenant_id, project_id, context, signature, agent_context_token, authority_scope = [], contract, output,
  } = {}) {
    const tenantId = String(tenant_id || "").trim();
    const candidateProjectId = String(context?.project_id || project_id || "").trim().toLowerCase();
    let rollout = { mode: "SHADOW", version: null, source: "global_compatible_shadow" };
    if (tenantId && PROJECT_ID.test(candidateProjectId)) {
      try {
        const flag = await store.readFeatureFlag({ tenant_id: tenantId, project_id: candidateProjectId });
        rollout = { mode: flag.mode, version: Number(flag.version), source: "project_feature_flag" };
      } catch (error) {
        if (error?.code !== "CAUSAL_NOT_FOUND") throw error;
      }
    }

    const structural = validateCausalBranchInvocation({
      context, contract, output, authenticatedTenantId: tenantId, now: now(),
    });
    let authoritative = { valid: false, code: "AGENT_CONTEXT_REQUIRED" };
    if (context && signature && agent_context_token) {
      try {
        const receipt = await resolveAgentContext(agent_context_token, tenantId);
        const actor = verifiedActor(receipt, tenantId, authority_scope);
        const validation = await runtime.causal_context_validate(actor, {
          envelope: context, signature, consume: false, expected_environment: context.environment,
        });
        authoritative = { valid: validation.valid === true, code: validation.valid === true ? "CAUSAL_CONTEXT_VERIFIED" : "CAUSAL_CONTEXT_INVALID", receipt: validation };
      } catch (error) {
        authoritative = { valid: false, code: String(error?.code || "CAUSAL_CONTEXT_INVALID") };
      }
    }

    const valid = structural.ok === true && authoritative.valid === true;
    const enforcementRequired = rollout.mode === "ENFORCE_NEW_WORK" || rollout.mode === "ENFORCE_ALL_COMPATIBLE";
    return {
      schema_version: "causal_branch_enforcement_v1",
      rollout,
      structural,
      authoritative_context: authoritative,
      enforcement_required: enforcementRequired,
      allowed: enforcementRequired ? valid : true,
      shadow_would_allow: valid,
      code: enforcementRequired && !valid ? "CAUSAL_BRANCH_CONTEXT_BLOCKED" : valid ? "CAUSAL_BRANCH_CONTEXT_VERIFIED" : "CAUSAL_BRANCH_SHADOW_OBSERVED",
    };
  };
}
