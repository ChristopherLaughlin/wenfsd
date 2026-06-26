/* Builds a downloadable .xlsx of the wenFSD prediction model: the live build/region data plus a
 * working calculator (change the inputs → the predicted date recomputes via real spreadsheet
 * formulas). A faithful, deterministic simplification of the in-app model: logistic placement
 * t = t0 + logit(p)/k, with a normal 80% band. (The app additionally runs Monte-Carlo for the
 * full distribution; the sheet uses the closed-form equivalent so it stays tinkerable.) */
(function () {
  "use strict";
  const B = (t) => ({ t, b: true });                       // bold header cell
  const F = (f, v) => ({ f, v });                          // formula cell w/ cached value
  const r2 = (n) => Math.round(n * 100) / 100;
  const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00Z") - new Date(a + "T00:00:00Z")) / 86400000);

  function buildSheets() {
    const W = WEN, today = W.today;
    const regions = W.regions, versions = W.versions.slice().sort((a, b) => W.verKey(b.version) - W.verKey(a.version));
    const v = (typeof av === "function" && av()) ? av() : null;          // your active car, if any
    const market = v ? v.market : "Australia";
    const hw = v ? v.hardware : "AI4";
    const region = regions[market] || regions["Australia"];
    const lag = region.osLagDays || 0;
    // the build the calculator pre-fills with: newest one your region actually receives
    const inRegion = versions.find(b => (!b.markets || b.markets.includes(market)) && (b.status === "rolling" || b.status === "tapering" || b.status === "mature")) || versions[0];

    // Seed the calculator from the ACTUAL in-app prediction so the downloadable model can't drift
    // from (or contradict) the site — the closed form alone misses the region/staleness/fresh-build
    // logic, which once made this sheet show a fresh AU build "tomorrow" while the site said weeks out.
    // We fold the app's effective midpoint (_t0Days) and realised 80% window into the input cells;
    // tinkering still works, we just start from honest, site-matching values.
    const p = (v && v.earliness != null) ? v.earliness : 0.45;
    const car = v
      ? Object.assign({}, v, { earlinessPercentile: (v.earlinessPercentile != null ? v.earlinessPercentile : p) })
      : { market, hardware: hw, installedVersion: "2026.14.6", earlinessPercentile: p, earlinessSource: "default" };
    const real = (typeof Predict !== "undefined" && Predict.predictNextOS) ? Predict.predictNextOS(car, today) : null;
    const dd = (x) => Math.round((new Date(x) - new Date(today + "T00:00:00Z")) / 86400000);
    let k, t0Days, sigma, targetVer, lowConf;
    if (real && real.medianDate && real._t0Days != null) {
      k = real._k || inRegion.k || 0.33;
      t0Days = Math.round(real._t0Days - lag);             // so t0 + lag reproduces the app's effective midpoint
      sigma = Math.max(2, Math.round((dd(real.p90Date) - dd(real.p10Date)) / (2 * 1.2816)));
      targetVer = real.targetLabel; lowConf = !!real.stale;
    } else {                                               // fallback if the predictor isn't loaded
      k = inRegion.k || 0.33; t0Days = daysBetween(today, inRegion.t0); sigma = 8; targetVer = inRegion.version; lowConf = false;
    }

    // ---- Calculator sheet ----
    const logit = (x) => Math.log(x / (1 - x));
    const offsetCached = r2(logit(p) / k + t0Days + lag);  // cached value of the median-offset formula (B12)
    const calc = [
      [B("wenFSD prediction model — change the yellow INPUT cells and watch the date move")],
      [{ t: "Open in Excel or Google Sheets. This is the real model, simplified to closed form so you can tinker — pre-filled to match exactly what the wenFSD site shows for this car." }],
      [],
      [B("INPUTS"), B("value"), B("what it is")],
      ["Your rollout percentile p (0–1)", p, "where your car sits in each update wave. 0.1 = first wave, 0.9 = last."],
      ["Curve steepness k", k, "how fast this build spreads across the fleet (from the data below)."],
      ["Effective midpoint t0 (days from today)", t0Days, "when this build reaches its rollout midpoint FOR YOUR REGION — already includes the regional + fresh-build wait the site applies."],
      ["Region lag (days)", lag, market + " runs this many days behind the US seed."],
      ["Window spread σ (days)", sigma, lowConf ? "wide on purpose — this is a low-confidence case (laggard, or a fresh build in a slow region), matching the site." : "Gaussian spread → the 80% confidence window."],
      [],
      [B("OUTPUTS"), B("days from today"), B("date")],
      // column B = days-from-today (numbers); column C = the date string (TEXT of TODAY()+B).
      // C cells reference B in the SAME row, and the p10/p90 offsets reference the median offset B12
      // (NOT the date text in C12) — otherwise the cells refer to themselves → circular references.
      ["Predicted arrival (median)", F("LN(B5/(1-B5))/B6 + B7 + B8", offsetCached), F('TEXT(TODAY()+B12,"yyyy-mm-dd")', null)],
      ["Earliest — p10 (80% window)", F("B12 - 1.2816*B9", r2(offsetCached - 1.2816 * sigma)), F('TEXT(TODAY()+B13,"yyyy-mm-dd")', null)],
      ["Latest — p90 (80% window)", F("B12 + 1.2816*B9", r2(offsetCached + 1.2816 * sigma)), F('TEXT(TODAY()+B14,"yyyy-mm-dd")', null)],
      [],
      [{ t: "Formula: arrival = t0 + ln(p / (1 − p)) / k + region_lag.  Band = arrival ± 1.2816·σ (the 10th/90th percentiles of a normal)." }],
      lowConf
        ? [{ t: "⚠️ Low-confidence case: this car is a laggard, or it's waiting on a fresh build in a slow right-hand-drive region, so the site widens the window hard and won't commit to a tight date — hence the large σ. The date is a broad guess, not one to bank on." }]
        : [{ t: "" }],
      [{ t: "Prefilled for your car: " + (v ? `${v.year} ${v.model} · ${hw} · ${market}, on build ${v.installedVersion || inRegion.version}` : `a typical ${market} ${hw} car`) + " — next build " + targetVer + ". Edit any input above." }],
    ];

    // ---- Builds sheet (live data) ----
    const builds = [[B("version"), B("first seen"), B("rollout midpoint t0"), B("k (steepness)"), B("status"), B("FSD (AI4)"), B("FSD (AI3)"), B("markets")]];
    for (const b of versions) builds.push([b.version, b.firstSeen || "", b.t0 || "", b.k || "", b.status || "", (b.fsdBuild && b.fsdBuild.AI4) || "", (b.fsdBuild && b.fsdBuild.AI3) || "", (b.markets || ["all"]).join(", ")]);

    // ---- Regions sheet (live data) ----
    const regs = [[B("region"), B("OS lag (days)"), B("drive"), B("AI4 FSD mode"), B("AI4 current"), B("AI4 next"), B("AI3 FSD mode"), B("AI3 current")]];
    for (const name of Object.keys(regions)) {
      const r = regions[name], f4 = (r.fsd && r.fsd.AI4) || {}, f3 = (r.fsd && r.fsd.AI3) || {};
      regs.push([name, r.osLagDays || 0, r.drive || "", f4.mode || "", f4.current || "", f4.next || "", f3.mode || "", f3.current || "—"]);
    }

    // ---- Read me ----
    const readme = [
      [B("wenFSD — the model, yours to tinker with")],
      [],
      [{ t: "Tabs: ‘Calculator’ (change inputs → see the date), ‘Builds’ and ‘Regions’ (the live data the app uses)." }],
      [{ t: "This is a deterministic simplification of the real model. The app additionally runs a Monte-Carlo simulation" }],
      [{ t: "for the full probability distribution, but the median + 80% window match this closed-form version." }],
      [],
      [{ t: "It models Tesla's staged, VIN-based rollout as a logistic S-curve: a build reaches ~50% of the fleet at its" }],
      [{ t: "midpoint t0, with steepness k. Your spot on the curve is your rollout percentile p. Newer FSD versions ship" }],
      [{ t: "INSIDE specific OS builds — not every build changes FSD." }],
      [],
      [{ t: "Found a flaw or a better fit? The whole thing is open source — PRs welcome. Generated " + today + "." }],
    ];

    return [
      { name: "Read me", rows: readme },
      { name: "Calculator", rows: calc },
      { name: "Builds", rows: builds },
      { name: "Regions", rows: regs },
    ];
  }

  window.downloadModelSheet = function () {
    try {
      const bytes = WENXLSX.build(buildSheets());
      WENXLSX.download("wenfsd-model.xlsx", bytes);
    } catch (e) { console.error("[modelsheet]", e); alert("Couldn't build the spreadsheet: " + e.message); }
  };

  const btn = document.getElementById("dlModelBtn");
  if (btn) btn.addEventListener("click", window.downloadModelSheet);
})();
