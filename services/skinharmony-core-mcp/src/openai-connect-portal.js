import crypto from "node:crypto";

const COOKIE = "sh_openai_connect";
const MAX_AGE_MS = 10 * 60 * 1000;

function b64(value) { return Buffer.from(value).toString("base64url"); }
function unb64(value) { return Buffer.from(value, "base64url"); }
function challenge(value) { return crypto.createHash("sha256").update(value).digest("base64url"); }
function cookie(req, name) { return String(req.headers.cookie || "").split(/;\s*/).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || ""; }
function page(title, body) { return `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:560px;margin:48px auto;padding:24px"><h1>${title}</h1>${body}</body></html>`; }

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
  const owner = (identity) => identity?.godMode === true && identity?.role === "owner_root";
  return {
    async start(req, res) {
      if (!enabled) return res.status(503).type("html").send(page("Configurazione non disponibile", "<p>Il collegamento sicuro non è ancora configurato.</p>"));
      const session = load(req);
      if (session?.tenant_id && session.expires_at > now() && owner(session.identity)) {
        const status = await providerStatus(session.tenant_id);
        const label = status?.provider?.configured ? "OpenAI già collegato" : "Collega OpenAI";
        return res.type("html").send(page(label, `<p>${status?.provider?.configured ? "La chiave è già salvata in forma cifrata. Puoi sostituirla con una nuova." : "Inserirai la chiave solo nella pagina protetta, mai in chat."}</p><a href="/connect/openai/continue">${status?.provider?.configured ? "Sostituisci in modo sicuro" : "Continua"}</a>`));
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
      if (!session || session.expires_at <= now() || !code || expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return res.status(400).type("html").send(page("Accesso non valido", "<p>Riprova dal link iniziale.</p>"));
      try {
        const body = new URLSearchParams({ grant_type: "authorization_code", client_id: config.auth0BrowserClientId, code, redirect_uri: config.auth0BrowserCallbackUrl, code_verifier: session.verifier });
        if (config.auth0BrowserClientSecret) body.set("client_secret", config.auth0BrowserClientSecret);
        const response = await fetchImpl(`${config.auth0Issuer}/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
        const tokens = await response.json(); if (!response.ok || !tokens.access_token) throw new Error("oauth_exchange_failed");
        const identity = await authenticate(`Bearer ${tokens.access_token}`); if (!owner(identity)) throw new Error("owner_required");
        setCookie(res, seal(config.auth0BrowserStateSecret, { identity, tenant_id: identity.tenantId, expires_at: now() + MAX_AGE_MS }));
        return res.redirect(303, "/connect/openai");
      } catch { return res.status(403).type("html").send(page("Accesso non autorizzato", "<p>È richiesto l’accesso owner del tenant autenticato.</p>")); }
    },
    async continue(req, res) {
      const session = load(req); if (!session?.tenant_id || session.expires_at <= now() || !owner(session.identity)) return res.redirect(303, "/connect/openai");
      try { const link = await issueSetupLink(session.tenant_id); setCookie(res, "", 0); return res.redirect(303, link.setup_url); } catch { return res.status(503).type("html").send(page("Servizio non disponibile", "<p>Riprova più tardi.</p>")); }
    },
  };
}
