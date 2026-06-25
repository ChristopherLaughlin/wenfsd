/* wenFSD — public, shareable, crawlable per-prediction pages + dynamic OG images.
 *
 * A page describes the prediction for a *configuration* (year · model · generation · region) —
 * NOT a person. No user data, no PII, fully deterministic, so the URL encodes everything and the
 * response caches forever. This is the keystone of two growth loops at once:
 *   • viral: a shared link unfurls into the actual prediction card (the OG image IS the ad)
 *   • SEO:   each page answers a real long-tail query ("when will my 2026 Model Y get FSD in AU?")
 */
import { Resvg } from "@resvg/resvg-js";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { predictNextOS, predictNextFSD } from "./predict.js";
import * as W from "./wendata.js";
import { config } from "./config.js";

// Bundle the card font with the app. resvg has NO fonts of its own, and the Railway base image
// ships none either — so `loadSystemFonts` finds nothing and every <text> renders blank (every
// share card in the wild was an empty box). We ship Inter (OFL) in the repo and load it explicitly
// with loadSystemFonts:false, so cards render identically on every host (Mac, CI, Railway).
const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");
const FONT_FILES = ["400", "500", "700", "800"].map((w) => path.join(FONT_DIR, `Inter-${w}.ttf`));
// resvg font config reused by every raster (OG cards + PWA icon).
const FONT = { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "Inter" };

const SITE = config.publicBaseUrl.replace(/\/$/, "");

// ---- config space ----
const YEARS = []; for (let y = 2027; y >= 2017; y--) YEARS.push(y);
const MODELS = [["Model Y", "model-y"], ["Model Y L", "model-y-l"], ["Model 3", "model-3"], ["Model S", "model-s"], ["Model X", "model-x"], ["Cybertruck", "cybertruck"]];
const MODEL_BY_SLUG = new Map(MODELS.map(([name, slug]) => [slug, name]));
const SLUG_BY_MODEL = new Map(MODELS.map(([name, slug]) => [name, slug]));
const REGION_SLUG = { "United States": "united-states", "Canada": "canada", "Europe": "europe", "Australia": "australia", "New Zealand": "new-zealand" };

// Which configs actually EXIST — so we never publish a crawlable prediction page for a car that was
// never made or isn't sold in a region (e.g. "2017 Model Y L in the United States"). The honesty
// brand applies to the index too: a confident date for a non-existent car is a lie. One table, the
// single source of truth — decodeSlug, the sitemap and the index page all derive from it.
// `regions: null` means every modelled region. (China is a real Model Y L / fleet market but the
// data model has no China version data yet — adding it half-baked would yield empty predictions, so
// it's an owner/data follow-up, not a slug we fake here.)
const MODEL_AVAIL = {
  "Model Y":    { since: 2020, regions: null },               // launched 2020
  "Model Y L":  { since: 2025, regions: ["Australia", "New Zealand"] }, // 2025+, RHD AU/NZ (+China pending data)
  "Model 3":    { since: 2017, regions: null },
  "Model S":    { since: 2017, regions: null },
  "Model X":    { since: 2017, regions: null },
  "Cybertruck": { since: 2024, regions: ["United States", "Canada"] },  // 2024+, North America only
};
function configExists(model, year, region) {
  const a = MODEL_AVAIL[model];
  if (!a) return false;
  if (year < a.since) return false;
  return a.regions ? a.regions.includes(region) : true;
}

function generationOf(model, year) {
  if (model === "Model Y" && year >= 2025) return "Juniper";
  if (model === "Model 3" && year >= 2024) return "Highland";
  return "";
}
function inferHardware(model, year) {
  if (model === "Model 3" || model === "Model Y") return year >= 2024 ? "AI4" : year >= 2019 ? "AI3" : "AI2.5";
  if (model === "Model S" || model === "Model X") return year >= 2023 ? "AI4" : year >= 2019 ? "AI3" : "AI2.5";
  return "AI4"; // Cybertruck / unknown
}

// ---- slug index: canonical encode + O(1) decode/validation ----
function canonicalSlug(year, model, region) {
  const gen = generationOf(model, year);
  const genSlug = gen ? "-" + gen.toLowerCase() : "";
  return `${year}-${SLUG_BY_MODEL.get(model)}${genSlug}-${REGION_SLUG[region]}`;
}
const SLUG_INDEX = (() => {
  const m = new Map();
  for (const year of YEARS) for (const [model] of MODELS) for (const region of Object.keys(REGION_SLUG)) {
    if (!configExists(model, year, region)) continue;   // only index cars that actually exist there
    m.set(canonicalSlug(year, model, region), { year, model, region, generation: generationOf(model, year) });
  }
  return m;
})();
export function decodeSlug(slug) { return SLUG_INDEX.get(String(slug || "").toLowerCase()) || null; }
export function allSlugs() { return [...SLUG_INDEX.keys()]; }

// ---- dates ----
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(d) { d = new Date(d); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }

// a representative current build for "a typical car in this region": newest in-region build that's
// settled (tapering/mature) so there's a real next build to predict; falls back sensibly.
function representativeVersion(market) {
  const inReg = W.versions.filter(v => W.inRegion(v, market)).sort((a, b) => W.verKey(b.version) - W.verKey(a.version));
  const settled = inReg.find(v => v.status === "tapering" || v.status === "mature");
  return (settled && settled.version) || (inReg[1] && inReg[1].version) || (inReg[0] && inReg[0].version) || "2026.0";
}

export function predictForSlug(meta, version, events) {
  const car = {
    market: meta.region,
    hardware: inferHardware(meta.model, meta.year),
    installedVersion: version || representativeVersion(meta.region),
    generation: meta.generation,
    earlinessSource: "default",
    fsdEntitlement: "unknown",
  };
  // "today" is the REAL current date, not W.today (the data-snapshot date baked into the model).
  // W.today was being used as the prediction clock, so as real time advanced past it every card
  // showed a "next update — PREDICTED" date that had already passed (a US card read "21 Jun" on the
  // 25th). The model anchors stay frozen (that's the snapshot); only the observer clock is live.
  const opts = { events: events || [], today: new Date().toISOString().slice(0, 10) };
  return { car, os: predictNextOS(car, opts), fsd: predictNextFSD(car, opts) };
}

// ---- escaping ----
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function carLabel(meta) { return `${meta.year} ${meta.model}${meta.generation ? " " + meta.generation : ""}`; }

// ---- the FSD one-liner (honest about the asymmetry: capped / gated / promised / rides-in-build) ----
// Returns PLAIN text (no HTML). Callers escape per-context: esc() for HTML/attributes,
// JSON.stringify for the JSON-LD block. This keeps escaping at the output boundary (correct) and
// avoids regex tag-stripping (which is bypassable, and which static analysis rightly flags).
function fsdText(fsd, region) {
  if (!fsd || fsd.unavailable) return "";
  if (fsd.paused) return `⏸ FSD ${fsd.targetLabel || "v14"} is on hold in ${region || "this market"} — Tesla paused the rollout, with no committed resume date.`;
  if (fsd.capped) return `FSD is capped on this hardware — ${fsd.current || "your version"} is the end of the line.`;
  if (fsd.promised) return `FSD ${fsd.targetLabel || ""} is promised for this hardware, but Tesla has given no committed date.`;
  if (fsd.notEntitled) return `The hardware can run FSD ${fsd.targetLabel || ""}, but it only activates with a purchase or subscription.`;
  if (fsd.medianDate) return `Next FSD version (${fsd.targetLabel || ""}) projected around ${fmtDate(fsd.medianDate)}.`;
  return "";
}

// ---- HTML page (server-rendered, crawlable; CSP-safe — inline styles only, no inline script) ----
export function renderPage(meta, version, events) {
  const { os, fsd } = predictForSlug(meta, version, events);
  const car = carLabel(meta);
  const region = meta.region;
  const date = fmtDate(os.medianDate);
  const windowLine = os.confirmed ? "already downloading" : os.stale ? "low-confidence estimate" : `80% by ${fmtDate(os.p90Date)}`;
  const base = canonicalSlug(meta.year, meta.model, meta.region);
  const vq = version ? "?v=" + encodeURIComponent(version) : "";
  const url = `${SITE}/p/${base}${vq}`;
  const ogUrl = `${SITE}/p/${base}/og.png${vq}`;
  const q = `When will the ${car} get its next software update in ${region}?`;
  const title = `${car} next update (${region}) — ${date} · wenFSD`;
  const desc = `wenFSD predicts the ${car} gets its next Tesla software update around ${date} in ${region} (${windowLine}). ${fsdText(fsd, region)} A probability, not a promise.`;
  const appLink = `${SITE}/?model=${encodeURIComponent(meta.model)}&year=${meta.year}&region=${encodeURIComponent(region)}${version ? "&v=" + encodeURIComponent(version) : ""}`;

  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: `wenFSD predicts the next software update for a ${car} in ${region} arrives around ${date} (${windowLine}). This is a modelled probability from regional rollout cadence, not an official Tesla date.` } },
      { "@type": "Question", name: `Does this ${car} get a new FSD version next?`, acceptedAnswer: { "@type": "Answer", text: fsdText(fsd, region) || "FSD availability depends on hardware, region and entitlement." } },
    ],
  };

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website"><meta property="og:site_name" content="wenFSD">
<meta property="og:title" content="${esc(car)} — next update ${esc(date)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(ogUrl)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(car)} — next update ${esc(date)}">
<meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(ogUrl)}">
<meta name="theme-color" content="#e6394b">
<script type="application/ld+json">${JSON.stringify(faq).replace(/</g, "\\u003c")}</script>
<style>
  :root{color-scheme:dark}
  body{background:#0a0d12;color:#e9eef5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;line-height:1.55}
  .wrap{max-width:720px;margin:0 auto;padding:32px 22px 64px}
  .brand{font-weight:800;font-size:22px;text-decoration:none;color:#e9eef5}
  .brand span{color:#e62937}
  h1{font-size:26px;line-height:1.25;margin:26px 0 6px}
  .sub{color:#9fb0c3;margin:0 0 24px}
  .card{background:#0c1019;border:1px solid #27384b;border-radius:18px;padding:24px 24px 22px;margin:18px 0}
  .lbl{color:#6b7c91;font-weight:800;font-size:13px;letter-spacing:.04em;text-transform:uppercase}
  .date{font-size:54px;font-weight:800;color:#39d4ff;margin:6px 0 2px}
  .date.confirmed{color:#37d67a}
  .win{color:#9fb0c3}
  .fsd{margin:14px 0 0;color:#cdd9e6}
  .fsd-hold{margin:16px 0 0;padding:12px 14px;border:1px solid #5a3a2a;border-radius:12px;background:rgba(230,100,57,.08);color:#ffd9c2;font-weight:600}
  .note{color:#9fb0c3;font-size:15px;margin-top:14px}
  .cta{display:inline-block;background:#e62937;color:#fff;text-decoration:none;font-weight:800;border-radius:12px;padding:13px 22px;margin-top:8px}
  .foot{color:#6b7c91;font-size:13px;margin-top:26px}
  .foot a{color:#39d4ff;text-decoration:none}
</style></head>
<body><div class="wrap">
  <a class="brand" href="${esc(SITE)}/">wen<span>FSD</span></a>
  <h1>${esc(q)}</h1>
  <p class="sub">A per-car prediction from regional rollout cadence — free, no login, and honest about uncertainty.</p>
  <div class="card">
    <div class="lbl">${os.confirmed ? "Next update — confirmed by the car" : "Next software update — predicted"}</div>
    <div class="date${os.confirmed ? " confirmed" : ""}">${esc(date)}</div>
    <div class="win">${esc(windowLine)} · a prediction, not a promise</div>
    ${fsdText(fsd, region) ? `<p class="fsd${fsd && fsd.paused ? " fsd-hold" : ""}">${fsd && fsd.paused ? "" : "🧠 "}${esc(fsdText(fsd, region))}</p>` : ""}
    ${os.note ? `<p class="note">${esc(os.note)}</p>` : ""}
  </div>
  <a class="cta" href="${esc(appLink)}">Get your exact prediction →</a>
  <p class="foot">Showing a representative ${esc(car)} in ${esc(region)}${version ? ` on ${esc(version)}` : ""}. Enter your own current version (or connect read-only) for a sharper, personalised date.
  <br>How it works &amp; the honesty policy: <a href="${esc(SITE)}/">wenfsd.info</a> · <a href="${esc(SITE)}/when-will">browse other cars &amp; regions</a></p>
</div></body></html>`;
}

// ---- index page linking the top configs (seeds crawl) ----
export function renderIndex() {
  const top = [];
  for (const region of ["Australia", "New Zealand", "United States", "Europe", "Canada"]) {
    // Model Y L ships in AU/NZ/China — surface it there (lots of new RHD deliveries still waiting on FSD)
    const models = (region === "Australia" || region === "New Zealand") ? ["Model Y", "Model Y L", "Model 3"] : ["Model Y", "Model 3"];
    for (const model of models) {
      const year = model === "Model 3" ? 2025 : 2026;
      top.push({ slug: canonicalSlug(year, model, region), label: `${year} ${model}${generationOf(model, year) ? " " + generationOf(model, year) : ""} · ${region}` });
    }
  }
  const links = top.map(t => `<li><a href="${esc(SITE)}/p/${t.slug}">${esc(t.label)}</a></li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>When will my Tesla update? — predictions by model &amp; region · wenFSD</title>
<meta name="description" content="Browse wenFSD update predictions by Tesla model and region — when your next software update and FSD version are likely to land.">
<link rel="canonical" href="${esc(SITE)}/when-will">
<style>:root{color-scheme:dark}body{background:#0a0d12;color:#e9eef5;font-family:system-ui,sans-serif;margin:0}.wrap{max-width:720px;margin:0 auto;padding:32px 22px}a{color:#39d4ff;text-decoration:none}h1{font-size:24px}li{margin:8px 0}.brand{font-weight:800;color:#e9eef5}.brand span{color:#e62937}</style></head>
<body><div class="wrap"><a class="brand" href="${esc(SITE)}/">wen<span>FSD</span></a>
<h1>When will my Tesla update?</h1><p>Pick your car and region for a predicted next-update date:</p>
<ul>${links}</ul><p><a href="${esc(SITE)}/">← back to wenFSD</a></p></div></body></html>`;
}

// ---- dynamic OG image: build the card SVG, rasterise to PNG, cache by slug+version ----
// Must name the bundled family. resvg only has Inter loaded (no system fallback), so the generic
// keywords are inert here — the explicit name is what makes the text actually render on the server.
const SANS = "Inter, sans-serif";
export function ogSvg(meta, os, fsd) {
  const car = carLabel(meta).toUpperCase() + " · " + meta.region.toUpperCase();
  const date = fmtDate(os.medianDate);
  const lbl = os.confirmed ? "NEXT UPDATE — CONFIRMED BY THE CAR" : "NEXT SOFTWARE UPDATE — PREDICTED";
  const win = os.confirmed ? "your car is already downloading it" : os.stale ? "low-confidence estimate · a prediction, not a promise" : `80% by ${fmtDate(os.p90Date)} · a prediction, not a promise`;
  const dateColor = os.confirmed ? "#37d67a" : "#39d4ff";
  // when FSD is on hold here, the card leads with the timely hook (the share-worthy bit), not just the OS date
  // NOTE: this is a resvg raster, not the browser — emoji have no font here and would
  // tofu the WHOLE text run (fontdb swaps the run to a glyph-less fallback). Keep this
  // line pure Latin/punctuation only. (Verified by rendering the PNG and looking at it.)
  const holdLine = (fsd && fsd.paused)
    ? `<text x="100" y="500" font-family="${SANS}" font-size="29" font-weight="800" fill="#ffae7a">${esc(`FSD ${fsd.targetLabel || "v14"} ON HOLD in ${meta.region} · no resume date`)}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0a0d12"/>
  <rect x="48" y="48" width="1104" height="534" rx="28" fill="#0c1019" stroke="#27384b" stroke-width="2"/>
  <rect x="48" y="48" width="10" height="534" rx="5" fill="#e62937"/>
  <text x="100" y="138" font-family="${SANS}" font-size="46" font-weight="800"><tspan fill="#e9eef5">wen</tspan><tspan fill="#e62937">FSD</tspan></text>
  <text x="100" y="214" font-family="${SANS}" font-size="27" font-weight="700" fill="#9fb0c3">${esc(car)}</text>
  <text x="100" y="280" font-family="${SANS}" font-size="24" font-weight="800" fill="#6b7c91">${esc(lbl)}</text>
  <text x="96" y="388" font-family="${SANS}" font-size="98" font-weight="800" fill="${dateColor}">${esc(date)}</text>
  <text x="100" y="446" font-family="${SANS}" font-size="29" font-weight="500" fill="#9fb0c3">${esc(win)}</text>
  ${holdLine}
  <text x="100" y="552" font-family="${SANS}" font-size="34" font-weight="800" fill="#e62937">call your shot » wenfsd.info</text>
</svg>`;
}

// PWA app icon — the brand "?" mark, rasterised so installability is reliable (Chrome wants PNG).
const _iconCache = new Map();
export function iconPng(size) {
  const s = Math.max(48, Math.min(1024, parseInt(size, 10) || 192));
  if (_iconCache.has(s)) return _iconCache.get(s);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 192 192"><rect width="192" height="192" rx="42" fill="#e6394b"/><text x="96" y="142" font-family="${SANS}" font-size="132" font-weight="800" text-anchor="middle" fill="#ffffff">?</text></svg>`;
  const png = new Resvg(svg, { fitTo: { mode: "width", value: s }, font: FONT }).render().asPng();
  _iconCache.set(s, png);
  return png;
}

const _ogCache = new Map(); // slug+version+events+day → PNG Buffer
export function ogPng(meta, version, events) {
  // event signature in the key so a confirmed pause/resume invalidates the cached image; the day is
  // in the key too because the predicted date now tracks the real clock (predictForSlug) — without
  // it a card would freeze at whatever date it was first rendered and drift into the past.
  const evSig = (events || []).map(e => `${e.type}:${e.region || ""}:${e.version || ""}`).join(",");
  const day = new Date().toISOString().slice(0, 10);
  const key = canonicalSlug(meta.year, meta.model, meta.region) + "|" + (version || "") + "|" + evSig + "|" + day;
  if (_ogCache.has(key)) return _ogCache.get(key);
  const { os, fsd } = predictForSlug(meta, version, events);
  const png = new Resvg(ogSvg(meta, os, fsd), { fitTo: { mode: "width", value: 1200 }, font: FONT }).render().asPng();
  if (_ogCache.size > 500) _ogCache.clear();   // crude bound; pages are deterministic so just rebuild
  _ogCache.set(key, png);
  return png;
}
