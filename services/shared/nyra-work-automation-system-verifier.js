import crypto from "node:crypto";

// The verifier is a server-assigned identity, never a caller-selected role.
// Keep its derivation shared by the MCP gateway and Universal Core so an
// automation receipt cannot describe a different verifier at either boundary.
export function deriveNyraWorkAutomationSystemVerifierId({ tenantId, workId } = {}) {
  const tenant = String(tenantId || "").trim();
  const work = String(workId || "").trim();
  if (!tenant || !work) throw new Error("nyra_work_automation_system_verifier_binding_invalid");
  const digest = crypto.createHash("sha256").update(`${tenant}\u0000${work}`).digest("hex");
  return `system_verifier_${digest.slice(0, 24)}`;
}
