// OAuth routes: owner links their Tesla account → we store tokens + their vehicles.
import { Router } from "express";
import { config } from "../config.js";
import * as tesla from "../tesla.js";
import { query, hasDb } from "../db.js";

export const authRouter = Router();

// Kick off the Tesla OAuth flow
authRouter.get("/login", (req, res) => {
  if (config.mockMode) {
    // No real Tesla in mock mode — simulate a linked session.
    req.session.userId = 1;
    req.session.mock = true;
    return res.redirect("/?linked=mock");
  }
  const { verifier, challenge } = tesla.makePkce();
  const state = tesla.randomState();
  req.session.pkce = verifier;
  req.session.oauthState = state;
  res.redirect(tesla.buildAuthUrl({ state, codeChallenge: challenge }));
});

// Tesla redirects back here with ?code & ?state
authRouter.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || state !== req.session.oauthState) return res.status(400).send("Invalid OAuth state.");
    const tokens = await tesla.exchangeCode(code, req.session.pkce);

    // identify the owner from the id_token 'sub'
    const sub = decodeJwtSub(tokens.id_token) || "unknown";
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 28800) * 1000);

    let userId = null;
    if (hasDb()) {
      const u = await query(
        `INSERT INTO users(tesla_sub) VALUES($1)
         ON CONFLICT(tesla_sub) DO UPDATE SET tesla_sub=EXCLUDED.tesla_sub RETURNING id`, [sub]);
      userId = u.rows[0].id;
      await query(
        `INSERT INTO oauth_tokens(user_id, access_token, refresh_token, expires_at)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(user_id) DO UPDATE SET access_token=$2, refresh_token=$3, expires_at=$4, updated_at=now()`,
        [userId, tokens.access_token, tokens.refresh_token, expiresAt]);

      // pull the owner's vehicles and upsert
      const vehicles = await tesla.listVehicles(tokens.access_token);
      for (const v of vehicles) {
        await query(
          `INSERT INTO vehicles(user_id, vin, current_version)
           VALUES($1,$2,$3) ON CONFLICT(vin) DO UPDATE SET user_id=$1`,
          [userId, v.vin, null]);
      }
    }
    req.session.userId = userId || 1;
    res.redirect("/?linked=1");
  } catch (e) {
    console.error("OAuth callback error:", e);
    res.status(500).send("OAuth failed: " + e.message);
  }
});

authRouter.post("/logout", (req, res) => { req.session = null; res.json({ ok: true }); });

function decodeJwtSub(jwt) {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    return payload.sub;
  } catch { return null; }
}
