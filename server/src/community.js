// Community-signal classifier — turns a free-text report/post ("they paused 2025.20 in AU") into a
// structured candidate event. Rule-based + deterministic (no LLM dependency); an optional Claude
// Haiku pass can be layered later behind a flag for fuzzy phrasing. Pure + unit-testable.
import * as W from "./wendata.js";

const TYPE_CUES = [
  { type: "resume", re: /\b(resum(e|ed|ing)|back on|restart(ed|ing)?|rolling again|continu(e|ed|ing))\b/i },
  { type: "halt", re: /\b(halt(ed)?|pulled|recall(ed)?|yank(ed)?|stop(ped)?\s+(the\s+)?roll)/i },
  { type: "pause", re: /\b(pause(d)?|on hold|holding|frozen|froze|suspend(ed)?|delay(ed)?\b)/i },
];
const VER_RE = /\b(20\d{2}\.\d{1,2}(?:\.\d{1,2}){0,2})\b/;     // e.g. 2026.20.3
const FSD_RE = /\bv?(1[0-9](?:\.\d+){0,3})\b/i;                 // FSD vNN.x (kept for note context)

// region detection: match a known market name or a common alias
const REGION_ALIASES = {
  "Australia": [/\baustralia\b/i, /\baussie\b/i, /\bau\b/i, /\bnsw\b/i, /\bvic\b/i, /\bqld\b/i],
  "New Zealand": [/\bnew zealand\b/i, /\bnz\b/i, /\bkiwi\b/i],
  "United States": [/\b(usa?|united states|america|california|texas)\b/i],
  "Canada": [/\bcanad(a|ian)\b/i],
  "Europe": [/\b(europe|eu|uk|britain|germany|france|norway|netherlands)\b/i],
};
function detectRegion(text) {
  for (const region of Object.keys(REGION_ALIASES)) {
    if (!W.regions[region]) continue;
    if (REGION_ALIASES[region].some(re => re.test(text))) return region;
  }
  return null;
}

// Returns a candidate event {type, version, region, confidence, matched} or null if nothing usable.
export function classifyPost(text) {
  const t = String(text || "").slice(0, 2000);
  if (!t.trim()) return null;
  let type = null;
  for (const cue of TYPE_CUES) { if (cue.re.test(t)) { type = cue.type; break; } }   // resume/halt before pause
  if (!type) return null;
  const verM = t.match(VER_RE);
  const region = detectRegion(t);
  // confidence: a state word alone is weak; + an explicit version and/or region is stronger.
  let confidence = 0.35;
  if (verM) confidence += 0.3;
  if (region) confidence += 0.25;
  // an "update/rollout/firmware/FSD" context word guards against false positives ("paused my podcast")
  const onTopic = /\b(updat|rollout|roll out|firmware|software|ota|build|fsd|version|release)\b/i.test(t);
  if (!onTopic) return null;
  confidence = Math.min(0.95, confidence + 0.05);
  return { type, version: verM ? verM[1] : null, region, confidence: +confidence.toFixed(2), matched: true };
}

// Corroboration: group candidate events by (type, version, region) and score by independent-source
// count. Used to decide what's worth surfacing / auto-raising — final gate is still human.
export function scoreCorroboration(candidates) {
  const groups = new Map();
  for (const c of candidates || []) {
    if (!c || !c.type) continue;
    const key = [c.type, c.version || "*", c.region || "*"].join("|");
    const g = groups.get(key) || { type: c.type, version: c.version || null, region: c.region || null, sources: new Set(), count: 0, confidence: 0 };
    g.count += 1;
    if (c.source) g.sources.add(c.source);
    g.confidence = Math.max(g.confidence, c.confidence || 0);
    groups.set(key, g);
  }
  return [...groups.values()].map(g => ({
    type: g.type, version: g.version, region: g.region, count: g.count,
    distinctSources: g.sources.size || 1,
    // corroboration lifts confidence; capped so it never reaches "certain" without human review
    confidence: Math.min(0.97, g.confidence + 0.12 * Math.max(0, (g.sources.size || 1) - 1)),
  })).sort((a, b) => b.confidence - a.confidence);
}
