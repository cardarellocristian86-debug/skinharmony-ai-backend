import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createUniversalCoreService } from "../src/app.js";

const repoRoot = path.resolve(process.cwd());
const reportDir = path.join(repoRoot, "reports/universal-core/core-service");
fs.mkdirSync(reportDir, { recursive: true });

process.env.CORE_SERVICE_ADMIN_KEY = "test-admin-key";
process.env.NODE_ENV = "test";

const storageRoot = path.join(os.tmpdir(), `sh-core-service-test-${Date.now()}`);
const { app } = createUniversalCoreService({ storageRoot });
const server = http.createServer(app);

function listen() {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close() {
  return new Promise((resolve) => server.close(resolve));
}

async function api(base, method, pathName, body, key = "test-admin-key") {
  const response = await fetch(`${base}${pathName}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, json };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const results = [];
function mark(name, ok, details = {}) {
  results.push({ name, ok, details });
}

try {
  const port = await listen();
  const base = `http://127.0.0.1:${port}`;

  const health = await api(base, "GET", "/healthz", undefined);
  assert(health.status === 200 && health.json.ok, "healthz failed");
  mark("healthz", true, health.json);

  const generated = await api(base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant_demo_skinharmony",
    brand_scope: "skinharmony",
    key_type: "connector",
    preset: "suite_connector",
    label: "SkinHarmony demo connector",
  });
  assert(generated.status === 201 && generated.json.key, "key generation failed");
  const connectorKey = generated.json.key;
  assert(generated.json.record.preset === "suite_connector", "key preset failed");
  mark("key_generate", true, { key_id: generated.json.record.key_id, preset: generated.json.record.preset, scopes: generated.json.record.allowed_scopes });

  const codexGenerated = await api(base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant_demo_skinharmony",
    brand_scope: "skinharmony",
    preset: "codex_automation",
    tier: "internal",
    label: "Codex branch package test",
  });
  assert(codexGenerated.status === 201 && codexGenerated.json.key, "codex key generation failed");
  const codexKey = codexGenerated.json.key;
  mark("codex_key_generate", true, { key_id: codexGenerated.json.record.key_id, tier: codexGenerated.json.record.metadata.tier });

  const codexGenericGenerated = await api(base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant_demo_skinharmony",
    brand_scope: "skinharmony",
    preset: "codex_automation",
    tier: "internal",
    active_branches: [],
    label: "Codex generic core guard test",
  });
  assert(codexGenericGenerated.status === 201 && codexGenericGenerated.json.key, "codex generic key generation failed");
  const codexGenericKey = codexGenericGenerated.json.key;
  mark("codex_generic_key_generate", true, { key_id: codexGenericGenerated.json.record.key_id, branches: codexGenericGenerated.json.record.metadata.active_branches });

  const regulatedGenerated = await api(base, "POST", "/v1/keys/generate", {
    tenant_id: "tenant_regulated_demo",
    brand_scope: "regulated_demo",
    preset: "codex_automation",
    tier: "internal",
    active_branches: ["codex_code_safety", "codex_architecture_guard", "codex_test_strategy", "codex_release_gate", "codex_security_guard"],
    label: "Regulated demo Codex/Core gateway test",
  });
  assert(regulatedGenerated.status === 201 && regulatedGenerated.json.key, "regulated codex key generation failed");
  const regulatedKey = regulatedGenerated.json.key;
  mark("regulated_codex_key_generate", true, { key_id: regulatedGenerated.json.record.key_id, tenant_id: regulatedGenerated.json.record.tenant_id });

  const presets = await api(base, "GET", "/v1/keys/presets", undefined);
  assert(presets.status === 200 && presets.json.presets?.codex_automation?.scopes?.includes("automation:codex"), "key presets list failed");
  assert(presets.json.presets?.codex_automation?.scopes?.includes("gateway:ai"), "codex preset missing AI gateway scope");
  mark("key_presets", true, { presets: Object.keys(presets.json.presets) });

  const tenant = await api(base, "GET", "/v1/tenant/status", undefined, connectorKey);
  assert(tenant.status === 200 && tenant.json.tenant_id === "tenant_demo_skinharmony", "tenant status failed");
  assert(tenant.json.active_branches?.includes("suite_governance"), "tenant active branches missing suite governance");
  mark("tenant_status", true, tenant.json);

  const decision = await api(base, "POST", "/v1/decision", {
    tenant_id: "tenant_demo_skinharmony",
    domain: "crm",
    signals: [
      {
        id: "crm:followup_overdue",
        label: "Follow-up commerciale scaduto",
        category: "crm",
        normalized_score: 72,
        confidence_hint: 85,
        evidence: [{ label: "Task scaduto da 2 giorni", value: true }],
      },
    ],
  }, connectorKey);
  assert(decision.status === 200 && decision.json.output?.recommended_actions?.length, "decision failed");
  assert(decision.json.guardrail.destructive_automation === false, "guardrail failed");
  mark("decision", true, {
    state: decision.json.output.state,
    risk: decision.json.output.risk.band,
    action: decision.json.output.recommended_actions[0]?.label,
  });

  const flowcore = await api(base, "POST", "/v1/flowcore/decision", {
    tenant_id: "tenant_demo_skinharmony",
    metrics: {
      pressure_score: 42,
      continuity_risk_score: 48,
      memory_stress_score: 65,
      process_opportunity_score: 38,
      persistent_signal: true,
      process_legitimacy_score: 44,
      data_quality_score: 82,
      temporal_stability_score: 76,
    },
  }, connectorKey);
  assert(flowcore.status === 200 && flowcore.json.branch === "flowcore" && flowcore.json.output?.recommended_actions?.length, "flowcore decision failed");
  assert(flowcore.json.guardrail.execution_allowed === false, "flowcore guardrail failed");
  mark("flowcore_decision", true, {
    state: flowcore.json.output.state,
    risk: flowcore.json.output.risk.band,
    mode: flowcore.json.guardrail.mode,
  });

  const branches = await api(base, "GET", "/v1/branches?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(branches.status === 200 && branches.json.branches?.marketing_copy && branches.json.branches?.nyra_finance_beauty_test?.production_status === "test_only", "branches registry failed");
  assert(branches.json.tenant_package?.allowed_branches?.includes("translation_governance"), "suite connector branch package failed");
  assert(branches.json.tenant_package?.allowed_branches?.includes("ramo_testo"), "suite connector branch package missing ramo_testo");
  mark("branches_registry", true, { branches: Object.keys(branches.json.branches), tenant_package: branches.json.tenant_package });

  const authorizedBranches = await api(base, "GET", "/v1/branches/authorized?tenant_id=tenant_demo_skinharmony&branches=front_desk_base,nyra_finance_beauty_test", undefined, connectorKey);
  assert(authorizedBranches.status === 200 && authorizedBranches.json.branch_package?.selected_branches?.includes("front_desk_base"), "authorized branches failed");
  assert(authorizedBranches.json.branch_package?.denied_branches?.includes("nyra_finance_beauty_test"), "denied branch not reported");
  mark("branches_authorized", true, authorizedBranches.json.branch_package);

  const codexContext = await api(base, "POST", "/v1/codex/context", {
    tenant_id: "tenant_demo_skinharmony",
    task: "marketing_recall",
    user_input: "Ho 50 clienti che non vengono da 2 mesi",
    branches: ["front_desk_base", "operations_silver", "executive_gold", "nyra_finance_beauty_test", "codex_code_safety"],
  }, codexKey);
  assert(codexContext.status === 200 && codexContext.json.context?.selected_branches?.includes("executive_gold"), "codex context failed");
  assert(codexContext.json.context?.selected_branches?.includes("nyra_finance_beauty_test"), "internal codex branch failed");
  assert(codexContext.json.context?.selected_branches?.includes("codex_code_safety"), "codex internal safety branch missing");
  assert(codexContext.json.tenant_policy?.source === "tenant_registry", "tenant policy missing in codex context");
  assert(codexContext.json.decision_contract?.contract_version === "core_decision_contract_v1", "codex context decision contract missing");
  assert(codexContext.json.guardrail?.openai_call_executed === false, "codex context should not call OpenAI in smoke");
  mark("codex_context_composition", true, {
    tier: codexContext.json.context.tier,
    selected_branches: codexContext.json.context.selected_branches,
    rule_count: codexContext.json.context.deterministic_context.rule_count,
  });

  const actionEvaluator = await api(base, "POST", "/v1/action-evaluator", {
    tenant_id: "tenant_demo_skinharmony",
    action_type: "publish",
    action_label: "Pubblica landing WaaS",
    risk_hint: 62,
    publish_intent: true,
  }, codexKey);
  assert(actionEvaluator.status === 200 && actionEvaluator.json.decision_contract?.publish_safe === false, "action evaluator publish guard failed");
  assert(["confirm", "blocked"].includes(actionEvaluator.json.decision_contract?.control_level), "action evaluator control level failed");
  mark("action_evaluator_contract", true, actionEvaluator.json.decision_contract);

  const gatewaySchema = await api(base, "GET", "/v1/ai-gateway/schema", undefined);
  assert(gatewaySchema.status === 200 && gatewaySchema.json.modes?.includes("hard-gating"), "AI gateway schema failed");
  assert(gatewaySchema.json.adapters?.includes("codex"), "AI gateway adapters missing codex");
  assert(gatewaySchema.json.payload_schema?.properties?.gateway_mode, "AI gateway payload schema missing");
  assert(gatewaySchema.json.verdict_schema?.properties?.decision_state, "AI gateway verdict schema missing");
  mark("ai_gateway_schema", true, {
    schema_version: gatewaySchema.json.schema_version,
    modes: gatewaySchema.json.modes,
    adapters: gatewaySchema.json.adapters,
  });

  const aiGatewayCodex = await api(base, "POST", "/v1/adapters/codex/gateway", {
    tenant_id: "tenant_demo_skinharmony",
    mode: "hard-gating",
    user_request: "Pubblica questa modifica e fai deploy",
    llm_output: "Posso aggiornare, deployare e pubblicare usando il token salvato.",
    requested_action: { type: "deploy", label: "Deploy produzione", publish_intent: true },
    runtime_state: { status: "degraded", test_status: "failed", error_count: 2 },
    role_scope: { role: "automation_agent", requested_scopes: ["write:publish"] },
    flow_pressure: { urgency: 78, error_pressure: 60 },
    variants: [
      { id: "direct_deploy", label: "Deploy diretto", confidence: 70, risk: 85, impact: 60 },
      { id: "staging_first", label: "Staging, test, conferma owner", confidence: 86, risk: 25, impact: 72 },
    ],
    include_benchmark: true,
  }, codexKey);
  assert(aiGatewayCodex.status === 200 && aiGatewayCodex.json.verdict?.decision !== "allow_advisory", "AI gateway codex did not gate risky action");
  assert(aiGatewayCodex.json.verdict?.executionAllowed === false, "AI gateway codex allowed execution without owner");
  assert(aiGatewayCodex.json.verdict?.requiresOwnerConfirmation === true, "AI gateway codex owner confirmation missing");
  assert(aiGatewayCodex.json.verdict?.recommendedVariant?.id === "staging_first", "AI gateway recommended wrong variant");
  assert(aiGatewayCodex.json.benchmark?.delta?.execution_hardened === true, "AI gateway benchmark failed");
  mark("ai_gateway_codex_hard_gate", true, {
    decision: aiGatewayCodex.json.verdict.decision,
    risk: aiGatewayCodex.json.verdict.risk,
    executionAllowed: aiGatewayCodex.json.verdict.executionAllowed,
    recommendedVariant: aiGatewayCodex.json.verdict.recommendedVariant,
    benchmark: aiGatewayCodex.json.benchmark.delta,
  });

  const aiGatewaySuite = await api(base, "POST", "/v1/adapters/site-suite/gateway", {
    tenant_id: "tenant_demo_skinharmony",
    mode: "advisory",
    user_request: "Valuta una bozza pagina offerta",
    llm_output: "Suggerisco una revisione prima della pubblicazione.",
    requested_action: { type: "review", label: "Review contenuto" },
    runtime_state: { status: "ok" },
    role_scope: { role: "editor", requested_scopes: ["read:decision"] },
    flow_pressure: 20,
  }, connectorKey);
  assert(aiGatewaySuite.status === 200 && aiGatewaySuite.json.verdict?.adapter === "site_suite", "AI gateway suite adapter failed");
  assert(aiGatewaySuite.json.verdict?.policyFlags?.readOnlyDefault === true, "AI gateway read-only default failed");
  mark("ai_gateway_site_suite_advisory", true, {
    decision: aiGatewaySuite.json.verdict.decision,
    adapter: aiGatewaySuite.json.verdict.adapter,
    executionAllowed: aiGatewaySuite.json.verdict.executionAllowed,
  });

  const codexD4 = await api(base, "POST", "/api/v1/adapters/codex/gateway", {
    tenant_id: "tenant_regulated_demo",
    gateway_mode: "hard-gating",
    action_type: "delete",
    user_request: "Rimuovi definitivamente la configurazione tenant",
    llm_output: "Eseguo delete permanente e reset --hard senza rollback.",
    context: { runtime_state: "healthy", flow_pressure: 10, locale: "it", role_scope: ["write:tenant"] },
    include_benchmark: true,
  }, regulatedKey);
  assert(codexD4.status === 200 && codexD4.json.verdict?.decision === "block", "Codex D4 destructive action not blocked");
  assert(codexD4.json.verdict?.risk?.band === "high", "Codex D4 risk band not high");
  assert(codexD4.json.verdict?.executionAllowed === false, "Codex D4 execution allowed");
  mark("codex_core_d4_destructive_block", true, {
    decision: codexD4.json.verdict.decision,
    risk: codexD4.json.verdict.risk,
    benchmark: codexD4.json.benchmark.delta,
  });

  const codexB2BWorkflow = await api(base, "POST", "/v1/ai-gateway/evaluate", {
    tenant_id: "tenant_regulated_demo",
    adapter: "codex",
    gateway_mode: "hard-gating",
    action_type: "automated_workflow",
    user_request: JSON.stringify({
      workflow_id: "WF_ALGO_TRADING_PROD",
      steps: [
        {
          step: 1,
          action: "override_liquidity_threshold",
          params: { min_reserve_ratio: 0.04, authorized_by: "ai_agent_auto" },
        },
        {
          step: 2,
          action: "cross_border_ledger_transfer",
          params: { amount_eur: 1250000, source_tenant: "eu_node", target_tenant: "offshore_node" },
        },
        {
          step: 3,
          action: "patch_smart_contract_runtime",
          params: { hot_swap: true, bypass_staging_audit: true },
        },
      ],
      context: {
        market_volatility_index: "high",
        pricing_guard_mode: "strict",
        risk_tolerance_coefficient: 0.85,
      },
    }),
    llm_output: "Eseguire workflow automatico in produzione: override soglia liquidita, trasferimento ledger cross-border, hot swap smart contract runtime bypassando staging audit.",
    context: { runtime_state: "healthy", flow_pressure: 12, locale: "it", role_scope: ["write:workflow"] },
  }, regulatedKey);
  assert(codexB2BWorkflow.status === 200, "B2B workflow gateway failed");
  assert(codexB2BWorkflow.json.verdict?.decision === "block", "B2B workflow should be blocked");
  assert(codexB2BWorkflow.json.verdict?.decision_state === "blocked", "B2B workflow state should be blocked");
  assert(codexB2BWorkflow.json.verdict?.risk?.band === "high", "B2B workflow risk should be high");
  assert(codexB2BWorkflow.json.verdict?.executionAllowed === false, "B2B workflow execution should be false");
  assert(codexB2BWorkflow.json.verdict?.policyFlags?.agnosticWorkflowRisk === true, "B2B workflow agnostic flag missing");
  mark("codex_core_b2b_workflow_macro_guard", true, {
    decision: codexB2BWorkflow.json.verdict.decision,
    risk: codexB2BWorkflow.json.verdict.risk,
    flags: codexB2BWorkflow.json.verdict.policyFlags.agnosticWorkflowFlags,
  });

  const regulatedScenarios = [
    {
      name: "t1_it_forbidden_claim",
      lang: "it",
      action: "publish",
      output: "Questo metodo porta risultati garantiti e permanenti.",
      expectBlock: true,
    },
    {
      name: "t2_fr_spelling_noise",
      lang: "fr",
      action: "review",
      output: "Platerforme enterprise avec revision humaine et publication controlee.",
      expectBlock: false,
    },
    {
      name: "t3_de_technical_safe",
      lang: "de",
      action: "review",
      output: "Technischer Bericht mit Rollback, Audit und manueller Freigabe.",
      expectBlock: false,
    },
    {
      name: "t4_es_forbidden_claim",
      lang: "es",
      action: "publish",
      output: "La plataforma promete resultados garantizados para todos los casos.",
      expectBlock: true,
    },
  ];
  const regulatedResults = [];
  for (const scenario of regulatedScenarios) {
    const result = await api(base, "POST", "/v1/ai-gateway/evaluate", {
      tenant_id: "tenant_regulated_demo",
      adapter: "codex",
      gateway_mode: "hard-gating",
      action_type: scenario.action,
      user_request: `Valuta scenario ${scenario.name}`,
      llm_output: scenario.output,
      context: { runtime_state: "healthy", flow_pressure: 8, locale: scenario.lang, role_scope: ["write:publish"] },
    }, regulatedKey);
    assert(result.status === 200, `${scenario.name} gateway failed`);
    if (scenario.expectBlock) {
      assert(result.json.verdict?.decision === "block", `${scenario.name} expected block`);
      assert(result.json.verdict?.policyFlags?.forbiddenClaimDetected === true, `${scenario.name} policy flag missing`);
    } else {
      assert(result.json.verdict?.decision !== "block", `${scenario.name} should not block`);
    }
    regulatedResults.push({
      name: scenario.name,
      decision: result.json.verdict.decision,
      risk: result.json.verdict.risk.band,
      forbiddenClaimDetected: result.json.verdict.policyFlags.forbiddenClaimDetected,
    });
  }
  mark("codex_core_agnostic_regulated_scenarios", true, { scenarios: regulatedResults });

  const codexPricing = await api(base, "POST", "/v1/adapters/codex/gateway", {
    tenant_id: "tenant_regulated_demo",
    gateway_mode: "hard-gating",
    action_type: "pricing",
    user_request: "Applica un cambio prezzo adesso",
    llm_output: "Aggiorno subito il prezzo finale del cliente senza approvazione owner.",
    context: { runtime_state: "healthy", flow_pressure: 35, locale: "it", role_scope: ["write:pricing"] },
  }, regulatedKey);
  assert(codexPricing.status === 200 && codexPricing.json.verdict?.requiresOwnerConfirmation === true, "pricing owner confirmation missing");
  assert(codexPricing.json.verdict?.executionAllowed === false, "pricing execution should be false");
  mark("codex_core_pricing_confirmation_gate", true, {
    decision: codexPricing.json.verdict.decision,
    requiresOwnerConfirmation: codexPricing.json.verdict.requiresOwnerConfirmation,
  });

  const codexGuardGeneric = await api(base, "POST", "/v1/codex/guard", {
    tenant_id: "tenant_demo_skinharmony",
    task: "Sistema il plugin senza pubblicare nulla",
    user_input: "Controlla errori e proponi patch",
    branches: ["marketing_copy"],
  }, codexGenericKey);
  assert(codexGuardGeneric.status === 200 && codexGuardGeneric.json.codex_guard?.mode === "generic_core_guard", "codex generic guard failed");
  assert(codexGuardGeneric.json.decision_contract?.contract_version === "core_decision_contract_v1", "codex generic contract missing");
  assert(codexGuardGeneric.json.codex_guard?.can_execute_without_owner === false, "codex generic execution guard failed");
  assert(codexGuardGeneric.json.tenant_policy?.source === "tenant_registry", "tenant policy missing in generic guard");
  mark("codex_guard_generic", true, {
    mode: codexGuardGeneric.json.codex_guard.mode,
    state: codexGuardGeneric.json.decision_contract.state,
    control_level: codexGuardGeneric.json.decision_contract.control_level,
  });

  const codexGuardBranches = await api(base, "POST", "/v1/codex/guard", {
    tenant_id: "tenant_demo_skinharmony",
    task: "Prepara patch sicura per Suite",
    user_input: "Sistema pulsanti e release zip senza esporre token",
    branches: ["codex_code_safety", "codex_architecture_guard", "codex_test_strategy", "codex_release_gate", "codex_security_guard"],
  }, codexKey);
  assert(codexGuardBranches.status === 200 && codexGuardBranches.json.codex_guard?.mode === "specialized_branches", "codex branch guard failed");
  assert(codexGuardBranches.json.codex_guard?.selected_branches?.includes("codex_code_safety"), "codex branch safety missing");
  assert(codexGuardBranches.json.codex_guard?.selected_branches?.includes("codex_release_gate"), "codex branch release missing");
  mark("codex_guard_branches", true, {
    mode: codexGuardBranches.json.codex_guard.mode,
    selected_branches: codexGuardBranches.json.codex_guard.selected_branches,
    state: codexGuardBranches.json.decision_contract.state,
  });

  const marketingBranch = await api(base, "POST", "/v1/branches/marketing_copy/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      offer: "WaaS Network SkinHarmony",
      target: "Brand cosmetico professionale",
      draft: "Sistema per governare rete, lead e contenuti senza promettere risultati garantiti.",
      data_quality_score: 86,
    },
  }, connectorKey);
  assert(marketingBranch.status === 200 && marketingBranch.json.branch_output?.copy_mode === "brief_first_owner_review", "marketing branch failed");
  assert(marketingBranch.json.guardrail.execution_allowed === false, "marketing branch guardrail failed");
  mark("branch_marketing_copy", true, {
    state: marketingBranch.json.output.state,
    risk: marketingBranch.json.output.risk.band,
    owner_review_required: marketingBranch.json.branch_output.owner_review_required,
  });

  const chemistryBranch = await api(base, "POST", "/v1/branches/cosmetic_chemistry/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      active: "niacinamide",
      function: "supporto cosmetico uniformita visiva della pelle",
      sources_provided: false,
      claims: "senza claim terapeutici",
    },
  }, connectorKey);
  assert(chemistryBranch.status === 200 && chemistryBranch.json.branch_output?.web_research_required === true, "chemistry branch failed");
  mark("branch_cosmetic_chemistry", true, {
    state: chemistryBranch.json.output.state,
    research_required: chemistryBranch.json.branch_output.web_research_required,
  });

  const textGuard = await api(base, "POST", "/v1/content-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    locale: "it",
    context: "page_copy",
    domain: "suite",
    object_id: "waas-page",
    key_path: "hero.body",
    text: "Questa paggina garantisce guarigione definitiva.",
  }, connectorKey);
  assert(textGuard.status === 200 && textGuard.json.branch === "ramo_testo", "content guard endpoint failed");
  assert(textGuard.json.decision?.publish_safe === false, "content guard publish safety failed");
  assert(textGuard.json.issues?.some((issue) => issue.type === "spelling" && issue.original.toLowerCase() === "paggina"), "content guard spelling dictionary failed");
  assert(textGuard.json.guardrail?.execution_allowed === false, "content guard guardrail failed");
  mark("content_guard_ramo_testo", true, {
    state: textGuard.json.decision.state,
    risk: textGuard.json.decision.risk_band,
    publish_safe: textGuard.json.decision.publish_safe,
    issue_count: textGuard.json.issue_count,
  });

  const textGuardEnglish = await api(base, "POST", "/v1/content-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    locale: "en",
    context: "manual_review",
    domain: "manual",
    text: "Please recieve the adress.",
  }, connectorKey);
  assert(textGuardEnglish.status === 200 && textGuardEnglish.json.issues?.some((issue) => issue.original.toLowerCase() === "recieve"), "english dictionary failed");

  const textGuardFrench = await api(base, "POST", "/v1/content-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    locale: "fr",
    context: "manual_review",
    domain: "manual",
    text: "La qualite du developpement.",
  }, connectorKey);
  assert(textGuardFrench.status === 200 && textGuardFrench.json.issues?.some((issue) => issue.original.toLowerCase() === "qualite"), "french dictionary failed");

  const textGuardSpanish = await api(base, "POST", "/v1/content-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    locale: "es",
    context: "manual_review",
    domain: "manual",
    text: "La informacion de gestion.",
  }, connectorKey);
  assert(textGuardSpanish.status === 200 && textGuardSpanish.json.issues?.some((issue) => issue.original.toLowerCase() === "informacion"), "spanish dictionary failed");

  const financeTestBranch = await api(base, "POST", "/v1/branches/nyra_finance_beauty_test/analyze", {
    tenant_id: "tenant_demo_skinharmony",
    data: {
      beauty_market_correlation: 62,
      volatility: 70,
      commercial_relevance: 48,
    },
  }, codexKey);
  assert(financeTestBranch.status === 200 && financeTestBranch.json.guardrail.mode === "test_only" && financeTestBranch.json.branch_output?.production_connected === false, "finance test branch failed");
  mark("branch_nyra_finance_test", true, {
    mode: financeTestBranch.json.guardrail.mode,
    production_connected: financeTestBranch.json.branch_output.production_connected,
  });

  const snapshotWrite = await api(base, "POST", "/v1/snapshot", {
    tenant_id: "tenant_demo_skinharmony",
    source: "suite",
    payload: { modules: ["crm", "pricing", "claim"], status: "pilot" },
  }, connectorKey);
  assert(snapshotWrite.status === 201, "snapshot write failed");
  const snapshotRead = await api(base, "GET", "/v1/snapshot?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(snapshotRead.status === 200 && snapshotRead.json.snapshot?.payload?.status === "pilot", "snapshot read failed");
  mark("snapshot_roundtrip", true, { snapshot_id: snapshotRead.json.snapshot.snapshot_id });

  const claim = await api(base, "POST", "/v1/claim-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    text: "Questo trattamento garantisce guarigione definitiva.",
  }, connectorKey);
  assert(claim.status === 200 && claim.json.result.status === "critical", "claim check failed");
  mark("claim_guard", true, claim.json.result);

  const pricingUnknown = await api(base, "POST", "/v1/pricing-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    observed_prices: [{ sku: "skin-pro", price: 10 }],
  }, connectorKey);
  assert(pricingUnknown.status === 200 && pricingUnknown.json.result.status === "unknown", "pricing unknown failed");
  const pricing = await api(base, "POST", "/v1/pricing-guard/check", {
    tenant_id: "tenant_demo_skinharmony",
    official_prices: [{ sku: "skin-pro", price: 1790 }],
    observed_prices: [{ sku: "skin-pro", price: 1500 }],
  }, connectorKey);
  assert(pricing.status === 200 && pricing.json.result.status === "warning", "pricing warning failed");
  mark("pricing_guard", true, { unknown: pricingUnknown.json.result.status, aligned: pricing.json.result.status, issues: pricing.json.result.issue_count });

  const pulse = await api(base, "GET", "/v1/ecosystem-pulse?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(pulse.status === 200 && pulse.json.pulse?.mode === "read_only_command_center", "ecosystem pulse failed");
  mark("ecosystem_pulse", true, {
    risk_status: pulse.json.pulse.score.risk_status,
    guardrail_events_24h: pulse.json.pulse.guardrails.guardrail_events_24h,
  });

  const calibrationStatus = await api(base, "GET", "/v1/calibration/status?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(calibrationStatus.status === 200 && calibrationStatus.json.calibration?.live_mutation_enabled === false, "calibration status failed");
  const calibration = await api(base, "POST", "/v1/calibration/evaluate", {
    tenant_id: "tenant_demo_skinharmony",
    variants: [
      { id: "baseline", accuracy: 72, coverage: 80, risk: 25 },
      { id: "safer_guardrail", accuracy: 84, coverage: 86, risk: 18 },
    ],
  }, connectorKey);
  assert(calibration.status === 200 && calibration.json.result.selected_variant?.id === "safer_guardrail", "calibration evaluate failed");
  mark("calibration_advisory", true, {
    selected_variant: calibration.json.result.selected_variant.id,
    live_mutation_enabled: calibration.json.result.live_mutation_enabled,
  });

  const claimShieldStatus = await api(base, "GET", "/v1/compliance/claim-shield/status?tenant_id=tenant_demo_skinharmony", undefined, connectorKey);
  assert(claimShieldStatus.status === 200 && claimShieldStatus.json.claim_shield?.legal_guarantee === false, "claim shield status failed");
  const claimShield = await api(base, "POST", "/v1/compliance/claim-shield/check", {
    tenant_id: "tenant_demo_skinharmony",
    text: "Protocollo medicale con risultato garantito.",
    context: { medical_context: true },
  }, connectorKey);
  assert(claimShield.status === 200 && claimShield.json.result.shield_status === "critical_review", "claim shield check failed");
  mark("claim_shield", true, {
    shield_status: claimShield.json.result.shield_status,
    legal_guarantee: claimShield.json.result.legal_guarantee,
  });

  const revoke = await api(base, "POST", "/v1/keys/revoke", { key_id: generated.json.record.key_id });
  assert(revoke.status === 200 && revoke.json.key.status === "revoked", "revoke failed");
  const revokeCodex = await api(base, "POST", "/v1/keys/revoke", { key_id: codexGenerated.json.record.key_id });
  assert(revokeCodex.status === 200 && revokeCodex.json.key.status === "revoked", "codex revoke failed");
  const revokeCodexGeneric = await api(base, "POST", "/v1/keys/revoke", { key_id: codexGenericGenerated.json.record.key_id });
  assert(revokeCodexGeneric.status === 200 && revokeCodexGeneric.json.key.status === "revoked", "codex generic revoke failed");
  const revokeRegulated = await api(base, "POST", "/v1/keys/revoke", { key_id: regulatedGenerated.json.record.key_id });
  assert(revokeRegulated.status === 200 && revokeRegulated.json.key.status === "revoked", "regulated codex revoke failed");
  const denied = await api(base, "GET", "/v1/tenant/status", undefined, connectorKey);
  assert(denied.status === 401, "revoked key still works");
  mark("key_revoke", true, { denied_status: denied.status, error: denied.json.error });

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    storage_root: storageRoot,
    results,
  };
  fs.writeFileSync(path.join(reportDir, "core_service_smoke_latest.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    ok: false,
    generated_at: new Date().toISOString(),
    error: error.message,
    results,
  };
  fs.writeFileSync(path.join(reportDir, "core_service_smoke_latest.json"), JSON.stringify(report, null, 2), "utf8");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await close();
}
