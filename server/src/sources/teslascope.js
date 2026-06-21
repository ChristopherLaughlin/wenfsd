// Source adapter: Teslascope (https://teslascope.com/software)
// LIVE: parses the PUBLIC /software page, which robots.txt explicitly allows
// (only /vehicle, /login, /join, /teslapedia/location* are disallowed — /software is open).
// We send a descriptive User-Agent, fetch at most once per refresh cycle (cron every 6h +
// 10-min API cache upstream), and attribute Teslascope as the source in the UI.
// Any parse/transport failure falls back to the sample rows so the app never breaks.
const PAGE = "https://teslascope.com/software";
const UA = "wenFSD/1.0 (+https://wenfsd.info; Tesla firmware aggregator; respects robots.txt)";

const SAMPLE = [
  { version: "2026.20.3", fleetPct: 8.2, firstSeen: "2026-06-17", branch: "standard", fsd: { AI4: "v14.3.4" } },
  { version: "2026.14.6.11", fleetPct: 24.0, firstSeen: "2026-06-05", branch: "standard", fsd: { AI4: "v14.3.4" } },
  { version: "2026.14.6", fleetPct: 30.0, firstSeen: "2026-05-22", branch: "standard", fsd: { AI4: "v13.2.9" } },
  { version: "2026.20", fleetPct: 7.0, firstSeen: "2026-06-10", branch: "standard", fsd: { AI4: "v14.3.2" } },
];

export const teslascope = {
  name: "Teslascope",
  homepage: "https://teslascope.com/software",
  fleet: 120000,
  hardwareAware: true,
  regionAware: false,
  async fetch({ live = false } = {}) {
    if (live) {
      const rows = await fetchLive();
      if (rows.length) return rows;
    }
    return SAMPLE;
  },
};

const MONTHS = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
function toIso(s) {
  const m = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(s || "");
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  return mo ? `${m[3]}-${mo}-${String(m[2]).padStart(2, "0")}` : null;
}
const isVer = (v) => /^20\d{2}\.\d/.test(v);

async function fetchLive() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let html;
  try {
    const res = await fetch(PAGE, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: ctrl.signal });
    if (!res.ok) throw new Error("teslascope HTTP " + res.status);
    html = await res.text();
  } finally { clearTimeout(timer); }

  const byVer = new Map();
  const get = (v) => { let m = byVer.get(v); if (!m) { m = { version: v, branch: "standard", fsd: {} }; byVer.set(v, m); } return m; };

  // 1) FSD breakdown table: <td fw-bold><span>AI4 v14.3.4</span></td><td><a .../software/VER>VER</a></td><td text-end>PCT%</td>
  const rowRe = /<td class="fw-bold">\s*<span[^>]*>([^<]+)<\/span>\s*<\/td>\s*<td>\s*<a[^>]*\/software\/([0-9][0-9.]+)"[^>]*>\s*([0-9][0-9.]+)\s*<\/a>\s*<\/td>\s*<td class="text-end">\s*([0-9.]+)%/g;
  let m;
  while ((m = rowRe.exec(html))) {
    const hwBuild = m[1].trim(), version = m[3].trim(), pct = parseFloat(m[4]);
    if (!isVer(version)) continue;
    const row = get(version);
    if (Number.isFinite(pct) && row.fleetPct == null) row.fleetPct = pct;
    let pm; const pairRe = /(AI4|AI3|HW4|HW3|AI2\.5)\s+(v[0-9][0-9.]+)/g;
    while ((pm = pairRe.exec(hwBuild))) {
      const hw = pm[1].replace("HW4", "AI4").replace("HW3", "AI3");
      row.fsd[hw] = pm[2];
    }
  }

  // 2) "Software Updates" cards: <div col mb-4 update> ... <b>VER</b> ... First noticed:</b> Month D, YYYY
  const cardRe = /class="col mb-4 update">[\s\S]*?<b>([^<]+)<\/b>[\s\S]*?First noticed:<\/b>\s*([A-Za-z]+\s+\d{1,2},\s*\d{4})/g;
  while ((m = cardRe.exec(html))) {
    const version = m[1].trim().replace(/^terminal\//, "");
    if (!isVer(version)) continue;
    const iso = toIso(m[2]);
    const row = get(version);
    if (iso && (!row.firstSeen || iso < row.firstSeen)) row.firstSeen = iso;
  }

  return [...byVer.values()].filter(r => r.fleetPct != null || r.firstSeen);
}

// ---- per-version REAL release notes ----
// Teslascope publishes the actual Tesla release notes per version at /software/<version>
// as "Features" cards (current update's features are visible; prior-update ones carry
// style="display:none"). We parse the visible title + description for each.
const clean = (s) => s.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ").trim();
function guessTag(t) {
  const s = t.toLowerCase();
  if (/fsd|full self|autopilot|autosteer|smart summon|actually smart/.test(s)) return "FSD";
  if (/safety|blind spot|collision|emergency|airbag/.test(s)) return "Safety";
  if (/dashcam|sentry|camera|recording/.test(s)) return "Dashcam";
  if (/charg|supercharg|trip planner|route|navigat/.test(s)) return "Nav";
  if (/fix|bug|stability|reliab|resolved/.test(s)) return "Fix";
  if (/ui|display|theme|layout|interface|visual|light|sound|music|app|keyboard|grok|paint/.test(s)) return "UI";
  return "UI";
}

export async function fetchNotes(version) {
  if (!isVer(version)) return [];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let html;
  try {
    const res = await fetch(`https://teslascope.com/software/${encodeURIComponent(version)}`, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: ctrl.signal });
    if (!res.ok) throw new Error("teslascope notes HTTP " + res.status);
    html = await res.text();
  } finally { clearTimeout(timer); }

  const items = [];
  const cardRe = /id="release-note-feature-\d+"([\s\S]*?)(?=id="release-note-feature-\d+"|<\/section>|<footer)/g;
  let m;
  while ((m = cardRe.exec(html))) {
    const card = m[1];
    if (/display:\s*none/i.test(card.slice(0, 240))) continue;   // prior-update feature → skip
    const tm = card.match(/<h[3456][^>]*>([\s\S]*?)<\/h[3456]>/);
    const pm = card.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const title = tm ? clean(tm[1]) : "";
    const body = pm ? clean(pm[1]) : "";
    if (!title || title.length > 80) continue;
    items.push({ tag: guessTag(title + " " + body), text: body ? `${title} — ${body}` : title });
    if (items.length >= 30) break;
  }
  return items;
}
