export const SCOPES = Object.freeze({
  READ_SNAPSHOT: "read:snapshot",
  WRITE_SNAPSHOT: "write:snapshot",
  READ_DECISION: "read:decision",
  WRITE_DECISION: "write:decision",
  READ_REVIEW: "read:review",
  WRITE_REVIEW: "write:review",
  WRITE_SYNC_SUITE: "write:sync_suite",
  WRITE_SYNC_WORDPRESS: "write:sync_wordpress",
  WRITE_TRANSLATE: "write:translate",
  WRITE_PUBLISH: "write:publish",
  ADMIN_TENANT: "admin:tenant",
  ADMIN_KEYS: "admin:keys",
  CLAIM_CHECK: "claim:check",
  PRICING_CHECK: "pricing:check",
  POLICY_CHECK: "policy:check",
  AUTOMATION_CODEX: "automation:codex",
  AI_GATEWAY: "gateway:ai",
});

export const DEFAULT_CONNECTOR_SCOPES = [
  SCOPES.READ_SNAPSHOT,
  SCOPES.WRITE_SNAPSHOT,
  SCOPES.READ_DECISION,
  SCOPES.READ_REVIEW,
  SCOPES.WRITE_SYNC_SUITE,
  SCOPES.WRITE_SYNC_WORDPRESS,
  SCOPES.CLAIM_CHECK,
  SCOPES.PRICING_CHECK,
  SCOPES.POLICY_CHECK,
  SCOPES.AI_GATEWAY,
];

export const DEFAULT_AUTOMATION_SCOPES = [
  SCOPES.READ_SNAPSHOT,
  SCOPES.WRITE_SNAPSHOT,
  SCOPES.READ_DECISION,
  SCOPES.WRITE_DECISION,
  SCOPES.READ_REVIEW,
  SCOPES.WRITE_REVIEW,
  SCOPES.WRITE_SYNC_SUITE,
  SCOPES.CLAIM_CHECK,
  SCOPES.PRICING_CHECK,
  SCOPES.POLICY_CHECK,
  SCOPES.AUTOMATION_CODEX,
  SCOPES.AI_GATEWAY,
];

export const KEY_PRESETS = Object.freeze({
  suite_connector: {
    label: "Suite connector",
    key_type: "connector",
    scopes: [
      SCOPES.READ_SNAPSHOT,
      SCOPES.WRITE_SNAPSHOT,
      SCOPES.READ_DECISION,
      SCOPES.READ_REVIEW,
      SCOPES.WRITE_SYNC_SUITE,
      SCOPES.CLAIM_CHECK,
      SCOPES.PRICING_CHECK,
      SCOPES.POLICY_CHECK,
      SCOPES.AI_GATEWAY,
    ],
  },
  smartdesk_connector: {
    label: "Smart Desk connector",
    key_type: "connector",
    scopes: [
      SCOPES.READ_SNAPSHOT,
      SCOPES.WRITE_SNAPSHOT,
      SCOPES.READ_DECISION,
      SCOPES.WRITE_SYNC_SUITE,
      SCOPES.POLICY_CHECK,
      SCOPES.AI_GATEWAY,
    ],
  },
  wordpress_connector: {
    label: "WordPress connector",
    key_type: "connector",
    scopes: [
      SCOPES.READ_SNAPSHOT,
      SCOPES.WRITE_SNAPSHOT,
      SCOPES.READ_DECISION,
      SCOPES.WRITE_SYNC_WORDPRESS,
      SCOPES.CLAIM_CHECK,
      SCOPES.PRICING_CHECK,
      SCOPES.POLICY_CHECK,
      SCOPES.AI_GATEWAY,
    ],
  },
  codex_automation: {
    label: "Codex controlled automation",
    key_type: "automation",
    scopes: DEFAULT_AUTOMATION_SCOPES,
  },
  readonly_monitor: {
    label: "Read-only monitor",
    key_type: "connector",
    scopes: [
      SCOPES.READ_SNAPSHOT,
      SCOPES.READ_DECISION,
      SCOPES.READ_REVIEW,
      SCOPES.CLAIM_CHECK,
      SCOPES.PRICING_CHECK,
      SCOPES.POLICY_CHECK,
      SCOPES.AI_GATEWAY,
    ],
  },
});

export function hasScope(keyRecord, scope) {
  return Boolean(keyRecord?.allowed_scopes?.includes(scope) || keyRecord?.allowed_scopes?.includes(SCOPES.ADMIN_TENANT));
}

export function sanitizeScopes(scopes, fallback = DEFAULT_CONNECTOR_SCOPES) {
  const known = new Set(Object.values(SCOPES));
  const raw = Array.isArray(scopes) && scopes.length ? scopes : fallback;
  return [...new Set(raw.filter((scope) => known.has(scope)))];
}

export function requireTenantAccess(keyRecord, tenantId) {
  if (!tenantId) return true;
  if (hasScope(keyRecord, SCOPES.ADMIN_TENANT)) return true;
  return keyRecord?.tenant_id === tenantId;
}
