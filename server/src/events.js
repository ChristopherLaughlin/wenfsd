// Rollout EVENTS — the layer that makes the predictor event-aware (pauses, resumes, halts).
// The cadence model fits an S-curve; events are discrete state-changes that invalidate that fit.
// Confirmed events are applied as a pure OVERLAY on a normal prediction (mirrored on the client),
// so the model stays testable and events only modulate it.
import * as W from "./wendata.js";

const DAY = 86400000;
const toMs = (s) => new Date(String(s).length <= 10 ? s + "T00:00:00Z" : s).getTime();

// ---- validation: closed enums + bounded strings, so nothing free-text reaches the model ----
export const EVENT_TYPES = new Set(["pause", "resume", "halt", "accelerate", "note"]);
export const HIGH_IMPACT = new Set(["pause", "halt"]);   // these require human confirmation before public
export function cleanEventType(t) { return EVENT_TYPES.has(t) ? t : null; }
export function cleanRegion(r) { return r && W.regions[r] ? r : null; }   // null = global
export function cleanVersion(v) {
  const s = String(v == null ? "" : v).replace(/[^0-9.x]/gi, "").slice(0, 24);
  return /^[0-9]/.test(s) ? s : null;   // null = applies to whatever the next build is
}
export function cleanReason(s) { return typeof s === "string" ? s.replace(/[<>]/g, "").trim().slice(0, 280) : null; }

// Does a confirmed event apply to this prediction? region null = global; version null = the next
// build (so "AU rollout paused" maps to the newest distributed build a car there is waiting on).
function applies(ev, out, market) {
  if (ev.region && ev.region !== market) return false;
  if (ev.version && out && out.targetLabel && ev.version !== out.targetLabel) return false;
  return true;
}

// The active pause for (target build, region): the latest un-resumed pause/halt. A resume/accelerate
// with a later effective date cancels an earlier pause.
export function activePause(events, out, market, today) {
  const list = (events || []).filter(e => applies(e, out, market));
  const pauses = list.filter(e => HIGH_IMPACT.has(e.type)).sort((a, b) => toMs(b.effective_at) - toMs(a.effective_at));
  if (!pauses.length) return null;
  const latestPause = pauses[0];
  const resumedAfter = list.some(e => (e.type === "resume" || e.type === "accelerate") && toMs(e.effective_at) >= toMs(latestPause.effective_at));
  return resumedAfter ? null : latestPause;
}

// Apply the overlay to a normal prediction. When paused we FREEZE and refuse to invent a date:
// honesty beats a confident-but-wrong ETA. Returns the (possibly transformed) prediction.
export function applyEventOverlay(out, events, car, today) {
  if (!out || out.capped || out.unavailable) return out;
  const market = car && car.market;
  const pause = activePause(events, out, market, today || W.today);
  if (!pause) return out;
  out.paused = true;
  out.pauseType = pause.type;                 // "pause" | "halt"
  out.pausedSince = pause.effective_at || pause.detected_at || null;
  out.pauseReason = pause.reason || null;
  out.pauseSource = pause.source || null;
  out.etaUnknown = true;                       // the resume date is genuinely unknown
  out.kind = "paused";
  out.confidence = "paused";
  return out;
}

// ---- Tier-1 OBSERVED detection: a mid-rollout build whose daily installs collapse to ~0 is a
// de-facto pause — quantitative, already-ingested (TeslaFi daily series), no scraping/rumor. ----
// series item: { version, daily:[oldest→newest] }. Returns candidate {version, stalledDays, ...}.
export function detectStalls(series, opts = {}) {
  const minStallDays = opts.minStallDays || 3;   // consecutive ~zero days to call it
  const priorWindow = opts.priorWindow || 5;     // days before the stall that must show real rollout
  const priorMin = opts.priorMin || 20;          // installs/day that counts as "was actively rolling"
  const floor = opts.floor || 2;                 // ≤ this/day counts as "stalled"
  const out = [];
  for (const s of series || []) {
    const d = Array.isArray(s.daily) ? s.daily : null;
    if (!d || d.length < minStallDays + 2) continue;
    const tail = d.slice(-minStallDays);
    const stalled = tail.every(x => (+x || 0) <= floor);
    if (!stalled) continue;
    const prior = d.slice(Math.max(0, d.length - minStallDays - priorWindow), d.length - minStallDays);
    const wasRolling = prior.length && (prior.reduce((a, b) => a + (+b || 0), 0) / prior.length) >= priorMin;
    if (!wasRolling) continue;   // never really rolling here → not a "pause", just not shipped
    out.push({ version: s.version, stalledDays: minStallDays, priorAvg: Math.round(prior.reduce((a, b) => a + (+b || 0), 0) / prior.length) });
  }
  return out;
}
