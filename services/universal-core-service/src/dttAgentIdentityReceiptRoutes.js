export function mountDttAgentIdentityReceiptRoutes({
  app,
  auth,
  receiptService,
  audit,
} = {}) {
  if (!app || typeof app.post !== "function") throw new Error("dtt_receipt_app_required");
  if (typeof auth !== "function") throw new Error("dtt_receipt_auth_required");

  app.post(
    "/v1/orchestration/dtt/:treeId/nodes/:nodeId/attestations",
    auth,
    async (req, res) => {
      if (!receiptService?.configured) {
        return res.status(503).json({ ok: false, error: "dtt_agent_identity_not_ready" });
      }
      try {
        const issued = await receiptService.issue({
          context_token: req.get("x-sh-dtt-agent-context"),
          tenant_id: req.tenantId,
          tree_id: req.params.treeId,
          node_id: req.params.nodeId,
          evidence_digest: req.body?.evidence_digest,
          decision: req.body?.decision,
          rationale: req.body?.rationale,
          assignment_id: req.body?.assignment_id,
        });
        audit?.append?.("dtt_agent_identity_receipt_issued", {
          tenant_id: req.tenantId,
          tree_id: req.params.treeId,
          node_id: req.params.nodeId,
          verifier_id: issued.verifier_id,
          receipt_id: issued.receipt_id,
        });
        return res.json({
          ok: true,
          tenant_id: req.tenantId,
          tree_id: req.params.treeId,
          node_id: req.params.nodeId,
          verifier_id: issued.verifier_id,
          identity_receipt: issued.identity_receipt,
        });
      } catch (error) {
        const code = error.message || "dtt_agent_identity_attestation_denied";
        audit?.append?.("dtt_agent_identity_receipt_denied", {
          tenant_id: req.tenantId,
          tree_id: req.params.treeId,
          node_id: req.params.nodeId,
          reason: code,
        });
        return res.status(code === "dtt_agent_context_replayed" ? 409 : 403).json({ ok: false, error: code });
      }
    },
  );
}
