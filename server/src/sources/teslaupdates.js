// Source adapter: Tesla Updates (https://teslaupdates.org/rollouts)
// LIVE: parses the PUBLIC /rollouts page (no robots.txt present → crawling permitted by default).
// The page is a per-version DAILY INSTALL-COUNT table (Today / Yesterday / dates...). Those are
// install *events* (flow), NOT a fleet-distribution snapshot — semantically different from
// Teslascope's stock %. So we DON'T blend these into fleetPct; we expose them as `recentInstalls`
// (real install activity this week) + an "actively rolling" status, which corroborates which
// versions are live right now. Descriptive UA, 15s timeout, graceful fallback to sample.
const PAGE = "https://teslaupdates.org/rollouts";
const UA = "wenFSD/1.0 (+https://wenfsd.info; Tesla firmware aggregator; respects robots.txt)";

const SAMPLE = [
  { version: "2026.20.3", branch: "standard", recentInstalls: 1467, status: "rolling" },
  { version: "2026.20", branch: "standard", recentInstalls: 363, status: "rolling" },
  { version: "2026.14.6.11", branch: "standard", recentInstalls: 210, status: "rolling" },
];

export const teslaupdates = {
  name: "Tesla Updates",
  homepage: "https://teslaupdates.org/rollouts",
  fleet: 22000,
  hardwareAware: false,
  regionAware: true,
  async fetch({ live = false } = {}) {
    if (live) {
      const rows = await fetchLive();
      if (rows.length) return rows;
    }
    return SAMPLE;
  },
};

async function fetchLive() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let html;
  try {
    const res = await fetch(PAGE, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: ctrl.signal });
    if (!res.ok) throw new Error("teslaupdates HTTP " + res.status);
    html = await res.text();
  } finally { clearTimeout(timer); }

  const rows = [];
  let m; const trRe = /<tr>([\s\S]*?)<\/tr>/g;
  while ((m = trRe.exec(html))) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(c => c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!cells.length) continue;
    const ver = (cells[0].match(/20\d{2}\.[0-9.]+/) || [])[0];
    if (!ver || !/^20\d{2}\.\d/.test(ver)) continue;
    const nums = cells.slice(1).map(x => parseInt(x.replace(/[^0-9]/g, ""), 10)).filter(Number.isFinite);
    const recent = nums.reduce((a, b) => a + b, 0);
    if (recent <= 0) continue;                              // skip dormant versions
    const active = (nums[0] || 0) + (nums[1] || 0) > 0;     // installs today/yesterday
    rows.push({ version: ver, branch: "standard", recentInstalls: recent, status: active ? "rolling" : undefined });
  }
  return rows;
}
