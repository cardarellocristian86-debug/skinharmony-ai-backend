import crypto from "node:crypto";

const MAX_AGE_MS = 10 * 60 * 1000;
const AGENT_PORTAL_SESSION_AGE_MS = 20 * 60 * 1000;
const AGENT_PORTAL_SESSION_COOKIE = "__Host-skinharmony_agents";
const AGENT_PORTAL_PATH = "/agents";

function b64(value) { return Buffer.from(value).toString("base64url"); }
function unb64(value) { return Buffer.from(value, "base64url"); }
function challenge(value) { return crypto.createHash("sha256").update(value).digest("base64url"); }
function page(title, body) { return `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:24px"><h1>${title}</h1>${body}</body></html>`; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}
function agentPortalPage(title, body, { refreshPath = "" } = {}) {
  const safeRefreshPath = /^\/agents\/runs\/run_[A-Za-z0-9_-]{1,150}$/.test(refreshPath)
    ? refreshPath
    : "";
  const refresh = safeRefreshPath
    ? `<meta http-equiv="refresh" content="3;url=${escapeHtml(safeRefreshPath)}">`
    : "";
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${refresh}<title>${escapeHtml(title)}</title></head><body style="font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:0 auto;padding:32px 20px 64px;background:#f7f7f8;color:#161616"><main style="background:#fff;border:1px solid #e5e5e5;border-radius:20px;padding:24px;box-shadow:0 8px 30px #0000000d"><p style="margin:0 0 8px;color:#6b6b6b;font-weight:650">SkinHarmony Nyra &amp; Core</p><h1 style="font-size:32px;line-height:1.08;margin:0 0 18px">${escapeHtml(title)}</h1>${body}</main></body></html>`;
}
function button(label, href, { newTab = false } = {}) {
  return `<p><a href="${escapeHtml(href)}"${newTab ? ' target="_blank" rel="noopener"' : ""} style="display:block;text-align:center;background:#111;color:#fff;padding:14px 18px;border-radius:12px;text-decoration:none;font-weight:700">${escapeHtml(label)}</a></p>`;
}
function logoutForm(csrf) {
  return `<form method="post" action="${AGENT_PORTAL_PATH}/logout" style="margin-top:24px"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button style="width:100%;border:0;background:transparent;color:#666;padding:10px">Esci dal portale</button></form>`;
}
function connectForm(csrf, label) {
  return `<form method="post" action="${AGENT_PORTAL_PATH}/connect"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button style="width:100%;border:0;background:#111;color:#fff;padding:14px 18px;border-radius:12px;font-weight:700">${escapeHtml(label)}</button></form>`;
}
function portalHtml(res, status, html) {
  return res
    .status(status)
    .set({
      "cache-control": "no-store, max-age=0",
      pragma: "no-cache",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; style-src 'unsafe-inline'",
    })
    .type("html")
    .send(html);
}
function accessFailure(error) {
  switch (error?.message) {
    case "jwt_tenant_missing": return "Il login è valido, ma manca il tenant nel token Auth0.";
    case "jwt_audience_invalid": return "Il login è valido, ma l’audience Auth0 non coincide con quella del servizio.";
    case "owner_required": return "Il login è valido, ma l’account non viene riconosciuto come owner_root.";
    case "oauth_exchange_failed": return "Non è stato possibile completare il login Auth0.";
    default: return "Non è stato possibile verificare l’accesso owner.";
  }
}

function setupLinkFailure(error) {
  switch (error?.message) {
    case "provider_setup_link_key_missing":
    case "provider_setup_link_authentication_failed":
    case "provider_setup_link_scope_required":
    case "provider_setup_link_access_denied":
    case "provider_setup_link_owner_context_unavailable":
      return ["Collegamento in preparazione", "<p>Il collegamento sicuro si sta attivando. Riprova tra pochi minuti.</p>"];
    default:
      return ["Servizio non disponibile", "<p>Riprova più tardi.</p>"];
  }
}

function secureSetupRedirect(link, config, expectedTenantId) {
  const setupUrl = String(link?.setup_url || "");
  const proof = String(link?.setup_proof || "");
  const tenantId = String(link?.tenant_id || "").trim();
  const expectedTenant = String(expectedTenantId || "").trim();
  if (!expectedTenant || tenantId !== expectedTenant) throw new Error("provider_setup_link_tenant_mismatch");
  if (!/^[A-Za-z0-9_-]{32,120}$/.test(proof)) throw new Error("provider_setup_link_invalid_response");
  let target;
  let core;
  try {
    target = new URL(setupUrl);
    core = new URL(config.universalCoreUrl);
  } catch {
    throw new Error("provider_setup_link_invalid_response");
  }
  if (
    target.protocol !== "https:" ||
    core.protocol !== "https:" ||
    target.origin !== core.origin ||
    !/^\/v1\/generic-agents\/providers\/openai\/setup\/[A-Za-z0-9_-]{30,120}$/.test(target.pathname) ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  ) {
    throw new Error("provider_setup_link_invalid_response");
  }
  target.hash = `proof=${encodeURIComponent(proof)}`;
  return target.toString();
}

function deriveKey(secret, purpose) {
  return crypto.scryptSync(secret, purpose, 32);
}
function seal(key, payload) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ciphertext)}`;
}
function open(key, value) {
  const envelope = String(value || "");
  if (envelope.length < 48 || envelope.length > 4_096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(envelope)) return null;
  const [iv, tag, ciphertext] = envelope.split(".");
  if (!iv || !tag || !ciphertext) return null;
  try {
    const ivBuffer = unb64(iv), tagBuffer = unb64(tag), ciphertextBuffer = unb64(ciphertext);
    if (ivBuffer.length !== 12 || tagBuffer.length !== 16 || !ciphertextBuffer.length || ciphertextBuffer.length > 3_000) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, ivBuffer);
    decipher.setAuthTag(tagBuffer);
    return JSON.parse(Buffer.concat([decipher.update(ciphertextBuffer), decipher.final()]).toString("utf8"));
  } catch { return null; }
}
function cookie(req, name) {
  for (const item of String(req.headers.cookie || "").split(";")) {
    const separator = item.indexOf("=");
    if (separator > 0 && item.slice(0, separator).trim() === name) return item.slice(separator + 1).trim();
  }
  return "";
}
function resultPayload(result) {
  return result?.structuredContent && typeof result.structuredContent === "object"
    ? result.structuredContent
    : result;
}
function providerStatusForTenant(result, expectedTenantId) {
  const payload = resultPayload(result);
  const tenantId = String(payload?.tenant_id || "").trim();
  const expectedTenant = String(expectedTenantId || "").trim();
  if (!expectedTenant || tenantId !== expectedTenant) throw new Error("provider_status_tenant_mismatch");
  return payload;
}
function safeIdentity(identity) {
  return {
    kind: "oauth",
    subject: String(identity.subject || ""),
    tenantId: String(identity.tenantId || ""),
    role: String(identity.role || "tenant_owner"),
    providerSetupOwner: true,
  };
}
function runIdFrom(payload) {
  const runId = String(payload?.run?.run_id || payload?.run_id || "");
  return /^run_[A-Za-z0-9_-]{1,150}$/.test(runId) ? runId : "";
}
function coreErrorCode(error) {
  const match = String(error?.message || "").match(/^core_request_failed:\d{3}:([a-z0-9_]+)$/);
  return match?.[1] || String(error?.message || "");
}
function startFailure(error) {
  switch (coreErrorCode(error)) {
    case "tenant_openai_provider_not_configured":
    case "tenant_provider_not_configured":
    case "provider_not_configured":
    case "provider_execution_unavailable":
      return { status: 409, title: "OpenAI non pronto", message: "Verifica o collega di nuovo la chiave." };
    case "tenant_multi_agent_run_in_progress":
      return { status: 409, title: "Test già in corso", message: "Attendi la conclusione del test già avviato prima di crearne un altro." };
    case "multi_agent_execution_capacity_reached":
    case "daily_workflow_budget_exceeded":
    case "model_budget_exceeded":
      return { status: 429, title: "Limite temporaneo raggiunto", message: "Attendi e riprova più tardi. Nessun nuovo test è stato avviato." };
    case "owner_confirmation_replayed":
      return { status: 409, title: "Conferma già usata", message: "Torna al portale e conferma un nuovo test." };
    default:
      return { status: 503, title: "Avvio non riuscito", message: "Nessun nuovo test è stato avviato. Riprova tra poco." };
  }
}
function runFailureMessage(errorCode) {
  switch (String(errorCode || "")) {
    case "run_cancelled": return "L’esecuzione è stata annullata.";
    case "run_deadline_exceeded": return "Il test ha superato il tempo massimo ed è stato arrestato in sicurezza.";
    case "openai_provider_auth_failed": return "OpenAI ha rifiutato la chiave. Verifica o sostituisci la chiave nel portale.";
    case "openai_provider_rate_limited": return "OpenAI ha applicato un limite temporaneo. Attendi e riprova più tardi.";
    case "openai_provider_timeout": return "OpenAI non ha risposto entro il tempo massimo. Puoi avviare un nuovo test.";
    case "openai_provider_unavailable": return "OpenAI è temporaneamente non disponibile. Puoi riprovare più tardi.";
    case "openai_provider_request_failed":
    case "openai_provider_response_invalid":
      return "OpenAI non ha restituito una risposta valida. Nessun risultato incompleto è stato accettato.";
    case "openai_provider_usage_missing": return "OpenAI non ha restituito i dati di consumo richiesti; il test è stato fermato.";
    case "provider_usage_budget_exceeded":
    case "model_budget_exceeded":
      return "Il test ha raggiunto il limite di consumo configurato ed è stato fermato.";
    case "workflow_scheduler_mismatch": return "Il coordinamento degli agenti non ha superato il controllo di coerenza.";
    case "interrupted_after_restart": return "Il servizio è stato riavviato durante il test. Avvia una nuova esecuzione.";
    default: return "Il test non è stato completato. I dettagli tecnici non sicuri non vengono mostrati.";
  }
}
function activeRunStatus(status) {
  return status === "pending" || status === "running";
}
function renderRun(payload, csrf) {
  const run = payload?.run || {};
  const runId = runIdFrom(payload);
  const rawProjectId = String(run.project_id || payload?.project_id || "");
  const projectId = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,78}[A-Za-z0-9])?$/.test(rawProjectId) ? rawProjectId : "";
  const status = String(run.status || payload?.status || "in elaborazione");
  const stages = Array.isArray(run.stages) ? run.stages : [];
  const output = String(run.final_output || payload?.final_output || "").trim();
  const active = activeRunStatus(status);
  const failure = ["failed", "interrupted", "cancelled"].includes(status)
    ? `<div role="alert" style="border:1px solid #d7a900;background:#fff8d8;border-radius:12px;padding:14px;margin:16px 0">${escapeHtml(runFailureMessage(run.error_code || payload?.error_code))}</div>`
    : "";
  const activeControls = runId && active
    ? `${button("Aggiorna risultato", `${AGENT_PORTAL_PATH}/runs/${encodeURIComponent(runId)}`)}<form method="post" action="${AGENT_PORTAL_PATH}/runs/${encodeURIComponent(runId)}/cancel"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button style="width:100%;border:1px solid #c62828;background:#fff;color:#a11313;padding:13px;border-radius:12px;font-weight:700">Annulla esecuzione</button></form>`
    : "";
  return `${projectId ? `<p><strong>Progetto:</strong> <code>${escapeHtml(projectId)}</code></p>` : ""}<p><strong>Stato:</strong> ${escapeHtml(status)}</p>${failure}${stages.length ? `<ol>${stages.map((stage) => `<li>${escapeHtml(stage.role || stage.name || "Agente")}: ${escapeHtml(stage.status || "")}${stage.output ? `<div style="white-space:pre-wrap;margin-top:6px">${escapeHtml(stage.output)}</div>` : ""}</li>`).join("")}</ol>` : ""}${output ? `<h2>Risultato Nyra</h2><div style="white-space:pre-wrap;border-radius:12px;background:#f3f3f4;padding:16px">${escapeHtml(output)}</div>` : ""}${activeControls}${button("Nuovo test", AGENT_PORTAL_PATH)}`;
}

export function createOpenAiConnectPortal({
  config,
  authenticate,
  issueSetupLink,
  providerStatus,
  startMultiAgentRun,
  readMultiAgentRun,
  cancelMultiAgentRun,
  fetchImpl = fetch,
  now = () => Date.now(),
}) {
  const enabled = Boolean(config.auth0BrowserClientId && config.auth0BrowserCallbackUrl && config.auth0BrowserStateSecret && config.auth0BrowserAudience && config.auth0Issuer);
  // Derive both AEAD keys once at process startup. Public requests never run a
  // password KDF on attacker-controlled input, and the session/key purposes
  // remain cryptographically separate even though Render stores one secret.
  const stateKey = enabled ? deriveKey(config.auth0BrowserStateSecret, "skinharmony-openai-connect-v1") : null;
  const agentSessionKey = enabled ? deriveKey(config.auth0BrowserStateSecret, "skinharmony-openai-agents-session-v1") : null;
  // `providerSetupOwner` comes only from a verified OAuth tenant-role claim.
  // A client ID, a URL parameter, or an arbitrary tenant string can never
  // authorize credential entry.
  const owner = (identity) => identity?.kind === "oauth" && identity?.providerSetupOwner === true &&
    ["tenant_owner", "tenant_admin", "owner_root"].includes(identity?.role);
  const oauthStart = (res, kind) => {
    if (!enabled) return portalHtml(res, 503, page("Configurazione non disponibile", "<p>Il collegamento sicuro non è ancora configurato.</p>"));
    const verifier = crypto.randomBytes(48).toString("base64url");
    const state = b64(seal(stateKey, {
      kind,
      verifier,
      nonce: crypto.randomBytes(32).toString("base64url"),
      expires_at: now() + MAX_AGE_MS,
    }));
    const authorize = new URL(`${config.auth0Issuer}/authorize`);
    authorize.search = new URLSearchParams({ response_type: "code", client_id: config.auth0BrowserClientId, redirect_uri: config.auth0BrowserCallbackUrl, scope: "openid profile", audience: config.auth0BrowserAudience, state, code_challenge: challenge(verifier), code_challenge_method: "S256" }).toString();
    return res.redirect(302, authorize.toString());
  };
  const agentSession = (req) => {
    const session = agentSessionKey ? open(agentSessionKey, cookie(req, AGENT_PORTAL_SESSION_COOKIE)) : null;
    if (
      !session ||
      session.kind !== "openai_agents_session_v1" ||
      session.expires_at <= now() ||
      !owner(session.identity) ||
      !session.csrf ||
      (session.last_run_id && !/^run_[A-Za-z0-9_-]{1,150}$/.test(session.last_run_id))
    ) return null;
    return session;
  };
  const validOrigin = (req) => {
    const origin = String(req.headers.origin || "");
    const site = String(req.headers["sec-fetch-site"] || "").toLowerCase();
    if (site === "cross-site") return false;
    if (!origin || origin === "null") {
      // SameSite=Lax prevents the session cookie on a cross-site POST and the
      // random CSRF token remains mandatory. In-app and privacy browsers may omit
      // Origin or send the opaque value `null`; accept only document navigations
      // that are not explicitly cross-site.
      const mode = String(req.headers["sec-fetch-mode"] || "").toLowerCase();
      const destination = String(req.headers["sec-fetch-dest"] || "").toLowerCase();
      return (!site || site === "same-origin" || site === "none") &&
        (!mode || mode === "navigate") &&
        (!destination || destination === "document");
    }
    try { return origin === new URL(config.auth0BrowserCallbackUrl).origin; } catch { return false; }
  };
  const csrfValid = (req, session) => {
    const receivedValue = String(req.body?.csrf || "");
    const expectedValue = String(session?.csrf || "");
    if (!/^[A-Za-z0-9_-]{43}$/.test(receivedValue) || !/^[A-Za-z0-9_-]{43}$/.test(expectedValue)) return false;
    const received = Buffer.from(receivedValue);
    const expected = Buffer.from(expectedValue);
    return validOrigin(req) && received.length === expected.length && received.length > 0 && crypto.timingSafeEqual(received, expected);
  };
  const writeAgentSession = (res, { identity, csrf, expiresAt, lastRunId = "" }) => {
    const identityForPortal = safeIdentity(identity);
    const validLastRunId = /^run_[A-Za-z0-9_-]{1,150}$/.test(lastRunId) ? lastRunId : "";
    const sessionEnvelope = seal(agentSessionKey, {
      kind: "openai_agents_session_v1",
      identity: identityForPortal,
      csrf,
      expires_at: expiresAt,
      ...(validLastRunId ? { last_run_id: validLastRunId } : {}),
    });
    const maxAgeSeconds = Math.max(0, Math.floor((expiresAt - now()) / 1000));
    res.setHeader("set-cookie", `${AGENT_PORTAL_SESSION_COOKIE}=${sessionEnvelope}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`);
    return identityForPortal;
  };
  const setAgentSession = (res, identity) => writeAgentSession(res, {
    identity,
    csrf: crypto.randomBytes(32).toString("base64url"),
    expiresAt: now() + AGENT_PORTAL_SESSION_AGE_MS,
  });
  const rememberRun = (res, session, runId) => writeAgentSession(res, {
    identity: session.identity,
    csrf: session.csrf,
    expiresAt: session.expires_at,
    lastRunId: runId,
  });
  return {
    async start(req, res) {
      // The complete short-lived PKCE attempt lives in the authenticated state
      // envelope. Embedded and privacy browsers frequently discard cookies
      // during the cross-site Auth0 round trip, so this flow intentionally does
      // not rely on a browser cookie at any point.
      // Wrap the sealed envelope once more as base64url. Some embedded OAuth
      // navigators normalize punctuation in query values; a single URL-safe
      // token avoids separator rewriting while retaining authenticated PKCE.
      return oauthStart(res, "openai_connect_pkce_v2");
    },
    async callback(req, res) {
      const state = String(req.query.state || ""), code = String(req.query.code || "");
      let session = null;
      try {
        if (state.length <= 8_192 && /^[A-Za-z0-9_-]+$/.test(state)) session = open(stateKey, unb64(state).toString("utf8"));
      } catch {}
      if (!session || !["openai_connect_pkce_v2", "openai_agents_pkce_v1"].includes(session.kind) || session.expires_at <= now() || !session.verifier || !code) return portalHtml(res, 400, page("Accesso non valido", "<p>Riprova dal link iniziale.</p>"));
      try {
        const body = new URLSearchParams({ grant_type: "authorization_code", client_id: config.auth0BrowserClientId, code, redirect_uri: config.auth0BrowserCallbackUrl, code_verifier: session.verifier });
        if (config.auth0BrowserClientSecret) body.set("client_secret", config.auth0BrowserClientSecret);
        const response = await fetchImpl(`${config.auth0Issuer}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
        const tokens = await response.json(); if (!response.ok || !tokens.access_token) throw new Error("oauth_exchange_failed");
        const identity = await authenticate(`Bearer ${tokens.access_token}`); if (!owner(identity)) throw new Error("owner_required");
        // Refresh the same short-lived tenant-bound portal session for both
        // entry paths. Returning from a direct OpenAI connection must not fall
        // back to a stale session belonging to another tenant identity.
        const identityForPortal = setAgentSession(res, identity);
        if (session.kind === "openai_agents_pkce_v1") {
          // First-run onboarding is automatic. If this tenant is not ready, mint
          // the one-time capability during the verified OAuth callback and open
          // the protected Core form immediately. This removes the fragile
          // callback -> portal -> POST Continue hop from every client.
          let status;
          try {
            status = providerStatusForTenant(
              await providerStatus({}, identityForPortal),
              identityForPortal.tenantId,
            );
          } catch {
            return portalHtml(res, 503, agentPortalPage("Verifica non disponibile", `<p>La sessione owner è valida, ma non è stato possibile controllare il vault. Nessun collegamento è stato creato.</p>${button("Riprova", AGENT_PORTAL_PATH)}`));
          }
          const provider = status?.provider;
          if (!provider
            || typeof provider.configured !== "boolean"
            || typeof provider.execution_available !== "boolean"
            || typeof provider.bounded_execution_ready !== "boolean") {
            return portalHtml(res, 503, agentPortalPage("Verifica non disponibile", `<p>Il vault ha restituito uno stato incompleto. Nessun collegamento è stato creato.</p>${button("Riprova", AGENT_PORTAL_PATH)}`));
          }
          if (provider.configured !== true || provider.execution_available !== true) {
            try {
              const link = await issueSetupLink(identityForPortal);
              return res.redirect(303, secureSetupRedirect(link, config, identityForPortal.tenantId));
            } catch (error) {
              const [title, body] = setupLinkFailure(error);
              return portalHtml(res, 503, agentPortalPage(title, `${body}${button("Riprova il collegamento", "/connect/openai")}`));
            }
          }
          if (provider.bounded_execution_ready !== true) {
            return portalHtml(res, 503, agentPortalPage(
              "Contesto progetto non disponibile",
              `<p>La chiave è collegata, ma la memoria progetto persistente non è disponibile. Nessun agente è stato avviato.</p>${button("Riprova", AGENT_PORTAL_PATH)}`,
            ));
          }
          return res.redirect(303, AGENT_PORTAL_PATH);
        }
        // Mint and consume the browser-independent one-time capability in the
        // same verified OAuth callback. This deliberately removes the former
        // callback -> cookie -> Continue POST hop, which fails in in-app and
        // privacy browsers even after a successful login.
        try {
          const link = await issueSetupLink(identityForPortal);
          return res.redirect(303, secureSetupRedirect(link, config, identityForPortal.tenantId));
        } catch (error) {
          const [title, body] = setupLinkFailure(error);
          return portalHtml(res, 503, page(title, body));
        }
      } catch (error) { return portalHtml(res, 403, page("Accesso non autorizzato", `<p>${accessFailure(error)}</p><p>Riprova dal link iniziale.</p>`)); }
    },
    async continue(_req, res) {
      // Kept only as a safe response for stale pages cached before the direct
      // callback flow. It never relies on cookies and never creates a link.
      return portalHtml(res, 410, page("Link scaduto", "<p>Apri di nuovo il collegamento iniziale.</p>"));
    },
    async agentsLogin(_req, res) {
      return oauthStart(res, "openai_agents_pkce_v1");
    },
    async agentsConnect(req, res) {
      const session = agentSession(req);
      if (!session) return portalHtml(res, 401, agentPortalPage("Sessione scaduta", button("Accedi di nuovo", `${AGENT_PORTAL_PATH}/login`)));
      if (!csrfValid(req, session)) return portalHtml(res, 403, agentPortalPage("Richiesta non valida", `<p>Il browser non ha conservato correttamente la sessione del pulsante.</p>${button("Apri il collegamento sicuro", "/connect/openai")}`));
      try {
        // Reuse the already verified cross-client owner session. This keeps tenant,
        // subject and role identical between the status page and the one-time
        // credential link, and avoids a second OAuth round trip/new browser tab.
        const link = await issueSetupLink(session.identity);
        return res.redirect(303, secureSetupRedirect(link, config, session.identity.tenantId));
      } catch (error) {
        const [title, body] = setupLinkFailure(error);
        return portalHtml(res, 503, agentPortalPage(title, body));
      }
    },
    async agentsHome(req, res) {
      const session = agentSession(req);
      if (!session) return portalHtml(res, 200, agentPortalPage("Portale multi-agente", `<p>Accedi con il tuo account da ChatGPT, Codex o qualsiasi browser su Android, iOS e computer. La chiave OpenAI resta nel vault cifrato e non passa mai nella chat.</p>${button("Accedi e continua", `${AGENT_PORTAL_PATH}/login`)}`));
      try {
        const payload = providerStatusForTenant(
          await providerStatus({}, session.identity),
          session.identity.tenantId,
        );
        const provider = payload?.provider || {};
        const ready = provider.bounded_execution_ready === true;
        const verificationRequested = String(req.query?.verify || "") === "1";
        const recovery = session.last_run_id
          ? `<div role="status" style="border:1px solid #b9c7dc;background:#f2f6fc;border-radius:12px;padding:14px;margin:16px 0"><strong>Hai un’esecuzione recente.</strong>${button("Riprendi ultima esecuzione", `${AGENT_PORTAL_PATH}/runs/${encodeURIComponent(session.last_run_id)}`)}</div>`
          : "";
        if (!ready) {
          const verification = verificationRequested
            ? `<div role="status" style="border:1px solid #d7a900;background:#fff8d8;border-radius:12px;padding:14px;margin:16px 0"><strong>Controllo eseguito adesso.</strong><br>${provider.configured === true ? "La chiave risulta salvata, ma il runtime multi-agente non è ancora disponibile." : "La chiave non risulta ancora collegata a questo account."}</div>`
            : "";
          return portalHtml(res, 200, agentPortalPage("Collega OpenAI", `<p>Per avviare gli agenti inserisci la tua chiave nella pagina protetta. Non verrà mostrata in chat, URL o log.</p>${recovery}${verification}${connectForm(session.csrf, provider.configured ? "Verifica o sostituisci chiave" : "Collega la chiave OpenAI")}<p style="color:#666">Il collegamento riusa questa sessione owner e apre direttamente il modulo sicuro per lo stesso account. Dopo il salvataggio tornerai qui.</p>${button("Verifica configurazione", `${AGENT_PORTAL_PATH}?verify=1`)}${logoutForm(session.csrf)}`));
        }
        const verification = verificationRequested
          ? '<div role="status" style="border:1px solid #2e7d32;background:#edf8ee;border-radius:12px;padding:14px;margin:16px 0"><strong>Configurazione verificata:</strong> OpenAI e il test multi-agente sono pronti.</div>'
          : "";
        return portalHtml(res, 200, agentPortalPage("Avvia test multi-agente", `${verification}${recovery}<p><strong>Ricercatore → Architettura/Codice → Nyra supervisore</strong></p><p>Il test crea o riusa una cartella progetto persistente e isolata nel tuo tenant, così gli agenti mantengono obiettivi, decisioni e passaggi consegnati. Usa al massimo 3 chiamate OpenAI e 200 token di output per fase.</p><form method="post" action="${AGENT_PORTAL_PATH}/run"><input type="hidden" name="csrf" value="${escapeHtml(session.csrf)}"><label for="project_title" style="display:block;font-weight:700;margin:0 0 8px">Titolo progetto</label><input id="project_title" name="project_title" minlength="2" maxlength="160" required style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #bbb;border-radius:12px;font:inherit;margin-bottom:16px" placeholder="Es. Portale clienti SkinHarmony"><label for="specialist" style="display:block;font-weight:700;margin-bottom:8px">Specialista centrale</label><select id="specialist" name="specialist" required style="box-sizing:border-box;width:100%;padding:12px;border:1px solid #bbb;border-radius:12px;font:inherit;margin-bottom:16px"><option value="architecture">Architettura</option><option value="code">Codice</option></select><label for="task" style="display:block;font-weight:700;margin-bottom:8px">Attività da svolgere</label><textarea id="task" name="task" maxlength="300" required style="box-sizing:border-box;width:100%;min-height:130px;padding:12px;border:1px solid #bbb;border-radius:12px;font:inherit" placeholder="Descrivi un test concreto..."></textarea><label style="display:flex;gap:10px;margin:16px 0"><input type="checkbox" name="confirmed" value="yes" required><span>Confermo la creazione o il riuso della cartella tenant-scoped e il consumo massimo di 3 chiamate della mia API OpenAI.</span></label><button style="width:100%;border:0;background:#111;color:#fff;padding:14px;border-radius:12px;font-weight:700">Avvia i 3 agenti</button></form>${logoutForm(session.csrf)}`));
      } catch {
        return portalHtml(res, 503, agentPortalPage("Servizio non disponibile", `<p>Non è stato possibile verificare il vault. Riprova tra poco.</p>${button("Riprova", AGENT_PORTAL_PATH)}`));
      }
    },
    async agentsRunStart(req, res) {
      const session = agentSession(req);
      if (!session) return portalHtml(res, 401, agentPortalPage("Sessione scaduta", button("Accedi di nuovo", `${AGENT_PORTAL_PATH}/login`)));
      if (!csrfValid(req, session)) return portalHtml(res, 403, agentPortalPage("Richiesta non valida", "<p>Riapri la pagina iniziale e riprova.</p>"));
      const task = String(req.body?.task || "").trim();
      const projectTitle = String(req.body?.project_title || "").trim();
      const specialist = String(req.body?.specialist || "").trim();
      if (
        req.body?.confirmed !== "yes" ||
        projectTitle.length < 2 ||
        projectTitle.length > 160 ||
        !["architecture", "code"].includes(specialist) ||
        task.length < 3 ||
        task.length > 300
      ) return portalHtml(res, 400, agentPortalPage("Controlla i dati", `<p>Inserisci un titolo progetto da 2 a 160 caratteri, scegli Architettura o Codice, descrivi un’attività da 3 a 300 caratteri e conferma il test limitato.</p>${button("Torna al test", AGENT_PORTAL_PATH)}`));
      try {
        const identity = {
          ...session.identity,
          providerExecutionConfirmed: true,
          providerExecutionConfirmationReference: `agent_portal_${crypto.randomBytes(16).toString("hex")}`,
        };
        const payload = resultPayload(await startMultiAgentRun({
          task,
          project_title: projectTitle,
          project_objective: task,
          specialist,
        }, identity));
        const runId = runIdFrom(payload);
        if (!runId) throw new Error("multi_agent_start_response_invalid");
        rememberRun(res, session, runId);
        return res.redirect(303, `${AGENT_PORTAL_PATH}/runs/${encodeURIComponent(runId)}`);
      } catch (error) {
        const failure = startFailure(error);
        if (failure.status === 429) res.set("retry-after", "60");
        return portalHtml(res, failure.status, agentPortalPage(failure.title, `<p>${escapeHtml(failure.message)}</p>${button("Torna al portale", AGENT_PORTAL_PATH)}`));
      }
    },
    async agentsRunRead(req, res) {
      const session = agentSession(req);
      if (!session) return portalHtml(res, 401, agentPortalPage("Sessione scaduta", button("Accedi di nuovo", `${AGENT_PORTAL_PATH}/login`)));
      const runId = String(req.params.runId || "");
      if (!/^run_[A-Za-z0-9_-]{1,150}$/.test(runId)) return portalHtml(res, 400, agentPortalPage("Esecuzione non valida", button("Torna al portale", AGENT_PORTAL_PATH)));
      try {
        const payload = resultPayload(await readMultiAgentRun({ run_id: runId }, session.identity));
        const runStatus = String(payload?.run?.status || payload?.status || "");
        const active = activeRunStatus(runStatus);
        if (session.last_run_id !== runId) rememberRun(res, session, runId);
        if (active) res.set("retry-after", "3");
        return portalHtml(
          res,
          active ? 202 : 200,
          agentPortalPage("Risultato multi-agente", renderRun(payload, session.csrf), {
            refreshPath: active ? `${AGENT_PORTAL_PATH}/runs/${encodeURIComponent(runId)}` : "",
          }),
        );
      } catch (error) {
        if (coreErrorCode(error) === "tenant_multi_agent_run_in_progress") {
          if (session.last_run_id !== runId) rememberRun(res, session, runId);
          res.set("retry-after", "3");
          return portalHtml(res, 202, agentPortalPage("Agenti al lavoro", `<p>Il Ricercatore, lo specialista Architettura/Codice e Nyra supervisore stanno completando il test.</p>${button("Aggiorna risultato", `${AGENT_PORTAL_PATH}/runs/${encodeURIComponent(runId)}`)}`, {
            refreshPath: `${AGENT_PORTAL_PATH}/runs/${encodeURIComponent(runId)}`,
          }));
        }
        return portalHtml(res, 404, agentPortalPage("Risultato non disponibile", `<p>L’esecuzione non appartiene a questo account oppure non è più disponibile.</p>${button("Torna al portale", AGENT_PORTAL_PATH)}`));
      }
    },
    async agentsRunCancel(req, res) {
      const session = agentSession(req);
      if (!session) return portalHtml(res, 401, agentPortalPage("Sessione scaduta", button("Accedi di nuovo", `${AGENT_PORTAL_PATH}/login`)));
      if (!csrfValid(req, session)) return portalHtml(res, 403, agentPortalPage("Richiesta non valida", "<p>Riapri la pagina iniziale e riprova.</p>"));
      const runId = String(req.params.runId || "");
      if (!/^run_[A-Za-z0-9_-]{1,150}$/.test(runId)) return portalHtml(res, 400, agentPortalPage("Esecuzione non valida", button("Torna al portale", AGENT_PORTAL_PATH)));
      try {
        const payload = resultPayload(await cancelMultiAgentRun({ run_id: runId }, session.identity));
        return portalHtml(res, 200, agentPortalPage("Esecuzione annullata", renderRun(payload, session.csrf)));
      } catch {
        return portalHtml(res, 409, agentPortalPage("Annullamento non riuscito", `<p>L’esecuzione potrebbe essere già terminata.</p>${button("Controlla risultato", `${AGENT_PORTAL_PATH}/runs/${encodeURIComponent(runId)}`)}`));
      }
    },
    async agentsLogout(req, res) {
      const session = agentSession(req);
      if (!session || !csrfValid(req, session)) return portalHtml(res, 403, agentPortalPage("Richiesta non valida", button("Torna al portale", AGENT_PORTAL_PATH)));
      res.setHeader("set-cookie", `${AGENT_PORTAL_SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
      return res.redirect(303, AGENT_PORTAL_PATH);
    },
  };
}
