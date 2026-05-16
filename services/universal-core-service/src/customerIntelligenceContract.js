const EVENT_TAXONOMY = [
  { id: "lead.created", label: "Nuovo lead", category: "lead", required_fields: ["customer_id", "source", "created_at"] },
  { id: "lead.contacted", label: "Lead contattato", category: "lead", required_fields: ["customer_id", "channel", "operator_id", "created_at"] },
  { id: "appointment.booked", label: "Appuntamento prenotato", category: "booking", required_fields: ["customer_id", "appointment_id", "service_id", "starts_at"] },
  { id: "appointment.completed", label: "Appuntamento completato", category: "booking", required_fields: ["customer_id", "appointment_id", "service_id", "completed_at"] },
  { id: "appointment.no_show", label: "No-show", category: "booking", required_fields: ["customer_id", "appointment_id", "created_at"] },
  { id: "payment.received", label: "Pagamento registrato", category: "commerce", required_fields: ["customer_id", "payment_id", "amount", "created_at"] },
  { id: "product.purchased", label: "Prodotto acquistato", category: "commerce", required_fields: ["customer_id", "product_id", "quantity", "created_at"] },
  { id: "marketing.message_drafted", label: "Messaggio marketing preparato", category: "marketing", required_fields: ["customer_id", "channel", "draft_id", "created_at"] },
  { id: "marketing.message_approved", label: "Messaggio approvato", category: "marketing", required_fields: ["customer_id", "draft_id", "approved_by", "approved_at"] },
  { id: "marketing.message_sent", label: "Messaggio inviato", category: "marketing", required_fields: ["customer_id", "channel", "message_id", "sent_at"] },
  { id: "consent.granted", label: "Consenso registrato", category: "privacy", required_fields: ["customer_id", "channel", "purpose", "source", "created_at"] },
  { id: "consent.revoked", label: "Consenso revocato", category: "privacy", required_fields: ["customer_id", "channel", "purpose", "revoked_at"] },
];

const CONSENT_REGISTRY = {
  channels: ["email", "whatsapp", "sms", "phone", "push", "postal"],
  purposes: ["marketing", "recall", "service_reminder", "review_request", "profiling_light"],
  fields: [
    "customer_id",
    "channel",
    "purpose",
    "status",
    "source",
    "captured_at",
    "revoked_at",
    "legal_text_version",
    "proof_ref",
  ],
  valid_statuses: ["unknown", "granted", "revoked", "expired"],
  rule: "Nessun invio automatico se il consenso per canale e finalita non e granted.",
};

const CUSTOMER_360_FIELDS = [
  "customer_id",
  "display_name",
  "preferred_channel",
  "last_visit_at",
  "last_contact_at",
  "visit_frequency_days",
  "total_spend",
  "average_ticket",
  "services_used",
  "products_purchased",
  "lifecycle_state",
  "recall_priority",
  "churn_risk",
  "consent_summary",
  "next_best_action",
  "evidence_refs",
];

const JOURNEY_STATES = [
  "draft",
  "core_review",
  "needs_operator_confirmation",
  "approved",
  "copied",
  "sent",
  "done",
  "archived",
  "blocked",
];

const BRANCH_MAPPING = {
  customer_profile: ["customer_behavior_analysis", "lifecycle_crm_guard"],
  marketing_recall: ["email_recall_guard", "lifecycle_crm_guard"],
  segmentation: ["segmentation_offer_guard", "customer_behavior_analysis"],
  funnel: ["funnel_conversion_guard", "paid_ads_guard"],
  privacy: ["legal_privacy_compliance_guard"],
  copy: ["marketing_copy", "content_localization_guard"],
};

export function buildCustomerIntelligenceContract({ tenantId = "", plan = "", branches = [], scopes = [] } = {}) {
  return {
    schema_version: "customer_intelligence_contract_v1",
    tenant_id: tenantId,
    plan,
    positioning: "Customer intelligence governata da Universal Core per Suite, Smart Desk e Codex.",
    rule: "Il sistema prepara priorita, segmenti e bozze; l'operatore conferma sempre prima di contattare il cliente.",
    data_contract: {
      event_taxonomy: EVENT_TAXONOMY,
      consent_registry: CONSENT_REGISTRY,
      customer_360_fields: CUSTOMER_360_FIELDS,
      journey_states: JOURNEY_STATES,
      branch_mapping: BRANCH_MAPPING,
    },
    required_core_branches: [
      "customer_behavior_analysis",
      "lifecycle_crm_guard",
      "email_recall_guard",
      "segmentation_offer_guard",
      "funnel_conversion_guard",
      "marketing_copy",
      "legal_privacy_compliance_guard",
    ],
    active_core_branches: branches,
    connector_scopes: scopes,
    client_usage: {
      suite: "Mostra configurazione, segmenti, code marketing e stato consenso per tenant.",
      smart_desk: "Legge dati reali del centro e prepara azioni Gold da approvare.",
      codex: "Usa il contratto per generare runbook e modifiche senza inventare campi o consensi.",
    },
    automation_limits: {
      automatic_send_allowed: false,
      consent_required_before_contact: true,
      owner_or_operator_confirmation_required: true,
      evidence_required: true,
    },
  };
}

export function summarizeCustomerIntelligenceReadiness(payload = {}) {
  const events = Array.isArray(payload.events) ? payload.events : [];
  const consents = Array.isArray(payload.consents) ? payload.consents : [];
  const profile = typeof payload.customer_profile === "object" && payload.customer_profile ? payload.customer_profile : {};
  const grantedConsents = consents.filter((item) => String(item.status || "").toLowerCase() === "granted");
  const missingProfileFields = CUSTOMER_360_FIELDS.filter((field) => profile[field] === undefined || profile[field] === null || profile[field] === "");

  return {
    schema_version: "customer_intelligence_readiness_v1",
    event_count: events.length,
    consent_count: consents.length,
    granted_consent_count: grantedConsents.length,
    customer_profile_completeness: Math.max(0, Math.round(((CUSTOMER_360_FIELDS.length - missingProfileFields.length) / CUSTOMER_360_FIELDS.length) * 100)),
    missing_customer_360_fields: missingProfileFields,
    can_prepare_marketing_draft: grantedConsents.length > 0 && missingProfileFields.length <= 8,
    can_send_automatically: false,
    next_step: grantedConsents.length === 0
      ? "complete_consent_registry"
      : missingProfileFields.length > 8
        ? "complete_customer_profile"
        : "prepare_draft_for_operator_confirmation",
  };
}
