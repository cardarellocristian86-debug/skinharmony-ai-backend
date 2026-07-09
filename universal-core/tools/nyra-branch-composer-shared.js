function summarizeActiveBranches(branchOverlay) {
  if (!branchOverlay || typeof branchOverlay !== "object") return "";
  const active = Array.isArray(branchOverlay.active_branches) ? branchOverlay.active_branches : [];
  const primary = branchOverlay.primary_branch && typeof branchOverlay.primary_branch === "object"
    ? branchOverlay.primary_branch.id || ""
    : "";
  return active.slice(0, 3).map((branch) => branch.id).join(", ") || primary;
}

function buildNyraBranchSummaryNotesData(bundle) {
  const notes = [
    `Rami attivi: ${summarizeActiveBranches(bundle.branch_overlay)}`,
    `Route: ${bundle.action_route?.intent || "unknown"}, modo ${bundle.action_route?.execution_mode || "unknown"}`,
    `Core: V2 ${bundle.core2_pipeline?.stages?.v2?.control_level || "unknown"}, V7 ${bundle.core2_pipeline?.stages?.v7?.path_label || "unknown"}`,
  ];
  if (bundle?.cortex_graph) {
    notes.push(
      `Cortex: profondita ${bundle.cortex_graph.max_depth}, rami ${bundle.cortex_graph.active_branch_count}/${bundle.cortex_graph.registry_branch_count}, fase ${bundle.cortex_graph.learning_cycle?.current_phase || "unknown"}`
    );
    if (bundle.cortex_graph.adaptive_cognition) {
      notes.push(
        `Adattamento: ${bundle.cortex_graph.adaptive_cognition.mode}, memoria ${bundle.cortex_graph.adaptive_cognition.memory_stack.join("/")}, limiti ${bundle.cortex_graph.adaptive_cognition.autonomy_limits.slice(0, 3).join("/")}`
      );
      const topHypothesis = bundle.cortex_graph.adaptive_cognition.runtime_reasoning?.hypothesis_ranking?.[0];
      const verifyGate = bundle.cortex_graph.adaptive_cognition.runtime_reasoning?.verify_before_escalation?.verification_gate;
      const memoryCandidate = bundle.cortex_graph.adaptive_cognition.runtime_reasoning?.memory_consolidation?.candidates?.[0];
      if (topHypothesis) {
        notes.push(
          `Ipotesi: ${topHypothesis.branch_id} ${topHypothesis.role} conf ${topHypothesis.confidence}`
        );
      }
      if (verifyGate) {
        notes.push(`Verify gate: ${verifyGate}`);
      }
      if (memoryCandidate) {
        notes.push(`Consolidamento: ${memoryCandidate.source_branch_id} -> ${memoryCandidate.kind}`);
      }
    }
  }
  return notes;
}

function buildNyraBranchSummaryLineData(bundle) {
  return buildNyraBranchSummaryNotesData(bundle).map((line) => `${line}.`).join(" ");
}

function buildNyraAnalyzerCoreOverlayLineData(overlay, practiceProfile) {
  const selected = Array.isArray(overlay?.selected_branches) ? overlay.selected_branches : [];
  if (!selected.length) return "";
  const head = selected[0];
  const tail = selected.slice(1);
  const joinTail = tail.length ? ` con ${tail.map((item) => item.label).join(" e ")}` : "";
  const practiceProfileId = typeof practiceProfile === "string"
    ? practiceProfile
    : practiceProfile?.id || "";

  if (practiceProfileId === "medical_dermatology") {
    return `Lettura guidata dai rami Core: il quadro va letto da ${head.label}${joinTail}, con percorso ${overlay?.v7?.path_label || "normal"} e correlazione prudente dei segni osservabili.`;
  }
  if (practiceProfileId === "pharmacy_dermocosmetic") {
    return `Lettura guidata dai rami Core: oggi il quadro si appoggia a ${head.label}${joinTail}, cosi la routine resta coerente e non si disperde su troppi fronti.`;
  }
  return `Lettura guidata dai rami Core: oggi il percorso parte da ${head.label}${joinTail}, perche e li che conviene concentrare la scelta operativa.`;
}

module.exports = {
  buildNyraBranchSummaryNotesData,
  buildNyraBranchSummaryLineData,
  buildNyraAnalyzerCoreOverlayLineData,
};
