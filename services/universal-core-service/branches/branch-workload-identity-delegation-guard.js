import {
  AI_LEARNING_EXPOSURE,
  extensionFacetDescriptor,
} from "./ai-learning-factory-branch-contracts.js";

export const branchWorkloadIdentityDelegationGuard = {
  id: "workload_identity_delegation_guard",
  file: "branch-workload-identity-delegation-guard.js",
  tier: "internal",
  label: "Workload Identity & Delegation Guard",
  domain: "identity_delegation",
  production_status: "advisory",
  ...AI_LEARNING_EXPOSURE.guard,
  description: "Verifica identita di workload e agenti, deleghe limitate, audience binding, durata delle credenziali e separazione dei trust domain.",
  subbranches: [
    "workload_identity", "caller_attestation", "trust_domain_boundary", "delegation_chain", "act_as_scope",
    "resource_audience_binding", "credential_lifetime", "credential_rotation", "downstream_token_separation",
    "redirect_uri_allowlist", "delegation_expiry", "delegation_revocation", "identity_incident_containment",
  ],
  capability_facets: extensionFacetDescriptor("workload_identity_delegation_guard"),
  rules: [
    "Ogni agente o workload deve avere un'identita verificabile separata dal tenant e dal ruolo umano che eventualmente delega.",
    "Una delega deve dichiarare delegante, delegato, azione, risorsa, tenant, scadenza e catena di approvazione; nessuna delega e implicita.",
    "Token e credenziali devono essere vincolati alla risorsa/audience prevista e non devono essere riutilizzati o inoltrati verso servizi diversi.",
    "Le credenziali di workload devono essere a vita breve, ruotabili e mai registrate in audit, memoria o output utente.",
    "Un workload non puo attraversare un trust domain o tenant senza policy esplicita, verifica della destinazione e audit evidence.",
    "Una revoca, una scadenza o un mismatch di audience deve bloccare l'azione e richiedere nuova autorizzazione.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "identity_delegation_advisory",
    blocked_actions: [
      "implicit_agent_delegation", "cross_tenant_identity_reuse", "token_passthrough", "wrong_resource_audience",
      "long_lived_workload_secret", "unattested_workload_action", "delegation_after_revocation",
    ],
  },
};
