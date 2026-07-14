export const VERTICAL_BRANCH_IDS = Object.freeze([
  "suite_governance",
  "smartdesk_operations_guard",
  "beauty_market",
  "cosmetic_chemistry",
  "skinharmony_analyzer",
  "nyra_finance_beauty_test",
  "beauty_value_chain_guard",
  "beauty_protocol_guard",
  "beauty_vertical_orchestration",
]);

const BASE_VOCABULARY = Object.freeze({
  presentation_nodes: ["ui_node", "web_client", "admin_console"],
  operational_nodes: ["operational_client", "workflow_app", "field_node"],
  orchestrators: ["core_service", "central_orchestrator"],
  decision_layers: ["decision_engine", "policy_engine"],
  explanation_layers: ["advisor_layer", "assistant_layer"],
});

const BASE_PRODUCT_ROLES = Object.freeze({
  presentation_layer: "Raccoglie input e mostra output.",
  operational_layer: "Esegue flussi autorizzati nel perimetro locale.",
  core_layer: "Decide rischio, priorita, policy e controllo.",
  advisor_layer: "Spiega e prepara azioni senza essere arbitro finale.",
});

const BASE_GUARDRAILS = Object.freeze({
  forbidden_claims: [],
  protected_terms: [],
  price_policy_mode: "tenant_defined",
  data_isolation: "tenant_scope",
});

function definePack({
  id,
  version = "1.0.0",
  domain,
  label,
  runtimeKind = "domain_pack",
  verticalBranchIds = [],
  policy,
}) {
  const allowedVerticalBranches = Object.freeze([...verticalBranchIds]);
  return Object.freeze({
    id,
    version,
    domain,
    label,
    runtime_kind: runtimeKind,
    activation_mode: id === "generic" ? "default_horizontal" : "explicit_key_metadata_only",
    vertical_branch_ids: allowedVerticalBranches,
    excluded_branch_ids: Object.freeze(
      VERTICAL_BRANCH_IDS.filter((branchId) => !allowedVerticalBranches.includes(branchId)),
    ),
    policy: Object.freeze(policy),
  });
}

const DOMAIN_PACKS = Object.freeze({
  generic: definePack({
    id: "generic",
    domain: "generic_multi_tenant_system",
    label: "Generic horizontal runtime",
    runtimeKind: "horizontal",
    policy: {
      vocabulary: BASE_VOCABULARY,
      sensitive_domains: ["identity", "permissions", "billing", "publishing", "data_sync", "tenant_data", "deployment"],
      guardrails: BASE_GUARDRAILS,
      product_roles: BASE_PRODUCT_ROLES,
    },
  }),
  regulated_demo: definePack({
    id: "regulated_demo",
    domain: "regulated_content_demo",
    label: "Regulated content reference pack",
    policy: {
      vocabulary: {
        ...BASE_VOCABULARY,
        decision_layers: ["decision_engine", "policy_engine", "content_guard"],
      },
      sensitive_domains: ["publishing", "regulated_claims", "pricing", "tenant_data", "deployment"],
      guardrails: {
        forbidden_claims: [
          "risultati garantiti", "risultato garantito", "guaranteed result", "guaranteed results",
          "resultados garantizados", "resultado garantizado", "resultat garanti", "resultats garantis", "garantiertes ergebnis",
        ],
        protected_terms: ["owner approval", "policy review", "internal range", "recommended range"],
        price_policy_mode: "advisory_not_resale_price_imposition",
        data_isolation: "tenant_scope",
      },
      product_roles: BASE_PRODUCT_ROLES,
    },
  }),
  suite: definePack({
    id: "suite",
    domain: "managed_site_suite",
    label: "Suite product pack",
    verticalBranchIds: ["suite_governance"],
    policy: {
      vocabulary: {
        ...BASE_VOCABULARY,
        presentation_nodes: ["managed_site", "wordpress_node", "template", "landing_page"],
        orchestrators: ["suite_control_plane", "core_service"],
      },
      sensitive_domains: ["publishing", "tenant_content", "deployment", "site_credentials"],
      guardrails: {
        ...BASE_GUARDRAILS,
        data_isolation: "tenant_scope_and_site_scope",
      },
      product_roles: {
        ...BASE_PRODUCT_ROLES,
        presentation_layer: "La Suite raccoglie contenuti, lead e offerte del sito gestito.",
      },
    },
  }),
  smartdesk: definePack({
    id: "smartdesk",
    domain: "operational_desk",
    label: "SmartDesk product pack",
    verticalBranchIds: ["smartdesk_operations_guard"],
    policy: {
      vocabulary: {
        ...BASE_VOCABULARY,
        operational_nodes: ["smartdesk", "operations_desk", "field_node"],
        orchestrators: ["smartdesk_control_plane", "core_service"],
      },
      sensitive_domains: ["customer_data", "appointments", "billing", "inventory", "operational_api"],
      guardrails: {
        ...BASE_GUARDRAILS,
        data_isolation: "tenant_scope_and_operational_node_scope",
      },
      product_roles: {
        ...BASE_PRODUCT_ROLES,
        operational_layer: "SmartDesk gestisce i flussi operativi autorizzati del singolo tenant.",
      },
    },
  }),
  analyzer: definePack({
    id: "analyzer",
    domain: "analysis_and_protocol_advisory",
    label: "Analyzer product pack",
    verticalBranchIds: [
      "beauty_market",
      "cosmetic_chemistry",
      "skinharmony_analyzer",
      "nyra_finance_beauty_test",
      "beauty_value_chain_guard",
      "beauty_protocol_guard",
      "beauty_vertical_orchestration",
    ],
    policy: {
      vocabulary: {
        ...BASE_VOCABULARY,
        decision_layers: ["analysis_engine", "protocol_guard", "claim_guard", "value_chain_guard"],
        explanation_layers: ["advisor_layer", "analysis_report"],
      },
      sensitive_domains: ["analysis_results", "cosmetic_claims", "protocols", "pricing", "customer_data"],
      guardrails: {
        forbidden_claims: ["cura", "guarisce", "terapia", "medicale", "risultato garantito"],
        protected_terms: ["prezzo consigliato", "range consigliato", "policy interna", "owner approval"],
        price_policy_mode: "advisory_not_resale_price_imposition",
        data_isolation: "tenant_scope_and_subject_scope",
      },
      product_roles: {
        ...BASE_PRODUCT_ROLES,
        advisor_layer: "L'Analyzer interpreta dati e prepara raccomandazioni senza autorizzare azioni.",
      },
    },
  }),
});

function normalize(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9_-]+/g, "_");
}

export function validateDomainPack(pack) {
  const errors = [];
  if (!pack || typeof pack !== "object") return { ok: false, errors: ["pack_object_required"] };
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(String(pack.id || ""))) errors.push("invalid_id");
  if (!String(pack.version || "").trim()) errors.push("version_required");
  if (!String(pack.domain || "").trim()) errors.push("domain_required");
  if (!pack.policy || typeof pack.policy !== "object") errors.push("policy_required");
  if (!Array.isArray(pack.vertical_branch_ids)) errors.push("vertical_branch_ids_required");
  if (!Array.isArray(pack.excluded_branch_ids)) errors.push("excluded_branch_ids_required");
  if (Array.isArray(pack.vertical_branch_ids) && pack.vertical_branch_ids.some((id) => !VERTICAL_BRANCH_IDS.includes(id))) {
    errors.push("unknown_vertical_branch_id");
  }
  return { ok: errors.length === 0, errors };
}

export function listDomainPacks() {
  return Object.values(DOMAIN_PACKS).map(publicDomainPack);
}

export function publicDomainPack(pack) {
  return {
    id: pack.id,
    version: pack.version,
    domain: pack.domain,
    label: pack.label,
    runtime_kind: pack.runtime_kind,
    activation_mode: pack.activation_mode,
    tenant_scoped: true,
    branch_policy: pack.vertical_branch_ids.length ? "explicit_vertical_allowlist" : "horizontal_only",
    vertical_branch_ids: [...pack.vertical_branch_ids],
  };
}

export function getDomainPack(id) {
  return DOMAIN_PACKS[normalize(id)] || null;
}

export function resolveDomainPack({ metadata = {} } = {}) {
  const explicit = normalize(metadata?.domain_pack_id || metadata?.domain_pack);
  return (explicit && DOMAIN_PACKS[explicit]) || DOMAIN_PACKS.generic;
}

export function resolveDomainPackForKey(keyRecord = {}) {
  return resolveDomainPack({ metadata: keyRecord.metadata });
}

export function checkDomainPackRequest(keyRecord, requestedId) {
  const pack = resolveDomainPackForKey(keyRecord);
  const requested = normalize(requestedId);
  return {
    ok: !requested,
    pack,
    requested_id: requested || null,
    error: requested ? "domain_pack_override_denied" : null,
  };
}

export function branchAllowedForDomainPack(pack, branchId) {
  const resolvedPack = pack || DOMAIN_PACKS.generic;
  const id = String(branchId || "");
  return !VERTICAL_BRANCH_IDS.includes(id) || resolvedPack.vertical_branch_ids.includes(id);
}

for (const pack of Object.values(DOMAIN_PACKS)) {
  const validation = validateDomainPack(pack);
  if (!validation.ok) throw new Error(`invalid_domain_pack:${pack.id}:${validation.errors.join(",")}`);
}
