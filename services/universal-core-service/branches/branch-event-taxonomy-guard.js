export const branchEventTaxonomyGuard = {
  id: "event_taxonomy_guard",
  file: "branch-event-taxonomy-guard.js",
  tier: "network",
  label: "Event Taxonomy Guard",
  domain: "event_taxonomy",
  production_status: "advisory",
  description: "Normalizza eventi operativi e marketing: lead, visita, acquisto, no-show, ordine, rinnovo, click e conversioni.",
  rules: [
    "Ogni evento deve avere tipo, timestamp, tenant, sorgente, soggetto e correlazione quando disponibile.",
    "Non mescolare eventi di tenant diversi o brand_scope diversi.",
    "Gli eventi devono essere idempotenti quando arrivano da webhook, checkout o sync.",
    "Il Core deve distinguere eventi osservati da metriche derivate e insight.",
    "Eventi senza timestamp o fonte possono essere salvati solo come bozza da verificare.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: false,
    allowed_action_level: "event_normalization",
    blocked_actions: ["cross_tenant_event_merge", "event_without_source", "duplicate_non_idempotent_event"],
  },
};
