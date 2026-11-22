// Community reports are unauthenticated input: they may queue an event and ping the owner, but must
// never confirm an event or mail subscribers by themselves — and one client must count as one submitter.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import * as W from "../src/wendata.js";
import { submitterHash, flagCorroboratedResume } from "../src/routes/api.js";

// --- submitter identity: req.ip only (as resolved by `trust proxy`), same config as server.js ---
const app = express();
app.set("trust proxy", 1);
app.get("/h", (req, res) => res.json({ h: submitterHash(req) }));
const server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
after(() => server.close());
const hashFor = async (headers) => (await (await fetch(`http://127.0.0.1:${server.address().port}/h`, { headers })).json()).h;

test("client-chosen headers do not make one client look like several submitters", async () => {
  // the right-most X-Forwarded-For entry is the one our proxy appended (the real peer); anything
  // to its left, and the User-Agent, is supplied by the client
  const a = await hashFor({ "x-forwarded-for": "198.51.100.1, 203.0.113.7", "user-agent": "one" });
  const b = await hashFor({ "x-forwarded-for": "198.51.100.2, 203.0.113.7", "user-agent": "two" });
  const c = await hashFor({ "x-forwarded-for": "203.0.113.7" });
  assert.equal(a, b);
  assert.equal(a, c);
});

test("genuinely different peers are still distinct submitters", async () => {
  assert.notEqual(await hashFor({ "x-forwarded-for": "203.0.113.7" }), await hashFor({ "x-forwarded-for": "203.0.113.8" }));
});

// --- corroborated resume: owner is asked to confirm; nothing is confirmed or mailed here ---
const region = "Australia";
const hold = Object.values(W.regions[region].fsd).find((h) => h && typeof h === "object");
const wasPaused = hold.paused;
after(() => { hold.paused = wasPaused; });

function fakes({ n, mine, confirmed = false }) {
  const sql = [], pings = [];
  const q = async (text) => {
    sql.push(text);
    if (/count\(DISTINCT submitted_by\)/.test(text)) return { rows: [{ n, mine }], rowCount: 1 };
    return { rows: confirmed ? [{}] : [], rowCount: confirmed ? 1 : 0 };
  };
  const notify = async (ev) => { pings.push(ev); return {}; };
  return { sql, pings, q, notify };
}

test("two distinct submitters reporting a resume only ask the owner to confirm", async () => {
  hold.paused = true;
  const f = fakes({ n: 2, mine: 1 });
  const r = await flagCorroboratedResume({ region, submitter: "abc" }, f);
  assert.equal(r.flagged, true);
  assert.equal(f.pings.length, 1);
  assert.match(f.pings[0].reason, /confirm the resume in \/admin/);
  assert.ok(f.sql.every((t) => /^\s*SELECT/i.test(t)), "read-only: no event is confirmed from the public path");
});

test("no ping without corroboration, on a repeat from the same submitter, or once already confirmed", async () => {
  hold.paused = true;
  for (const c of [{ n: 1, mine: 1 }, { n: 2, mine: 3 }, { n: 5, mine: 1, confirmed: true }]) {
    const f = fakes(c);
    assert.equal((await flagCorroboratedResume({ region, submitter: "abc" }, f)).flagged, false);
    assert.equal(f.pings.length, 0);
    assert.ok(f.sql.every((t) => /^\s*SELECT/i.test(t)));
  }
});

test("a region with no active hold is ignored entirely", async () => {
  hold.paused = false;
  const others = Object.values(W.regions[region].fsd).filter((h) => h && h !== hold && h.paused);
  if (others.length) return;   // model currently holds this region on another hardware line
  const f = fakes({ n: 9, mine: 1 });
  assert.equal((await flagCorroboratedResume({ region, submitter: "abc" }, f)).flagged, false);
  assert.equal(f.sql.length, 0);
});

test("the report route no longer reaches the subscriber mailer", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/routes/api.js", import.meta.url), "utf8");
  const start = src.indexOf('apiRouter.post("/report"'), end = src.indexOf('apiRouter.get("/fleet/firmware"');
  assert.ok(start > 0 && end > start);
  const handler = src.slice(start, end);
  assert.doesNotMatch(handler, /runResumeAlerts/);
  assert.doesNotMatch(handler, /status\s*=\s*'confirmed'/);
});
