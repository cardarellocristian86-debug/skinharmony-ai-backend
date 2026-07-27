import {
  orchestrationCapabilityIds,
  orchestrationCatalogDescriptor,
} from "./orchestration-capability-catalog.js";
import {
  AI_LEARNING_EXPOSURE,
  extensionFacetDescriptor,
} from "./ai-learning-factory-branch-contracts.js";

export const branchAiOrchestration = {
  id: "ai_orchestration",
  file: "branch-ai-orchestration.js",
  tier: "internal",
  label: "AI Orchestration",
  domain: "horizontal_work",
  production_status: "advisory",
  ...AI_LEARNING_EXPOSURE.horizontal,
  description: "Orchestrazione vendor-neutral di provider e modelli AI per routing, composizione, evidenza, verifica, resilienza, sicurezza ed economia.",
  subbranches: orchestrationCapabilityIds("ai_orchestration"),
  capability_catalog: orchestrationCatalogDescriptor("ai_orchestration"),
  capability_facets: extensionFacetDescriptor("ai_orchestration"),
  rules: [
    "Core seleziona provider, modello, composizione, budget e fallback; un modello non puo scegliere la propria autorita.",
    "Il routing deve partire da candidati policy-validi e ottimizzare qualita verificata, rischio, latenza, costo e privacy.",
    "Ensemble, cascade, race e verifier devono avere parallelismo, deadline, cancellazione e costo massimi.",
    "Credenziali, token e contesto tenant non devono essere condivisi tra provider o riutilizzati fuori audience.",
    "Ogni output provider deve essere normalizzato, versionato e verificato prima della ricomposizione.",
    "Nuove strategie di routing e apprendimento operano prima in shadow e richiedono verifica prima di canary o active.",
    "Le combinazioni e la profondita virtuale ricorsiva non equivalgono a chiamate modello e non possono materializzarsi senza un contratto Core.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "ai_orchestration_advisory",
    catalog_expansion: "lazy_paged_only",
    runtime_requires_explicit_limits: true,
    blocked_actions: [
      "model_self_selection",
      "unbounded_model_fanout",
      "provider_token_passthrough",
      "cross_tenant_model_context",
      "model_call_without_budget",
      "ensemble_without_termination",
      "unverified_provider_output",
      "routing_learning_direct_to_active",
    ],
  },
};
