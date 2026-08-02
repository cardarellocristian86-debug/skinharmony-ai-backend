import { describeNyraPolicyRegistry } from "../../shared/nyra-policy-registry.mjs";

export const branchNyraPolicyRegistry = {
  id: "nyra_policy_registry",
  file: "branch-nyra-policy-registry.js",
  tier: "base",
  label: "Nyra Policy Registry",
  domain: "horizontal_work",
  production_status: "advisory",
  description:
    "Organizza policy pack versionati per tenant, ambiente, tipo di lavoro e azione; Nyra propone e Universal Core verifica.",
  subbranches: [
    "core_invariants", "global_policy", "sector_templates", "tenant_company_overlays",
    "environment_overlays", "work_type_policies", "action_policies", "source_registry",
    "schema_validation", "capability_diff", "signature_verification", "provenance_attestation",
    "canary_activation", "rollback_snapshot", "dtt_missing_branch_discovery",
    "policy_expiry_and_revalidation",
  ],
  rules: [
    "Le invarianti Core prevalgono sempre e i figli possono restringere, mai ampliare autorita senza prova owner e verdict Core.",
    "Ogni overlay e tenant-scoped; eredita solo ancestry verificata e non puo influenzare altri tenant.",
    "Le decisioni sono default-deny e deny-wins; errori, firma non valida, fonti mancanti o scadenza producono DENY.",
    "Nyra e DTT creano soltanto candidati; attivazione, pubblicazione ed esecuzione restano vietate al ramo.",
    "Le promozioni usano snapshot immutabili con digest, test positivi e negativi, canary e rollback.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "tenant_scoped_policy_candidate",
    blocked_actions: [
      "policy_activation_without_core", "authority_expansion_without_owner",
      "unsigned_active_pack", "cross_tenant_inheritance", "unbounded_runtime_traversal",
      "dtt_policy_activation", "policy_error_skip", "mutable_active_snapshot",
    ],
  },
  policy_registry: describeNyraPolicyRegistry(),
};
