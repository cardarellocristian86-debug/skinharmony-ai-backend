const { loadEnv } = require("./mail/load_env");

loadEnv();

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
  }

  return text ? JSON.parse(text) : {};
}

async function refreshAccessToken() {
  const analyticsRefreshToken = process.env.GOOGLE_ANALYTICS_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;
  const refreshToken = analyticsRefreshToken || process.env.GMAIL_REFRESH_TOKEN;
  const clientId = analyticsRefreshToken
    ? process.env.GOOGLE_ANALYTICS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
    : process.env.GOOGLE_CLIENT_ID;
  const clientSecret = analyticsRefreshToken
    ? process.env.GOOGLE_ANALYTICS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
    : process.env.GOOGLE_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      "Credenziali Google API mancanti. Imposta GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_ANALYTICS_REFRESH_TOKEN/GOOGLE_REFRESH_TOKEN."
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });

  const response = await fetchJson(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.access_token) {
    throw new Error("Refresh token Google API non ha restituito un access token.");
  }

  cachedToken = response.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max((response.expires_in || 3600) - 60, 60) * 1000;
  return cachedToken;
}

async function getGoogleAccessToken() {
  if (process.env.GMAIL_API_ACCESS_TOKEN) {
    return process.env.GMAIL_API_ACCESS_TOKEN;
  }

  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken;
  }

  return refreshAccessToken();
}

async function googleApiRequest(url, options = {}) {
  const token = await getGoogleAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };

  return fetchJson(url, {
    ...options,
    headers
  });
}

module.exports = {
  getGoogleAccessToken,
  googleApiRequest
};
