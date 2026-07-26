import crypto from "node:crypto";
import { createOwnerConfirmationGrantLedger } from "./owner-confirmation-grant.js";

const MAX_AGE_MS = 10 * 60 * 1000;
const OWNER_CONFIRMATION_COOKIE = "__Host-skinharmony_owner_confirm";

function b64(value) { return Buffer.from(value).toString("base64url"); }
function unb64(value) { return Buffer.from(value, "base64url"); }
function challenge(value) { return crypto.createHash("sha256").update(value).digest("base64url"); }
function page(title, body) { return `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:24px"><h1>${title}</h1>${body}</body></html>`; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
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
function safeIdentity(identity) {
  return {
    kind: "oauth",
    subject: String(identity.subject || ""),
    tenantId: String(identity.tenantId || ""),
    role: String(identity.role || "tenant_owner"),
    providerSetupOwner: true,
    oauthOwnerBound: identity.oauthOwnerBound === true,
    ownerConfirmationGrant: identity.ownerConfirmationGrant === true,
    ...(identity.ownerGrantNonce ? { ownerGrantNonce: String(identity.ownerGrantNonce) } : {}),
    ...(identity.ownerGrantSessionId ? { ownerGrantSessionId: String(identity.ownerGrantSessionId) } : {}),
  };
}

export function createOpenAiConnectPortal({
  config,
  authenticate,
  fetchImpl = fetch,
  now = () => Date.now(),
  ownerGrantLedger = createOwnerConfirmationGrantLedger({ requirePersistent: config.decisionLedgerRequired === true }),
}) {
  const enabled = Boolean(config.auth0BrowserClientId && config.auth0BrowserCallbackUrl && config.auth0BrowserStateSecret && config.auth0BrowserAudience && config.auth0Issuer);
  // Derive both AEAD keys once at process startup. Public requests never run a
  // password KDF on attacker-controlled input, and the session/key purposes
  // remain cryptographically separate even though Render stores one secret.
  const stateKey = enabled ? deriveKey(config.auth0BrowserStateSecret, "skinharmony-openai-connect-v1") : null;
  const confirmationKey = enabled ? deriveKey(config.auth0BrowserStateSecret, "skinharmony-owner-confirm-v1") : null;
  // `providerSetupOwner` comes only from a verified OAuth tenant-role claim.
  // A client ID, a URL parameter, or an arbitrary tenant string can never
  // authorize credential entry.
  const owner = (identity) => identity?.kind === "oauth" && identity?.ownerConfirmationGrant === true && identity?.oauthOwnerBound === true;
  const oauthStart = async (req, res, kind) => {
    if (!enabled) return portalHtml(res, 503, page("Configurazione non disponibile", "<p>Il collegamento sicuro non è ancora configurato.</p>"));
    const requestedChallenge = String(req?.query?.challenge_id || "").trim();
    if (!requestedChallenge) return portalHtml(res, 400, page("Conferma richiesta", "<p>Apri il collegamento dalla richiesta MCP.</p>"));
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challengeId = requestedChallenge;
    const state = b64(seal(stateKey, {
      kind,
      ...(challengeId ? { challenge_id: challengeId } : {}),
      verifier,
      nonce: crypto.randomBytes(32).toString("base64url"),
      expires_at: now() + MAX_AGE_MS,
    }));
    const authorize = new URL(`${config.auth0Issuer}/authorize`);
    authorize.search = new URLSearchParams({ response_type: "code", client_id: config.auth0BrowserClientId, redirect_uri: config.auth0BrowserCallbackUrl, scope: "openid profile", audience: config.auth0BrowserAudience, max_age: "300", prompt: "login", state, code_challenge: challenge(verifier), code_challenge_method: "S256" }).toString();
    return res.redirect(302, authorize.toString());
  };
  const confirmationSession = (req) => {
    const value = cookie(req, OWNER_CONFIRMATION_COOKIE);
    if (!value || !confirmationKey) return null;
    try {
      const session = open(confirmationKey, value);
      if (session.expires_at <= now() || !session.challenge_id || !session.csrf || session.identity?.kind !== "oauth" || session.identity?.oauthOwnerBound !== true) return null;
      return session;
    } catch { return null; }
  };
  const setConfirmationSession = (res, session) => {
    const sealed = seal(confirmationKey, session);
    res.setHeader("set-cookie", `${OWNER_CONFIRMATION_COOKIE}=${sealed}; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Lax`);
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
  return {
    async start(req, res) {
      // The complete short-lived PKCE attempt lives in the authenticated state
      // envelope. Embedded and privacy browsers frequently discard cookies
      // during the cross-site Auth0 round trip, so this flow intentionally does
      // not rely on a browser cookie at any point.
      // Wrap the sealed envelope once more as base64url. Some embedded OAuth
      // navigators normalize punctuation in query values; a single URL-safe
      // token avoids separator rewriting while retaining authenticated PKCE.
      return oauthStart(req, res, "openai_connect_pkce_v2");
    },
    async callback(req, res) {
      const state = String(req.query.state || ""), code = String(req.query.code || "");
      let session = null;
      try {
        if (state.length <= 8_192 && /^[A-Za-z0-9_-]+$/.test(state)) session = open(stateKey, unb64(state).toString("utf8"));
      } catch {}
      if (!session || session.kind !== "openai_connect_pkce_v2" || session.expires_at <= now() || !session.verifier || !code || !session.challenge_id) return portalHtml(res, 400, page("Accesso non valido", "<p>Riprova dal link iniziale.</p>"));
      try {
        const body = new URLSearchParams({ grant_type: "authorization_code", client_id: config.auth0BrowserClientId, code, redirect_uri: config.auth0BrowserCallbackUrl, code_verifier: session.verifier });
        if (config.auth0BrowserClientSecret) body.set("client_secret", config.auth0BrowserClientSecret);
        const response = await fetchImpl(`${config.auth0Issuer}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
        const tokens = await response.json(); if (!response.ok || !tokens.access_token) throw new Error("oauth_exchange_failed");
        let identity = await authenticate(`Bearer ${tokens.access_token}`);
        if (session.challenge_id) {
          const authTime = Number(identity?.authenticatedAt);
          const nowSeconds = Math.floor(now() / 1000);
          if (!Number.isFinite(authTime) || authTime > nowSeconds + 30 || nowSeconds - authTime > 300) throw new Error("owner_authentication_stale");
        }
        // A configured owner subject is still a member by default. The fresh
        // PKCE callback is the explicit one-time owner confirmation and is
        // bound to the sealed state nonce; no tenant or role comes from URL
        // input.
        if (session.challenge_id && identity.oauthOwnerBound === true) {
          const details = await ownerGrantLedger.getChallenge({ challengeId: session.challenge_id, tenantId: identity.tenantId, subject: identity.subject, now: new Date(now()) });
          const csrf = crypto.randomBytes(32).toString("base64url");
          setConfirmationSession(res, { challenge_id: session.challenge_id, identity: safeIdentity(identity), csrf, expires_at: now() + 300_000 });
          let summary = details.summary;
          try { summary = JSON.stringify(JSON.parse(details.summary), null, 2); } catch { summary = String(details.summary || details.toolName); }
          const limits = details.toolName === "tenant_provider_openai_multi_agent_smoke_run" ? "Massimo 3 agenti e 3 chiamate sequenziali; nessun browser, tool esterno o azione pubblica." : "Solo sul run autorizzato; read/report/cancel restano vincolati al run_id.";
          return portalHtml(res, 200, page("Conferma lavoro protetto", `<p><strong>Operazione:</strong> ${escapeHtml(details.toolName)}</p><p><strong>Riepilogo sanitizzato:</strong></p><pre style="white-space:pre-wrap;background:#f3f3f4;padding:12px;border-radius:10px">${escapeHtml(summary)}</pre><p><strong>Limiti:</strong> ${escapeHtml(limits)}</p><form method="post" action="/connect/openai/confirm"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button type="submit">Conferma modalità multi-agente</button></form>`));
        }
      } catch (error) { return portalHtml(res, 403, page("Accesso non autorizzato", `<p>${accessFailure(error)}</p><p>Riprova dal link iniziale.</p>`)); }
    },
    async confirm(req, res) {
      const session = confirmationSession(req);
      if (!session || !csrfValid(req, session)) return portalHtml(res, 403, page("Conferma non valida", "<p>La sessione owner è scaduta o il token CSRF non è valido.</p>"));
      try {
        await ownerGrantLedger.approveChallenge({ challengeId: session.challenge_id, tenantId: session.identity.tenantId, subject: session.identity.subject, now: new Date(now()) });
        res.setHeader("set-cookie", `${OWNER_CONFIRMATION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`);
        return portalHtml(res, 200, page("Conferma registrata", "<p>Torna alla richiesta MCP originale per completare l’operazione.</p>"));
      } catch { return portalHtml(res, 409, page("Conferma non disponibile", "<p>La challenge è scaduta o già utilizzata.</p>")); }
    },
    async continue(_req, res) {
      // Kept only as a safe response for stale pages cached before the direct
      // callback flow. It never relies on cookies and never creates a link.
      return portalHtml(res, 410, page("Link scaduto", "<p>Apri di nuovo il collegamento iniziale.</p>"));
    },
  };
}
