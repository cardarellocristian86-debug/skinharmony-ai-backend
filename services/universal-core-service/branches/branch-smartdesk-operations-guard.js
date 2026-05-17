export const branchSmartDeskOperationsGuard = {
  id: "smartdesk_operations_guard",
  file: "branch-smartdesk-operations-guard.js",
  tier: "gold",
  label: "Smart Desk Operations Guard",
  domain: "smartdesk_operations",
  production_status: "advisory",
  description: "Governa agenda, clienti, cassa, turni, protocolli, marketing e AI Gold dentro Smart Desk.",
  rules: [
    "Il gestionale/Core e la fonte dei numeri; AI Gold legge, interpreta e propone senza correggere dati reali.",
    "Azioni operative su agenda, cassa, clienti e marketing devono essere confermabili e dare feedback immediato.",
    "Base/Silver/Gold devono rispettare moduli e preview/upgrade senza blocchi brutali.",
    "Protocolli e analisi restano non medici e modificabili dall'operatore.",
    "WhatsApp, email e automazioni richiedono consenso e approvazione operatore.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "smartdesk_operational_review",
    blocked_actions: ["ai_changes_real_numbers", "auto_send_message", "medical_protocol_claim", "plan_gate_bypass"],
  },
};
