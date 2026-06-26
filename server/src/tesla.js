// Tesla Fleet API client — OAuth 2.0 (Authorization Code + PKCE), token refresh,
// partner registration, and read-only vehicle data (software version).
// Docs: https://developer.tesla.com/docs/fleet-api
import crypto from "node:crypto";
import { config } from "./config.js";
import * as W from "./wendata.js";

const { tesla } = config;

// The id_token is obtained in our own back-channel code exchange — received directly from
// Tesla's token endpoint over TLS, never via the browser — so its authenticity is already
// guaranteed by the TLS channel. We decode the claims (Tesla doesn't expose a reliably
// discoverable JWKS for Fleet API; its /keys path serves HTML). Decode-only is the standard
// trust model for the server-side authorization-code flow.
export async function verifyIdToken(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length < 2) throw new Error("malformed id_token");
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { throw new Error("unparseable id_token payload"); }
  // The token arrives over our server-to-server TLS back-channel from Tesla's token endpoint, so
  // OIDC permits TLS validation in place of signature verification for the auth-code flow. We
  // still assert the standard claims as defence-in-depth — and now REJECT on mismatch (was warn).
  if (payload.aud && tesla.clientId) {
    const audMatch = payload.aud === tesla.clientId || (Array.isArray(payload.aud) && payload.aud.includes(tesla.clientId));
    if (!audMatch) throw new Error("id_token aud does not match client_id");
  }
  if (payload.exp != null && Number(payload.exp) * 1000 < Date.now() - 60_000) throw new Error("id_token is expired");
  if (payload.iss) {
    let issHost = ""; try { issHost = new URL(payload.iss).host; } catch { /* non-URL iss */ }
    if (!/(^|\.)tesla\.com$/i.test(issHost)) throw new Error("id_token issuer is not a tesla.com domain");
  }
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
async function fleetPost(accessToken, path, body) {
  const res = await fetch(tesla.fleetBase + path, {
    method: "POST",
    headers: { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (res.status === 401) { const e = new Error("unauthorized"); e.code = 401; throw e; }
  if (!res.ok) throw new Error("Fleet POST " + path + " failed: " + res.status + " " + (await res.text()));
  return res.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wake a sleeping car ON THE OWNER'S EXPLICIT REQUEST, then poll until it reports online.
// wake_up is a standard Fleet API vehicle endpoint (works with the OAuth token; it does NOT
// require the signed vehicle-command protocol, unlike actuation commands). Bounded so it can't
// hang the request.
export async function wakeVehicle(accessToken, vin, { timeoutMs = 30000, intervalMs = 3000 } = {}) {
  if (config.mockMode) return { state: "online", woke: true };
  const tag = encodeURIComponent(vin);
  let last = null;
  try { last = await fleetPost(accessToken, `/api/1/vehicles/${tag}/wake_up`, {}); } catch (e) { last = { error: e.message }; }
  if (last?.response?.state === "online") return { state: "online", woke: true };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(intervalMs);
    try {
      const data = await fleetGet(accessToken, `/api/1/vehicles/${tag}`);
      const state = data?.response?.state;
      if (state === "online") return { state, woke: true };
      last = data;
    } catch (e) { /* transient — keep polling until the deadline */ }
  }
  return { state: last?.response?.state || "asleep", woke: false };
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
    // Demo connected cars get a REAL, current mainstream build, derived from the canonical model so it
    // can't drift to a removed version (a hardcoded list here had gone stale — e.g. 2026.14.6.11).
    const mainstream = W.versions.filter(v => (v.markets || []).length >= 5).map(v => v.version);
    const pool = mainstream.length ? mainstream : W.versions.map(v => v.version);
    return pool[Math.floor((vin.charCodeAt(4) + Date.now() / 3.6e6) % pool.length)];
  }
  const data = await fleetGet(accessToken, `/api/1/vehicles/${encodeURIComponent(vin)}/vehicle_data?endpoints=${encodeURIComponent("vehicle_state")}`);
  const v = data?.response?.vehicle_state?.car_version || null;
  // car_version looks like "2026.20.3 ab0def..." — keep just the version token.
  return v ? v.split(" ")[0] : null;
}

// Read BOTH the installed version AND any pending over-the-air update in ONE vehicle_data call
// (same cost as getVehicleVersion). The Fleet API's vehicle_state.software_update block exposes
// the live update lifecycle — status / target version / download % / install % — i.e. the actual
// answer to "wen", straight from the car. Online cars only (vehicle_data 408s on a sleeping car;
// the caller already filters to awake vehicles so we never wake one).
export async function getVehicleState(accessToken, vin) {
  if (config.mockMode) return { version: await getVehicleVersion(accessToken, vin), update: null };
  const data = await fleetGet(accessToken, `/api/1/vehicles/${encodeURIComponent(vin)}/vehicle_data?endpoints=${encodeURIComponent("vehicle_state")}`);
  const vs = data?.response?.vehicle_state || {};
  const version = vs.car_version ? String(vs.car_version).split(" ")[0] : null;
  const su = vs.software_update || null;
  const active = su && su.status && su.status !== "" && su.version;
  const update = active ? {
    version: String(su.version).split(" ")[0],
    status: String(su.status),                                   // available | scheduled | downloading | downloading_wifi_wait | installing
    download: su.download_perc != null ? Math.round(+su.download_perc) : null,
    install: su.install_perc != null ? Math.round(+su.install_perc) : null,
    durationSec: su.expected_duration_sec != null ? +su.expected_duration_sec : null,
  } : null;
  return { version, update };
}
