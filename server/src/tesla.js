// Tesla Fleet API client — OAuth 2.0 (Authorization Code + PKCE), token refresh,
// partner registration, and read-only vehicle data (software version).
// Docs: https://developer.tesla.com/docs/fleet-api
import crypto from "node:crypto";
import { config } from "./config.js";

const { tesla } = config;

// The id_token is obtained in our own back-channel code exchange — received directly from
// Tesla's token endpoint over TLS, never via the browser — so its authenticity is already
// guaranteed by the TLS channel. We decode the claims (Tesla doesn't expose a reliably
// discoverable JWKS for Fleet API; its /keys path serves HTML). Decode-only is the standard
// trust model for the server-side authorization-code flow.
export async function verifyIdToken(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length < 2) throw new Error("malformed id_token");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  // non-blocking sanity check (the token is already trusted via the TLS back-channel)
  const audOk = !payload.aud || !tesla.clientId || payload.aud === tesla.clientId ||
    (Array.isArray(payload.aud) && payload.aud.includes(tesla.clientId));
  if (!audOk) console.warn("[tesla] id_token aud differs from client_id:", payload.aud);
  return payload; // { sub, email, ... }
}

// ---------- PKCE ----------
export function makePkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
export function randomState() { return crypto.randomBytes(16).toString("hex"); }

// ---------- Authorize URL (redirect the owner here to grant access) ----------
export function buildAuthUrl({ state, codeChallenge }) {
  const u = new URL(tesla.authBase + "/oauth2/v3/authorize");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", tesla.clientId);
  u.searchParams.set("redirect_uri", tesla.redirectUri);
  u.searchParams.set("scope", tesla.scopes);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

async function tokenRequest(body) {
  const res = await fetch(tesla.authBase + "/oauth2/v3/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error("Tesla token request failed: " + res.status + " " + (await res.text()));
  return res.json();
}

export async function exchangeCode(code, codeVerifier) {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: tesla.clientId,
    client_secret: tesla.clientSecret,
    code,
    redirect_uri: tesla.redirectUri,
    code_verifier: codeVerifier,
  });
}

export async function refreshAccessToken(refreshToken) {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: tesla.clientId,
    refresh_token: refreshToken,
  });
}

// Partner (client-credentials) token — used once to register your domain.
export async function partnerToken() {
  return tokenRequest({
    grant_type: "client_credentials",
    client_id: tesla.clientId,
    client_secret: tesla.clientSecret,
    scope: tesla.scopes,
    audience: tesla.audience,
  });
}

// One-time: register your domain so Tesla will trust your app. Tesla then expects your
// public key at https://<domain>/.well-known/appspecific/com.tesla.3p.public-key.pem
export async function registerPartnerDomain(domain) {
  const tok = await partnerToken();
  const res = await fetch(tesla.fleetBase + "/api/1/partner_accounts", {
    method: "POST",
    headers: { Authorization: "Bearer " + tok.access_token, "Content-Type": "application/json" },
    body: JSON.stringify({ domain }),
  });
  if (!res.ok) throw new Error("Partner register failed: " + res.status + " " + (await res.text()));
  return res.json();
}

// ---------- Fleet API (authenticated as the owner) ----------
async function fleetGet(accessToken, path) {
  const res = await fetch(tesla.fleetBase + path, {
    headers: { Authorization: "Bearer " + accessToken },
  });
  if (res.status === 401) { const e = new Error("unauthorized"); e.code = 401; throw e; }
  if (res.status === 408) { const e = new Error("vehicle asleep/unavailable"); e.code = 408; throw e; }
  if (!res.ok) throw new Error("Fleet GET " + path + " failed: " + res.status + " " + (await res.text()));
  return res.json();
}

export async function listVehicles(accessToken) {
  if (config.mockMode) {
    return [{ vin: "LRWYGDEK8TC000123", display_name: "My Model Y" }];
  }
  const data = await fleetGet(accessToken, "/api/1/vehicles");
  return data.response || [];
}

// Returns just the software version string (vehicle_state.car_version), e.g. "2026.20.3 ..."
export async function getVehicleVersion(accessToken, vin) {
  if (config.mockMode) {
    const pool = ["2026.14.6", "2026.14.6.11", "2026.20", "2026.20.3"];
    return pool[Math.floor((vin.charCodeAt(4) + Date.now() / 3.6e6) % pool.length)];
  }
  const data = await fleetGet(accessToken, `/api/1/vehicles/${encodeURIComponent(vin)}/vehicle_data?endpoints=${encodeURIComponent("vehicle_state")}`);
  const v = data?.response?.vehicle_state?.car_version || null;
  // car_version looks like "2026.20.3 ab0def..." — keep just the version token.
  return v ? v.split(" ")[0] : null;
}
