/* wenFSD — public, shareable, crawlable per-prediction pages + dynamic OG images.
 *
 * A page describes the prediction for a *configuration* (year · model · generation · region) —
 * NOT a person. No user data, no PII, fully deterministic, so the URL encodes everything and the
 * response caches forever. This is the keystone of two growth loops at once:
 *   • viral: a shared link unfurls into the actual prediction card (the OG image IS the ad)
 *   • SEO:   each page answers a real long-tail query ("when will my 2026 Model Y get FSD in AU?")
 */
import { Resvg } from "@resvg/resvg-js";
import { predictNextOS, predictNextFSD } from "./predict.js";
import * as W from "./wendata.js";
import { config } from "./config.js";

const SITE = config.publicBaseUrl.replace(/\/$/, "");

// ---- config space ----
const YEARS = []; for (let y = 2027; y >= 2017; y--) YEARS.push(y);
const MODELS = [["Model Y", "model-y"], ["Model 3", "model-3"], ["Model S", "model-s"], ["Model X", "model-x"], ["Cybertruck", "cybertruck"]];
const MODEL_BY_SLUG = new Map(MODELS.map(([name, slug]) => [slug, name]));
const SLUG_BY_MODEL = new Map(MODELS.map(([name, slug]) => [name, slug]));
const REGION_SLUG = { "United States": "united-states", "Canada": "canada", "Europe": "europe", "Australia": "australia", "New Zealand": "new-zealand" };

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

export function predictForSlug(meta, version) {
  const car = {
    market: meta.region,
    hardware: inferHardware(meta.model, meta.year),
    installedVersion: version || representativeVersion(meta.region),
    generation: meta.generation,
    earlinessSource: "default",
    fsdEntitlement: "unknown",
  };
  return { car, os: predictNextOS(car), fsd: predictNextFSD(car) };
}

// ---- escaping ----
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function carLabel(meta) { return `${meta.year} ${meta.model}${meta.generation ? " " + meta.generation : ""}`; }

// ---- the FSD one-liner (honest about the asymmetry: capped / gated / promised / rides-in-build) ----
function fsdLine(fsd) {
  if (!fsd || fsd.unavailable) return "";
  if (fsd.capped) return `FSD is capped on this hardware — ${esc(fsd.current || "your version")} is the end of the line.`;
  if (fsd.promised) return `FSD ${esc(fsd.targetLabel || "")} is promised for this hardware, but Tesla has given no committed date.`;
  if (fsd.notEntitled) return `The hardware can run FSD ${esc(fsd.targetLabel || "")}, but it only activates with a purchase or subscription.`;
  if (fsd.medianDate) return `Next FSD version (${esc(fsd.targetLabel || "")}) projected around ${esc(fmtDate(fsd.medianDate))}.`;
  return "";
}

// ---- HTML page (server-rendered, crawlable; CSP-safe — inline styles only, no inline script) ----
export function renderPage(meta, version) {
  const { os, fsd } = predictForSlug(meta, version);
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
  const desc = `wenFSD predicts the ${car} gets its next Tesla software update around ${date} in ${region} (${windowLine}). ${fsdLine(fsd).replace(/<[^>]+>/g, "")} A probability, not a promise.`;
  const appLink = `${SITE}/?model=${encodeURIComponent(meta.model)}&year=${meta.year}&region=${encodeURIComponent(region)}${version ? "&v=" + encodeURIComponent(version) : ""}`;

  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: `wenFSD predicts the next software update for a ${car} in ${region} arrives around ${date} (${windowLine}). This is a modelled probability from regional rollout cadence, not an official Tesla date.` } },
      { "@type": "Question", name: `Does this ${car} get a new FSD version next?`, acceptedAnswer: { "@type": "Answer", text: fsdLine(fsd).replace(/<[^>]+>/g, "") || "FSD availability depends on hardware, region and entitlement." } },
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
<script type="application/ld+json">${JSON.stringify(faq)}</script>
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
    ${fsdLine(fsd) ? `<p class="fsd">🧠 ${fsdLine(fsd)}</p>` : ""}
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
    for (const model of ["Model Y", "Model 3"]) {
      const year = model === "Model Y" ? 2026 : 2025;
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
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
function ogSvg(meta, os) {
  const car = carLabel(meta).toUpperCase() + " · " + meta.region.toUpperCase();
  const date = fmtDate(os.medianDate);
  const lbl = os.confirmed ? "NEXT UPDATE — CONFIRMED BY THE CAR" : "NEXT SOFTWARE UPDATE — PREDICTED";
  const win = os.confirmed ? "your car is already downloading it" : os.stale ? "low-confidence estimate · a prediction, not a promise" : `80% by ${fmtDate(os.p90Date)} · a prediction, not a promise`;
  const dateColor = os.confirmed ? "#37d67a" : "#39d4ff";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0a0d12"/>
  <rect x="48" y="48" width="1104" height="534" rx="28" fill="#0c1019" stroke="#27384b" stroke-width="2"/>
  <rect x="48" y="48" width="10" height="534" rx="5" fill="#e62937"/>
  <text x="100" y="138" font-family="${SANS}" font-size="46" font-weight="800"><tspan fill="#e9eef5">wen</tspan><tspan fill="#e62937">FSD</tspan></text>
  <text x="100" y="214" font-family="${SANS}" font-size="27" font-weight="700" fill="#9fb0c3">${esc(car)}</text>
  <text x="100" y="280" font-family="${SANS}" font-size="24" font-weight="800" fill="#6b7c91">${esc(lbl)}</text>
  <text x="96" y="392" font-family="${SANS}" font-size="98" font-weight="800" fill="${dateColor}">${esc(date)}</text>
  <text x="100" y="452" font-family="${SANS}" font-size="31" font-weight="500" fill="#9fb0c3">${esc(win)}</text>
  <text x="100" y="548" font-family="${SANS}" font-size="35" font-weight="800" fill="#e62937">call your shot 👉 wenfsd.info</text>
</svg>`;
}

const _ogCache = new Map(); // slug+version → PNG Buffer (deterministic inputs, safe to cache)
export function ogPng(meta, version) {
  const key = canonicalSlug(meta.year, meta.model, meta.region) + "|" + (version || "");
  if (_ogCache.has(key)) return _ogCache.get(key);
  const { os } = predictForSlug(meta, version);
  const png = new Resvg(ogSvg(meta, os), { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: true } }).render().asPng();
  if (_ogCache.size > 500) _ogCache.clear();   // crude bound; pages are deterministic so just rebuild
  _ogCache.set(key, png);
  return png;
}
