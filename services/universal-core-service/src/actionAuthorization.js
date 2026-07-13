function cleanReference(value) {
  return String(value || "")
    .slice(0, 240)
    .replace(/\b(?:password|passwd|secret|api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]")
    .trim();
}

export function buildActionAuthorization(decisionContract = {}, body = {}) {
  const ownerConfirmed = body.owner_confirmed === true;
  const exactCommit = /^[a-f0-9]{40}$/i.test(String(body.target_commit || ""));
  const reversibleDeploy =
    body.operation_class === "reversible_owner_confirmed_deploy" &&
    String(body.action_type || "").toLowerCase() === "deploy" &&
    body.external_side_effect === true &&
    body.contains_customer_data === false &&
    body.cross_tenant === false &&
    body.rollback_ready === true &&
    body.audit_ready === true &&
    body.configuration_changes === false &&
    exactCommit &&
    cleanReference(body.confirmation_reference).length > 0;
  const confirmationRequired = decisionContract.control_level === "confirm" || reversibleDeploy;
  const confirmationSatisfied = confirmationRequired && ownerConfirmed;
  const reversibleInternalWrite =
    body.operation_class === "reversible_internal_collaboration_write" &&
    body.external_side_effect === false &&
    body.contains_customer_data === false &&
    body.rollback_ready === true;
  const hardBlocked = decisionContract.state === "blocked" ||
    decisionContract.recommended_actions?.some?.((action) => action.blocked === true) === true;
  const authorizedScope = reversibleInternalWrite || reversibleDeploy;
  const executionAllowed = Boolean(
    authorizedScope &&
    !hardBlocked &&
    decisionContract.risk_band === "low" &&
    (!confirmationRequired || confirmationSatisfied)
  );

  return {
    allowed: executionAllowed,
    state: executionAllowed
      ? confirmationSatisfied ? "authorized_after_confirmation" : "authorized"
      : hardBlocked ? "blocked" : confirmationRequired && !confirmationSatisfied ? "confirmation_required" : "not_authorized",
    mediation: executionAllowed
      ? confirmationSatisfied ? "confirmed" : "allow"
      : hardBlocked ? "hard_block" : confirmationRequired && !confirmationSatisfied ? "confirm" : "defer",
    confirmation_required: confirmationRequired,
    confirmation_satisfied: confirmationSatisfied,
    confirmation_reference: confirmationSatisfied
      ? cleanReference(body.confirmation_reference) || "explicit_owner_confirmation"
      : null,
    scope: reversibleInternalWrite
      ? "reversible_internal_collaboration_write"
      : reversibleDeploy
        ? "reversible_owner_confirmed_deploy"
        : "evaluation_only",
    target_commit: reversibleDeploy ? String(body.target_commit).toLowerCase() : null,
  };
}
