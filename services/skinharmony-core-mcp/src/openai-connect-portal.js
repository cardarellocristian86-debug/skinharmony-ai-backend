import crypto from "node:crypto";

const COOKIE = "sh_openai_connect";
const MAX_AGE_MS = 10 * 60 * 1000;

function b64(value) { return Buffer.from(value).toString("base64url"); }
function unb64(value) { return Buffer.from(value, "base64url"); }
function challenge(value) { return crypto.createHash("sha256").update(value).digest("base64url"); }
function cookie(req, name) { return String(req.headers.cookie || "").split(/;\s*/).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ""; }
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
  try { const key = crypto.scryptSync(secret, "skinharmony-openai-connect-v1", 32), decipher = crypto.createDecipheriv("aes-256-gcm", key, unb64(iv)); decipher.setAuthTag(unb64(tag)); return JSON.parse(Buffer.concat([decipher.update(unb64(ciphertext)), decipher.final()]).toString("utf8")); } catch { return null; }
}

export function createOpenAiConnectPortal({ config, authenticate, issueSetupLink, providerStatus, fetchImpl = fetch, now = () => Date.now() }) {
  const enabled = Boolean(config.auth0BrowserClientId && config.auth0BrowserCallbackUrl && config.auth0BrowserStateSecret && config.auth0BrowserAudience && config.auth0Issuer);
  // Auth0 returns from a different site. Keep the sealed, HttpOnly state cookie
  // available to that top-level OAuth callback, including embedded host browsers.
  // CSRF protection still comes from the cryptographically random state value.
  const setCookie = (res, value, maxAge = MAX_AGE_MS) => res.set("set-cookie", `${COOKIE}=${value}; Path=/connect/openai; HttpOnly; Secure; SameSite=None; Max-Age=${Math.floor(maxAge / 1000)}`);
  const load = (req) => open(config.auth0BrowserStateSecret, cookie(req, COOKIE));
  // `providerSetupOwner` is minted only by the OAuth authenticator after it
  // matched the human subject against the owner allowlist. An application
  // client ID alone is never sufficient to enter a credential.
  const owner = (identity) => identity?.kind === "oauth" && identity?.godMode === true &&
    identity?.role === "owner_root" && identity?.providerSetupOwner === true;
  return {
    async start(req, res) {
      if (!enabled) return portalHtml(res, 503, page("Configurazione non disponibile", "<p>Il collegamento sicuro non è ancora configurato.</p>"));
      const session = load(req);
      if (session?.tenant_id && session.expires_at > now() && owner(session.identity)) {
        let configured = false;
        try { configured = (await providerStatus(session.tenant_id))?.provider?.configured === true; } catch {}
        const label = configured ? "OpenAI già collegato" : "Collega OpenAI";
        const actionLabel = configured ? "Sostituisci in modo sicuro" : "Continua";
        const csrf = String(session.continue_csrf || "");
        if (!csrf) return res.redirect(303, "/connect/openai");
        return portalHtml(res, 200, page(label, `<p>${configured ? "La chiave è già salvata in forma cifrata. Puoi sostituirla con una nuova." : "Inserirai la chiave solo nella pagina protetta, mai in chat."}</p><form method="post" action="/connect/openai/continue"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">${actionLabel}</button></form>`));
      }
      const verifier = crypto.randomBytes(48).toString("base64url"), state = crypto.randomBytes(32).toString("base64url");
      setCookie(res, seal(config.auth0BrowserStateSecret, { verifier, state, expires_at: now() + MAX_AGE_MS }));
      const authorize = new URL(`${config.auth0Issuer}/authorize`);
      authorize.search = new URLSearchParams({ response_type: "code", client_id: config.auth0BrowserClientId, redirect_uri: config.auth0BrowserCallbackUrl, scope: "openid profile", audience: config.auth0BrowserAudience, state, code_challenge: challenge(verifier), code_challenge_method: "S256" }).toString();
      return res.redirect(302, authorize.toString());
    },
    async callback(req, res) {
      const session = load(req), state = String(req.query.state || ""), code = String(req.query.code || "");
      const expected = Buffer.from(String(session?.state || "")), received = Buffer.from(state);
      if (!session || session.expires_at <= now() || !code || expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return portalHtml(res, 400, page("Accesso non valido", "<p>Riprova dal link iniziale.</p>"));
      try {
        const body = new URLSearchParams({ grant_type: "authorization_code", client_id: config.auth0BrowserClientId, code, redirect_uri: config.auth0BrowserCallbackUrl, code_verifier: session.verifier });
        if (config.auth0BrowserClientSecret) body.set("client_secret", config.auth0BrowserClientSecret);
        const response = await fetchImpl(`${config.auth0Issuer}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
        const tokens = await response.json(); if (!response.ok || !tokens.access_token) throw new Error("oauth_exchange_failed");
        const identity = await authenticate(`Bearer ${tokens.access_token}`); if (!owner(identity)) throw new Error("owner_required");
        setCookie(res, seal(config.auth0BrowserStateSecret, {
          identity,
          tenant_id: identity.tenantId,
          continue_csrf: crypto.randomBytes(32).toString("base64url"),
          expires_at: now() + MAX_AGE_MS,
        }));
        return res.redirect(303, "/connect/openai");
      } catch (error) { return portalHtml(res, 403, page("Accesso non autorizzato", `<p>${accessFailure(error)}</p><p>Riprova dal link iniziale.</p>`)); }
    },
    async continue(req, res) {
      const session = load(req);
      const expected = Buffer.from(String(session?.continue_csrf || ""));
      const received = Buffer.from(String(req.body?.csrf || ""));
      if (!session?.tenant_id || session.expires_at <= now() || !owner(session.identity) || !expected.length || expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
        return portalHtml(res, 400, page("Accesso non valido", "<p>Riprova dal link iniziale.</p>"));
      }
      try {
        const link = await issueSetupLink(session.identity);
        const redirect = secureSetupRedirect(link, config);
        setCookie(res, "", 0);
        return res.redirect(303, redirect);
      } catch (error) {
        const [title, body] = setupLinkFailure(error);
        return portalHtml(res, 503, page(title, body));
      }
    },
  };
}
