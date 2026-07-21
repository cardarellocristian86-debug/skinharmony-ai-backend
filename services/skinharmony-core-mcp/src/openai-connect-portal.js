import crypto from "node:crypto";

const MAX_AGE_MS = 10 * 60 * 1000;

function b64(value) { return Buffer.from(value).toString("base64url"); }
function unb64(value) { return Buffer.from(value, "base64url"); }
function challenge(value) { return crypto.createHash("sha256").update(value).digest("base64url"); }
function page(title, body) { return `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:24px"><h1>${title}</h1>${body}</body></html>`; }
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

function secureSetupRedirect(link, config) {
  const setupUrl = String(link?.setup_url || "");
  const proof = String(link?.setup_proof || "");
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

function seal(secret, payload) {
  const key = crypto.scryptSync(secret, "skinharmony-openai-connect-v1", 32);
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(ciphertext)}`;
}
function open(secret, value) {
  const [iv, tag, ciphertext] = String(value).split(".");
  if (!iv || !tag || !ciphertext) return null;
  try {
    const key = crypto.scryptSync(secret, "skinharmony-openai-connect-v1", 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, unb64(iv));
    decipher.setAuthTag(unb64(tag));
    return JSON.parse(Buffer.concat([decipher.update(unb64(ciphertext)), decipher.final()]).toString("utf8"));
  } catch { return null; }
}
export function createOpenAiConnectPortal({ config, authenticate, issueSetupLink, fetchImpl = fetch, now = () => Date.now() }) {
  const enabled = Boolean(config.auth0BrowserClientId && config.auth0BrowserCallbackUrl && config.auth0BrowserStateSecret && config.auth0BrowserAudience && config.auth0Issuer);
  // `providerSetupOwner` comes only from a verified OAuth tenant-role claim.
  // A client ID, a URL parameter, or an arbitrary tenant string can never
  // authorize credential entry.
  const owner = (identity) => identity?.kind === "oauth" && identity?.providerSetupOwner === true &&
    ["tenant_owner", "tenant_admin", "owner_root"].includes(identity?.role);
  return {
    async start(req, res) {
      if (!enabled) return portalHtml(res, 503, page("Configurazione non disponibile", "<p>Il collegamento sicuro non è ancora configurato.</p>"));
      const verifier = crypto.randomBytes(48).toString("base64url");
      // The complete short-lived PKCE attempt lives in the authenticated state
      // envelope. Embedded and privacy browsers frequently discard cookies
      // during the cross-site Auth0 round trip, so this flow intentionally does
      // not rely on a browser cookie at any point.
      // Wrap the sealed envelope once more as base64url. Some embedded OAuth
      // navigators normalize punctuation in query values; a single URL-safe
      // token avoids separator rewriting while retaining authenticated PKCE.
      const state = b64(seal(config.auth0BrowserStateSecret, {
        kind: "openai_connect_pkce_v2",
        verifier,
        nonce: crypto.randomBytes(32).toString("base64url"),
        expires_at: now() + MAX_AGE_MS,
      }));
      const authorize = new URL(`${config.auth0Issuer}/authorize`);
      authorize.search = new URLSearchParams({ response_type: "code", client_id: config.auth0BrowserClientId, redirect_uri: config.auth0BrowserCallbackUrl, scope: "openid profile", audience: config.auth0BrowserAudience, state, code_challenge: challenge(verifier), code_challenge_method: "S256" }).toString();
      return res.redirect(302, authorize.toString());
    },
    async callback(req, res) {
      const state = String(req.query.state || ""), code = String(req.query.code || "");
      let session = null;
      try { session = open(config.auth0BrowserStateSecret, unb64(state).toString("utf8")); } catch {}
      if (!session || session.kind !== "openai_connect_pkce_v2" || session.expires_at <= now() || !session.verifier || !code) return portalHtml(res, 400, page("Accesso non valido", "<p>Riprova dal link iniziale.</p>"));
      try {
        const body = new URLSearchParams({ grant_type: "authorization_code", client_id: config.auth0BrowserClientId, code, redirect_uri: config.auth0BrowserCallbackUrl, code_verifier: session.verifier });
        if (config.auth0BrowserClientSecret) body.set("client_secret", config.auth0BrowserClientSecret);
        const response = await fetchImpl(`${config.auth0Issuer}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
        const tokens = await response.json(); if (!response.ok || !tokens.access_token) throw new Error("oauth_exchange_failed");
        const identity = await authenticate(`Bearer ${tokens.access_token}`); if (!owner(identity)) throw new Error("owner_required");
        // Mint and consume the browser-independent one-time capability in the
        // same verified OAuth callback. This deliberately removes the former
        // callback -> cookie -> Continue POST hop, which fails in in-app and
        // privacy browsers even after a successful login.
        try {
          const link = await issueSetupLink(identity);
          return res.redirect(303, secureSetupRedirect(link, config));
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
  };
}
