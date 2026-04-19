const DEFAULT_BASE_URL = "https://skinharmony-smartdesk-live.onrender.com";

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  if (!response.ok) throw new Error(`${response.status} ${path}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

function clean(value = "") {
  return String(value || "").trim();
}

function label(user = {}) {
  return clean(user.centerName || user.businessName || user.username || user.id);
}

function chooseTenants(users = []) {
  const gold = users.filter((user) => String(user.subscriptionPlan || user.plan || "").toLowerCase() === "gold");
  const privilege = gold.find((user) => /privilege/i.test(label(user))) || gold[0];
  const medium = gold.find((user) => user.id !== privilege?.id && /073|centro.*73|gold.*073|gold100_gold_073/i.test([label(user), user.username, user.centerId].join(" ")))
    || gold.find((user) => user.id !== privilege?.id);
  const fragile = gold.find((user) => ![privilege?.id, medium?.id].includes(user.id) && /gold100_gold_100|centro 100|centro.*100|fragile|incomplet/i.test([label(user), user.username, user.centerId].join(" ")))
    || gold.find((user) => ![privilege?.id, medium?.id].includes(user.id));
  return [privilege, medium, fragile].filter(Boolean);
}

async function auditTenant(baseUrl, adminToken, tenant) {
  const support = await request(baseUrl, `/api/auth/users/${tenant.id}/support-session`, { method: "POST", token: adminToken, body: {} });
  const state = await request(baseUrl, "/api/ai-gold/state", { token: support.token });
  const parallel = state.decisionParallel || {};
  return {
    tenant: label(tenant),
    username: tenant.username || "",
    centerId: tenant.centerId || "",
    status: parallel.status || "missing",
    agreementScore: parallel.agreementScore ?? null,
    agreementBand: parallel.agreementBand || "N/A",
    legacyPrimary: parallel.legacySnapshot?.primaryAction?.actionKey || "",
    legacyBand: parallel.legacySnapshot?.primaryAction?.actionBand || "",
    corePrimary: parallel.coreSnapshot?.primaryAction?.actionKey || "",
    coreBand: parallel.coreSnapshot?.primaryAction?.actionBand || "",
    coreTone: parallel.coreSnapshot?.primaryAction?.tone || "",
    diff: parallel.diffSnapshot || null,
    legacyStillPrimary: Boolean(state.decision && state.decision.source === "gold_state"),
    decisionParallelPresent: Boolean(state.decisionParallel)
  };
}

async function main() {
  const baseUrl = process.env.SMARTDESK_LIVE_URL || DEFAULT_BASE_URL;
  const username = process.env.SMARTDESK_ADMIN_USER;
  const password = process.env.SMARTDESK_ADMIN_PASSWORD;
  if (!username || !password) throw new Error("Set SMARTDESK_ADMIN_USER and SMARTDESK_ADMIN_PASSWORD");
  const health = await request(baseUrl, "/health");
  const login = await request(baseUrl, "/api/auth/login", { method: "POST", body: { username, password } });
  const users = await request(baseUrl, "/api/auth/users", { token: login.token });
  const tenants = chooseTenants(users);
  const audits = [];
  for (const tenant of tenants) audits.push(await auditTenant(baseUrl, login.token, tenant));
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl,
    health,
    tenantsAnalyzed: audits.map((item) => item.tenant),
    audits,
    confirmations: {
      readOnly: true,
      decisionCorePrimary: false,
      uiChanged: false,
      publicApiChanged: false,
      realDataModified: false
    }
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}
