// OAuth routes: owner links their Tesla account → we store (encrypted) tokens + vehicles.
import { Router } from "express";
import { config } from "../config.js";
import * as tesla from "../tesla.js";
import { query, hasDb } from "../db.js";
import { encrypt } from "../crypto.js";
import { decodeVIN } from "../vin.js";

export const authRouter = Router();

authRouter.get("/login", (req, res) => {
  if (config.mockMode) { req.session.userId = 1; req.session.mock = true; return res.redirect("/?linked=mock"); }
  const { verifier, challenge } = tesla.makePkce();
  req.session.pkce = verifier;
  req.session.oauthState = tesla.randomState();
  res.redirect(tesla.buildAuthUrl({ state: req.session.oauthState, codeChallenge: challenge }));
});

authRouter.get("/callback", async (req, res, next) => {
  let step = "start";
  try {
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) return res.status(400).send("Invalid OAuth state.");
    req.session.oauthState = null; // single-use

    step = "exchange-code";
    const tokens = await tesla.exchangeCode(code, req.session.pkce);
    req.session.pkce = null;

    step = "verify-id-token";
    const claims = await tesla.verifyIdToken(tokens.id_token);
    const sub = claims.sub;
    if (!sub) return res.status(400).send("Could not verify identity.");
    const expiresAt = new Date(Date.now() + (tokens.expires_in || 28800) * 1000);

    let userId = 1;
    if (hasDb()) {
      step = "save-user";
      const u = await query(
        `INSERT INTO users(tesla_sub, email) VALUES($1,$2)
         ON CONFLICT(tesla_sub) DO UPDATE SET email=EXCLUDED.email RETURNING id`, [sub, claims.email || null]);
      userId = u.rows[0].id;
      step = "save-tokens";
      await query(
        `INSERT INTO oauth_tokens(user_id, access_token, refresh_token, expires_at)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(user_id) DO UPDATE SET access_token=$2, refresh_token=$3, expires_at=$4, updated_at=now()`,
        [userId, encrypt(tokens.access_token), encrypt(tokens.refresh_token), expiresAt]);

      step = "list-vehicles";
      const vehicles = await tesla.listVehicles(tokens.access_token);
      step = "save-vehicles";
      for (const v of vehicles) {
        const d = decodeVIN(v.vin);
        await query(
          `INSERT INTO vehicles(user_id, vin, model, model_year, generation, hardware, market, drive)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT(vin) DO UPDATE SET user_id=$1,
             model=COALESCE(vehicles.model,$3), model_year=COALESCE(vehicles.model_year,$4),
             hardware=COALESCE(vehicles.hardware,$6), market=COALESCE(vehicles.market,$7)`,
          [userId, v.vin, d.model, d.model_year, d.generation || null, d.hardware, d.market, d.drive]);
      }
    }
    req.session.userId = userId;
    res.redirect("/?linked=1");
  } catch (e) {
    // surface the failing step to the owner so setup issues are diagnosable
    console.error(`OAuth callback failed at [${step}]:`, (e && e.stack) || e);
    res.status(500).send(`Connect failed at step "${step}": ${(e && e.message) || e}`);
  }
});

authRouter.post("/logout", (req, res) => { req.session = null; res.json({ ok: true }); });
