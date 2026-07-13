const HORIZONTAL_BRANCH_EXCLUSIONS = Object.freeze([
  "beauty_market",
  "cosmetic_chemistry",
  "skinharmony_analyzer",
  "nyra_finance_beauty_test",
  "beauty_value_chain_guard",
  "smartdesk_operations_guard",
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

const DOMAIN_PACKS = Object.freeze({
  generic: Object.freeze({
    id: "generic",
    version: "1.0.0",
    domain: "generic_multi_tenant_system",
    label: "Generic horizontal runtime",
    runtime_kind: "horizontal",
    tenant_aliases: [],
    brand_aliases: [],
    excluded_branch_ids: HORIZONTAL_BRANCH_EXCLUSIONS,
    policy: Object.freeze({
      vocabulary: BASE_VOCABULARY,
      sensitive_domains: ["identity", "permissions", "billing", "publishing", "data_sync", "tenant_data", "deployment"],
      guardrails: {
        forbidden_claims: [],
        protected_terms: [],
        price_policy_mode: "tenant_defined",
        data_isolation: "tenant_scope",
      },
      product_roles: BASE_PRODUCT_ROLES,
    }),
  }),
  regulated_demo: Object.freeze({
    id: "regulated_demo",
    version: "1.0.0",
    domain: "regulated_content_demo",
    label: "Regulated content reference pack",
    runtime_kind: "domain_pack",
    tenant_aliases: ["regulated_demo", "tenant_regulated_demo"],
    brand_aliases: ["regulated_demo"],
    excluded_branch_ids: HORIZONTAL_BRANCH_EXCLUSIONS,
    policy: Object.freeze({
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
    }),
  }),
  skinharmony: Object.freeze({
    id: "skinharmony",
    version: "1.0.0",
    domain: "beauty_wellness_waas_network",
    label: "SkinHarmony compatibility pack",
    runtime_kind: "domain_pack",
    tenant_aliases: ["skinharmony", "tenant_demo_skinharmony"],
    brand_aliases: ["skinharmony"],
    excluded_branch_ids: [],
    policy: Object.freeze({
      vocabulary: {
        presentation_nodes: ["Site Suite", "WordPress node", "template", "landing", "pagina offerte"],
        operational_nodes: ["Smart Desk", "centro", "salone", "nodo operativo"],
        orchestrators: ["SkinHarmony Suite", "Core Admin", "network dashboard"],
        decision_layers: ["Universal Core", "Price Guard", "Claim Guard", "Value Chain Guard"],
        explanation_layers: ["Nyra", "AI Gold", "report advisor"],
      },
      sensitive_domains: ["claim cosmetici", "listini", "margini", "licenze", "dati cliente", "Smart Desk API", "publish sito"],
      guardrails: {
        forbidden_claims: ["cura", "guarisce", "terapia", "medicale", "risultato garantito"],
        protected_terms: ["prezzo consigliato", "range consigliato", "policy interna", "owner approval"],
        price_policy_mode: "advisory_not_resale_price_imposition",
        data_isolation: "brand_scope_and_tenant_scope",
      },
      product_roles: {
        presentation_layer: "Site Suite raccoglie contenuti, lead, offerte e mostra governance.",
        operational_layer: "Smart Desk gestisce agenda, clienti, cassa, magazzino e operativita centro.",
        core_layer: "Universal Core decide rischio, readiness, policy, claim/pricing safety e limiti.",
        advisor_layer: "Nyra spiega priorita, strategia e prossima azione senza sostituire il Core.",
      },
    }),
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
  if (!Array.isArray(pack.excluded_branch_ids)) errors.push("excluded_branch_ids_required");
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
    tenant_scoped: true,
    branch_policy: pack.excluded_branch_ids.length ? "horizontal_exclusions" : "pack_defined",
  };
}

export function getDomainPack(id) {
  return DOMAIN_PACKS[normalize(id)] || null;
}

export function resolveDomainPack({ tenantId = "", brandScope = "", metadata = {} } = {}) {
  const explicit = normalize(metadata?.domain_pack_id || metadata?.domain_pack);
  if (explicit && DOMAIN_PACKS[explicit]) return DOMAIN_PACKS[explicit];
  const tenant = normalize(tenantId);
  const brand = normalize(brandScope);
  return Object.values(DOMAIN_PACKS).find((pack) =>
    pack.id !== "generic" && (pack.tenant_aliases.includes(tenant) || pack.brand_aliases.includes(brand)),
  ) || DOMAIN_PACKS.generic;
}

export function resolveDomainPackForKey(keyRecord = {}) {
  return resolveDomainPack({
    tenantId: keyRecord.tenant_id,
    brandScope: keyRecord.brand_scope,
    metadata: keyRecord.metadata,
  });
}

export function checkDomainPackRequest(keyRecord, requestedId) {
  const pack = resolveDomainPackForKey(keyRecord);
  const requested = normalize(requestedId);
  return {
    ok: !requested || requested === pack.id,
    pack,
    requested_id: requested || null,
    error: requested && requested !== pack.id ? "domain_pack_override_denied" : null,
  };
}

export function branchAllowedForDomainPack(pack, branchId) {
  return !pack.excluded_branch_ids.includes(String(branchId || ""));
}

for (const pack of Object.values(DOMAIN_PACKS)) {
  const validation = validateDomainPack(pack);
  if (!validation.ok) throw new Error(`invalid_domain_pack:${pack.id}:${validation.errors.join(",")}`);
}

