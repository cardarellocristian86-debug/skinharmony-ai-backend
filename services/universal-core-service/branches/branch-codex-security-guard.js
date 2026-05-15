export const branchCodexSecurityGuard = {
  id: "codex_security_guard",
  file: "branch-codex-security-guard.js",
  tier: "internal",
  label: "Codex Security Guard",
  domain: "codex_security",
  production_status: "advisory",
  description: "Regole su API key, token, tenant isolation, capability, audit e dati sensibili.",
  rules: [
    "Codex deve usare chiavi scoped, revocabili e tenant-bound; mai una key unica per tutto.",
    "Ogni endpoint operativo richiede scope, tenant check e audit.",
    "Le azioni sensibili richiedono owner confirmation e non devono essere eseguite da prompt libero.",
    "Non esporre dati cross-tenant, condizioni commerciali riservate, margini o segreti fuori scope.",
    "Usare soft gate per prodotto/plugin; hard block solo dove previsto da contratto e policy esplicita.",
  ],
  guardrails: {
    destructive_automation: false,
    publish_requires_owner_confirmation: true,
    allowed_action_level: "scoped_and_audited",
    blocked_actions: ["secret_leak", "tenant_scope_bypass", "unscoped_admin_action", "hard_block_without_policy", "unaudited_sensitive_action"],
  },
};
