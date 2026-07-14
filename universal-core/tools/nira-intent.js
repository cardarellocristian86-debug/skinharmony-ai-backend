function normalized(text) {
  return String(text || "").toLowerCase().replace(/[_-]+/g, " ");
}

export function inferNiraIntent(text) {
  const value = normalized(text);
  if (/\b(secret|token|password|credential|api key|suite pay key|cross tenant|sicurezza|security)\b/.test(value)) return "security_review";
  if (/\b(apprend|learning|outcome|feedback|lezione|memoria)\w*/.test(value)) return "governed_learning";
  if (/\b(marketing|copy|campagna|claim|traduc|localizz)\w*/.test(value)) return "content_governance";
  if (/\b(analyzer|analisi pelle|protocollo|cosmet|beauty)\w*/.test(value)) return "analyzer_advisory";
  if (/\b(smart ?desk|agenda|cassa|magazzino|appuntament)\w*/.test(value)) return "smartdesk_operational_planning";
  if (/\b(suite|wordpress|plugin|landing|waas)\w*/.test(value) && /\b(test|verifica|collaudo|regression)\w*/.test(value)) return "suite_quality_verification";
  if (/\b(suite|wordpress|plugin|landing|waas)\w*/.test(value)) return "suite_operational_planning";
  if (/\b(render|runtime|hosting|deploy|release|scal)\w*/.test(value)) return "runtime_deployment_planning";
  if (/\b(code|codice|software|patch|test|verifica|collaudo|regression)\w*/.test(value)) return "software_quality_verification";
  if (/\b(read|list|get|status|health|audit|preview|leggi|elenca|stato|anteprima)\w*/.test(value)) return "read_current_state";
  if (/\b(orchestr|automat|runbook|implement|modific|crea)\w*/.test(value)) return "controlled_work_planning";
  return "general_operational_planning";
}

export function inferNiraTarget(text, explicit) {
  const value = normalized(text);
  if (["suite", "smartdesk", "wordpress", "analyzer"].includes(String(explicit || ""))) return explicit;
  if (/\bsmart ?desk\b/.test(value)) return "smartdesk";
  if (/\bwordpress\b|\bwp\b/.test(value)) return "wordpress";
  if (/\bsuite\b|\bwaas\b/.test(value)) return "suite";
  if (/\banalyzer\b|\bprotocollo\b|\bcosmet\w*\b|\bbeauty\b/.test(value)) return "analyzer";
  if (/\bcore\b/.test(value)) return "universal_core";
  return explicit === "universal_core" ? "generic" : explicit || "generic";
}

function scenario(id, label, actionId, actionLabel, category, values = {}) {
  return {
    id,
    label,
    action_id: actionId,
    action_label: actionLabel,
    category,
    severity: values.severity ?? 55,
    confidence: values.confidence ?? 78,
    expected_value: values.expected_value ?? 75,
    friction: values.friction ?? 20,
    reversibility: values.reversibility ?? 80,
    risk: values.risk ?? 30,
    execution_scope: values.execution_scope ?? "proposal",
  };
}

export function prepareContextualNiraScenarios(request = {}) {
  const text = normalized(request.text);
  const intent = inferNiraIntent(text);
  const scenarios = [scenario(
    "map_context",
    "Mappa contesto e stato reale",
    "action:read_current_state",
    "Leggere stato reale",
    "context",
    { severity: 30, confidence: 90, expected_value: 65, friction: 8, risk: 8, execution_scope: "read_only" },
  )];

  const add = (...items) => scenarios.push(...items);
  if (intent === "read_current_state") {
    add(scenario("read_tenant_state", "Leggi lo stato tenant-scoped", "action:read_tenant_state", "Lettura tenant-scoped", "read", {
      severity: 42, confidence: 94, expected_value: 82, friction: 6, risk: 6, execution_scope: "read_only",
    }));
  } else if (intent === "security_review") {
    add(scenario("security_guard", "Blocca segreti, bypass e accessi cross-tenant", "action:security_guard", "Applicare guard sicurezza", "security", {
      severity: 95, confidence: 94, expected_value: 98, friction: 5, risk: 95, execution_scope: "proposal",
    }));
  } else if (intent === "suite_operational_planning" || intent === "suite_quality_verification") {
    add(scenario("suite_plan", "Pianifica il lavoro nel perimetro Site Suite", "action:suite_scoped_plan", "Piano Site Suite", "suite", {
      severity: 62, confidence: 88, expected_value: 90, risk: 28, execution_scope: "proposal",
    }));
    if (/\b(implement|modific|patch|deploy|pubblic|scriv|crea)\w*/.test(text)) {
      add(scenario("suite_runbook", "Prepara runbook Suite scoped per Codex", "action:suite_codex_runbook", "Runbook Suite per Codex", "suite", {
        severity: 70, confidence: 86, expected_value: 92, risk: 55, execution_scope: "confirm_required",
      }));
    }
  } else if (intent === "smartdesk_operational_planning") {
    add(scenario("smartdesk_plan", "Pianifica il flusso operativo SmartDesk", "action:smartdesk_scoped_plan", "Piano SmartDesk", "smartdesk", {
      severity: 60, confidence: 87, expected_value: 88, risk: 34,
    }));
  } else if (intent === "analyzer_advisory") {
    add(scenario("analyzer_review", "Valuta evidenze e protocollo senza diagnosi automatica", "action:analyzer_advisory_review", "Review Analyzer", "analyzer", {
      severity: 64, confidence: 84, expected_value: 86, risk: 42,
    }));
  } else if (intent === "content_governance") {
    add(scenario("content_guard", "Verifica claim, lingua e approvazioni", "action:content_guard_review", "Review contenuto governato", "content", {
      severity: 66, confidence: 88, expected_value: 87, risk: 46,
    }));
  } else if (intent === "governed_learning") {
    add(scenario("verified_learning", "Consolida apprendimento solo da outcome verificato", "action:verified_learning_review", "Review apprendimento", "learning", {
      severity: 68, confidence: 90, expected_value: 89, risk: 35,
    }));
  } else if (intent === "runtime_deployment_planning") {
    add(scenario("runtime_readiness", "Verifica readiness, audit e rollback", "action:runtime_readiness", "Readiness runtime", "runtime", {
      severity: 68, confidence: 88, expected_value: 90, risk: 48,
    }));
    if (/\bdeploy\w*|\brelease\w*/.test(text)) {
      add(scenario("deployment_runbook", "Prepara deploy reversibile e owner-confirmed", "action:deployment_runbook", "Runbook deploy", "runtime", {
        severity: 78, confidence: 88, expected_value: 92, risk: 72, execution_scope: "confirm_required",
      }));
    }
  } else if (intent === "software_quality_verification") {
    add(scenario("software_verification", "Verifica patch, test e regressioni", "action:software_verification", "Verifica software", "software", {
      severity: 65, confidence: 90, expected_value: 90, risk: 32,
    }));
  } else if (intent === "controlled_work_planning") {
    add(scenario("controlled_runbook", "Prepara runbook controllato con evidenze", "action:prepare_controlled_runbook", "Preparare runbook controllato", "automation", {
      severity: 66, confidence: 82, expected_value: 88, risk: 48, execution_scope: "confirm_required",
    }));
  } else {
    add(scenario("core_rank_options", "Genera varianti e lascia scegliere al Core", "action:rank_variants_with_core", "Ranking varianti Core", "decision", {
      severity: 54, confidence: 84, expected_value: 86, friction: 18, risk: 24,
    }));
  }

  if (/\brender\b/.test(text) && /\b(deploy|runtime|hosting|service|control plane|handoff)\w*/.test(text)) {
    add(scenario("render_handoff", "Prepara handoff Render controllato", "action:render_control_plane_handoff", "Handoff Render controllato", "architecture", {
      severity: 70, confidence: 86, expected_value: 90, friction: 28, risk: 52, execution_scope: "confirm_required",
    }));
  }

  if (/\b(god mode|modalita dio|owner)\b/.test(text) || request.mode === "god_mode_owner_only") {
    add(scenario("owner_god_mode_bridge", "God Mode owner-only come orchestrazione, non bypass", "action:owner_only_god_mode_bridge", "God Mode owner-only", "owner_control", {
      severity: 62,
      confidence: request.owner_verified ? 86 : 35,
      expected_value: 78,
      friction: 16,
      risk: request.owner_verified ? 34 : 82,
      execution_scope: "confirm_required",
    }));
  }
  return scenarios;
}

export function selectedScenarioRequiresConfirmation(scenarios, actionId) {
  const normalizedId = String(actionId || "").replace(/^action:nira:/, "").replace(/^action:/, "");
  const selected = scenarios.find((item) => item.id === normalizedId || item.action_id === actionId);
  return selected?.execution_scope === "confirm_required";
}
