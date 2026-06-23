// Source adapter: Tessie public software tracker (https://stats.tessie.com/)
// LARGEST fleet of the public trackers (~630k vehicles) → gets the most merge weight, so
// its distribution %s dominate the consensus. LIVE: parses the public, server-rendered stats
// table (version · first-seen · age · % of fleet · status). No robots.txt Disallow present →
// crawling permitted by default. Descriptive UA, 15s timeout, graceful fallback to sample.
const PAGE = "https://stats.tessie.com/";
const UA = "wenFSD/1.0 (+https://wenfsd.info; Tesla firmware aggregator; respects robots.txt)";

const SAMPLE = [
  { version: "2026.20", fleetPct: 34.2, firstSeen: "2026-06-10", branch: "standard", status: "tapering" },
  { version: "2026.14.6", fleetPct: 27.2, firstSeen: "2026-05-22", branch: "standard", status: "tapering" },
  { version: "2026.14.6.11", fleetPct: 15.0, firstSeen: "2026-06-05", branch: "standard", status: "rolling" },
  { version: "2026.20.3", fleetPct: 7.9, firstSeen: "2026-06-17", branch: "standard", status: "rolling" },
];

export const tessie = {
  name: "Tessie",
  homepage: "https://stats.tessie.com/",
  fleet: 629503,
  hardwareAware: false,
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
// Tessie shows "June 18" (no year). Infer the year: if month/day lands >10 days in the
// future vs now, it must be last year.
function parseSeen(s, now) {
  const m = /([A-Za-z]+)\s+(\d{1,2})/.exec(s || "");
  if (!m) return null;
  const mo = MONTHS[m[1].toLowerCase()];
  if (!mo) return null;
  const day = String(m[2]).padStart(2, "0");
  let year = now.getUTCFullYear();
  const cand = Date.parse(`${year}-${mo}-${day}T00:00:00Z`);
  if (cand - now.getTime() > 10 * 86400000) year -= 1;
  return `${year}-${mo}-${day}`;
}

async function fetchLive() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let html;
  try {
    const res = await fetch(PAGE, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: ctrl.signal });
    if (!res.ok) throw new Error("tessie HTTP " + res.status);
    html = (await res.text()).slice(0, 2_000_000);   // cap upstream HTML (defence-in-depth: bounds all regex parsing)
  } finally { clearTimeout(timer); }

  const now = new Date();
  const rows = [];
  let m; const trRe = /<tr>([\s\S]*?)<\/tr>/g;
  while ((m = trRe.exec(html))) {
    const r = m[1];
    if (!/fw-semibold/.test(r)) continue;                  // version rows only
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(c => c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const ver = ((cells[0] && cells[0].match(/20\d{2}\.[0-9.]+/)) || [])[0];
    if (!ver || !/^20\d{2}\.\d/.test(ver)) continue;
    const pctCell = cells.find(c => /^\d+(\.\d+)?%$/.test(c));
    const pct = pctCell ? parseFloat(pctCell) : null;
    const seen = cells[1] ? parseSeen(cells[1], now) : null;
    const last = cells[cells.length - 1] || "";
    const status = /rolling/i.test(last) ? "rolling" : (/taper/i.test(last) ? "tapering" : undefined);
    rows.push({ version: ver, branch: "standard", fleetPct: pct, firstSeen: seen, status });
  }
  return rows.filter(r => r.fleetPct != null || r.firstSeen);
}
