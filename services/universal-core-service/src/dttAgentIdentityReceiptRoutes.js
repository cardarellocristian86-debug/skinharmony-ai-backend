function attestationStatus(code) {
  if (["task_tree_not_found", "dtt_node_not_found"].includes(code)) return 404;
  if (["cross_tenant_task_tree_denied", "cross_work_task_tree_denied"].includes(code)) return 403;
  if (["dtt_work_binding_required", "dtt_agent_context_replayed"].includes(code)) return 409;
  if ([
    "dynamic_task_tree_state_corrupt",
    "dtt_agent_identity_store_corrupt",
    "dtt_verification_trust_store_corrupt",
  ].includes(code)) return 500;
  if (["dtt_work_binding_unavailable", "dtt_agent_identity_not_ready"].includes(code)) return 503;
  return 403;
}

export function mountDttAgentIdentityReceiptRoutes({
  app,
  auth,
  workAuth,
  assertTreeNode,
  receiptService,
  audit,
} = {}) {
  if (!app || typeof app.post !== "function") throw new Error("dtt_receipt_app_required");
  if (typeof auth !== "function") throw new Error("dtt_receipt_auth_required");
  if (typeof workAuth !== "function") throw new Error("dtt_receipt_work_auth_required");
  if (typeof assertTreeNode !== "function") throw new Error("dtt_receipt_tree_authorizer_required");

  app.post(
    "/v1/orchestration/dtt/:treeId/nodes/:nodeId/attestations",
    auth,
    workAuth,
    async (req, res) => {
      if (!receiptService?.configured) {
        return res.status(503).json({ ok: false, error: "dtt_agent_identity_not_ready" });
      }
      try {
        await assertTreeNode({
          tenant_id: req.tenantId,
          work_id: req.workId,
          tree_id: req.params.treeId,
          node_id: req.params.nodeId,
        });
        const issued = await receiptService.issue({
          context_token: req.get("x-sh-dtt-agent-context"),
          tenant_id: req.tenantId,
          work_id: req.workId,
          tree_id: req.params.treeId,
          node_id: req.params.nodeId,
          evidence_digest: req.body?.evidence_digest,
          decision: req.body?.decision,
          rationale: req.body?.rationale,
          assignment_id: req.body?.assignment_id,
          expected_principal: req.dttWorkBinding?.principal,
        });
        audit?.append?.("dtt_agent_identity_receipt_issued", {
          tenant_id: req.tenantId,
          work_id: req.workId,
          tree_id: req.params.treeId,
          node_id: req.params.nodeId,
          verifier_id: issued.verifier_id,
          receipt_id: issued.receipt_id,
        });
        return res.json({
          ok: true,
          tenant_id: req.tenantId,
          work_id: req.workId,
          tree_id: req.params.treeId,
          node_id: req.params.nodeId,
          verifier_id: issued.verifier_id,
          identity_receipt: issued.identity_receipt,
          execution_authorized: false,
        });
      } catch (error) {
        const code = error.message || "dtt_agent_identity_attestation_denied";
        audit?.append?.("dtt_agent_identity_receipt_denied", {
          tenant_id: req.tenantId,
          work_id: req.workId,
          tree_id: req.params.treeId,
          node_id: req.params.nodeId,
          reason: code,
        });
        return res.status(attestationStatus(code)).json({ ok: false, error: code });
      }
    },
  );
}
