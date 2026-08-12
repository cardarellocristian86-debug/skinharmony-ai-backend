import crypto from "node:crypto";

const canonical = (value) => JSON.stringify(value, Object.keys(value || {}).sort());

/**
 * Final, deterministic join for the generic Universal Core.  It is deliberately
 * fail-closed: a join cannot authorize enforced execution unless every upstream
 * gate is explicitly true and the durable store is restart-safe.
 */
export function recomputeGenericCoreJoin({ globalJoin, policyProof, storeReadiness, now = Date.now() } = {}) {
  const reasons = [];
  if (!globalJoin || globalJoin.join_decision !== "close") reasons.push("global_intent_join_blocked");
  if (!policyProof || policyProof.ok !== true) reasons.push("policy_proof_invalid");
  if (storeReadiness?.kind !== "postgresql") reasons.push("store_not_postgresql");
  if (storeReadiness?.restart_durable !== true) reasons.push("store_not_restart_durable");
  if (storeReadiness?.distributed !== true) reasons.push("store_not_distributed");
  if (policyProof?.expires_at && Date.parse(policyProof.expires_at) < now) reasons.push("policy_proof_expired");
  const decision = reasons.length ? "block" : "allow";
  const result = { schema: "nyra.generic-core-join/1.0", decision, reasons, joined_at: new Date(now).toISOString() };
  result.join_digest = `sha256:${crypto.createHash("sha256").update(canonical(result)).digest("hex")}`;
  return result;
}
