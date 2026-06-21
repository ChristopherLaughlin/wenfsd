// Source adapter: TeslaFi firmware tracker (https://teslafi.com/firmware.php)
// LIVE: parses the PUBLIC firmware.php page (no robots.txt present — it 302s to the homepage —
// and no X-Robots-Tag; the page serves without login). Two things come from it:
//   1) the set of actively-installing versions + observed install activity (as a source), and
//   2) the per-version DAILY INSTALL SERIES (fetchDailySeries) used by the honest calibration
//      panel — to measure how fast a rollout concentrates once it reaches cars.
// Descriptive UA, 15s timeout, graceful fallback to sample.
const PAGE = "https://teslafi.com/firmware.php";
const UA = "wenFSD/1.0 (+https://wenfsd.info; Tesla firmware aggregator; respects robots.txt)";

const SAMPLE = [
  { version: "2026.20.3", branch: "standard", recentInstalls: 1470 },
  { version: "2026.20", branch: "standard", recentInstalls: 366 },
  { version: "2026.14.6.11", branch: "standard", recentInstalls: 1889 },
];

export const teslafi = {
  name: "TeslaFi",
  homepage: "https://teslafi.com/firmware.php",
  fleet: 13000,
  hardwareAware: true,
  regionAware: true,
  async fetch({ live = false } = {}) {
    if (live) {
      const { rows } = await fetchAndParse();
      if (rows.length) return rows.map(r => ({ version: r.version, branch: "standard", recentInstalls: r.recentInstalls }));
    }
    return SAMPLE;
  },
};

// Daily install series per actively-rolling version — powers the calibration panel.
// Returns { dates:[oldest→newest], series:[{version, daily:[oldest→newest], total}] }.
export async function fetchDailySeries() {
  const { dates, rows } = await fetchAndParse();
  return { dates, series: rows.map(r => ({ version: r.version, daily: r.daily, total: r.recentInstalls })) };
}

async function fetchAndParse() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let html;
  try {
    const res = await fetch(PAGE, { headers: { "User-Agent": UA, Accept: "text/html" }, signal: ctrl.signal });
    if (!res.ok) throw new Error("teslafi HTTP " + res.status);
    html = await res.text();
  } finally { clearTimeout(timer); }

  // the daily table is the one whose header cells say "Install count for MM/DD"
  const table = (html.match(/<table[^>]*>(?:(?!<\/table>)[\s\S])*?Install count for[\s\S]*?<\/table>/) || [])[0];
  if (!table) return { dates: [], rows: [] };
  const dates = [...table.matchAll(/Install count for (\d{2}\/\d{2})/g)].map(m => m[1]); // newest-first
  const rows = [];
  let m; const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  while ((m = trRe.exec(table))) {
    const r = m[1];
    const vm = r.match(/name="detail" value="([^"]+)"/);
    if (!vm || !/^20\d{2}\.\d/.test(vm[1])) continue;
    const version = vm[1];
    const tds = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(c => c[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").replace(/,/g, "").trim());
    const nums = tds.filter(c => /^\d+$/.test(c)).map(Number);
    if (nums.length < 2) continue;
    // nums[0] = pending; nums[1..] = daily counts, newest-first per `dates`
    const dailyNewestFirst = nums.slice(1, 1 + dates.length);
    const daily = dailyNewestFirst.slice().reverse();   // oldest→newest
    const recentInstalls = daily.reduce((a, b) => a + b, 0);
    if (recentInstalls <= 0) continue;
    rows.push({ version, daily, recentInstalls });
  }
  return { dates: dates.slice().reverse(), rows };   // dates oldest→newest to match daily
}
