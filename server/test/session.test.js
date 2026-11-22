// A session issued in mock/sample mode must never authenticate in real mode — even though both
// modes sign cookies with the same SESSION_SECRET. Builds the same session stack server.js uses.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieSession from "cookie-session";
import { config } from "../src/config.js";
import { sessionCookieName, rejectMockSession } from "../src/session.js";
import { authRouter } from "../src/routes/auth.js";

const originalMock = config.mockMode;
const servers = [];
after(() => { config.mockMode = originalMock; for (const s of servers) s.close(); });

// `name` is fixed at construction (as in server.js); the guard reads config.mockMode per request.
async function makeApp(name) {
  const app = express();
  app.use(cookieSession({ name, secret: config.sessionSecret, httpOnly: true, sameSite: "lax" }));
  app.use(rejectMockSession);
  app.use("/auth", authRouter);
  app.get("/seed/:kind", (req, res) => {   // test-only: mint specific session shapes
    req.session = req.params.kind === "legacy" ? { userId: 1, mock: true } : req.params.kind === "real" ? { userId: 7 } : { userId: "7" };
    res.json({ ok: true });
  });
  app.get("/whoami", (req, res) => res.json({ userId: (req.session && req.session.userId) ?? null, mock: !!(req.session && req.session.mock) }));
  const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
const cookiesFrom = (res) => res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
const whoami = async (base, cookie) => (await fetch(base + "/whoami", { headers: { cookie } })).json();

test("mock and real mode use different session cookie names", () => {
  assert.notEqual(sessionCookieName(true), sessionCookieName(false));
  assert.equal(sessionCookieName(false), "wenfsd", "real-mode name unchanged, so live sessions survive the deploy");
});

test("mock-mode login works for local dev but never carries a numeric user id", async () => {
  config.mockMode = true;
  const base = await makeApp(sessionCookieName(true));
  const login = await fetch(base + "/auth/login", { redirect: "manual" });
  assert.equal(login.status, 302);
  assert.match(login.headers.get("location"), /linked=mock/);
  const me = await whoami(base, cookiesFrom(login));
  assert.equal(me.mock, true);
  assert.ok(me.userId, "still 'linked' in mock mode, so the demo garage loads");
  assert.notEqual(typeof me.userId, "number");
});

test("a mock-minted session is rejected in real mode, even under the real cookie name", async () => {
  const base = await makeApp("wenfsd");
  for (const kind of ["legacy", "string"]) {   // legacy = the old { userId: 1, mock: true } shape
    config.mockMode = true;
    const cookie = cookiesFrom(await fetch(base + "/seed/" + kind));
    assert.ok((await whoami(base, cookie)).userId, "sanity: the session is readable in mock mode");
    config.mockMode = false;
    const res = await fetch(base + "/whoami", { headers: { cookie } });
    assert.deepEqual(await res.json(), { userId: null, mock: false }, `${kind} session must not authenticate in real mode`);
    assert.ok(res.headers.getSetCookie().some((c) => /^wenfsd=;/.test(c)), "and the cookie is cleared");
  }
});

test("a genuine (OAuth-shaped) session still works in real mode", async () => {
  const base = await makeApp("wenfsd");
  config.mockMode = false;
  const cookie = cookiesFrom(await fetch(base + "/seed/real"));
  assert.deepEqual(await whoami(base, cookie), { userId: 7, mock: false });
});
