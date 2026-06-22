/* wenFSD — seed data (v2: version-track + region + hardware aware)
 * Models BOTH tracks Tesla ships on:
 *   • OS version  — YYYY.WW.point  (e.g. 2026.20.3 = year 2026, week-20 branch, point 3)
 *   • FSD version — v12 / v13 / v14 …, a separate stack bundled into OS builds per hardware
 * Rollout differs by region (lag + regulatory gating) and by hardware (HW3/AI3 vs HW4/AI4).
 * Seeded from mid-2026 tracker snapshots + public FSD rollout reporting; tune freely.
 */
const WEN = (function () {
  const today = "2026-06-21";

  const carPreset = {
    model: "Model Y (Juniper)", year: 2026, hardware: "AI4",
    market: "Australia", drive: "RHD",
    earlinessPercentile: 0.42,
    installedVersion: "2026.14.6",   // OS version
    fsdVersion: "v13.2.9",           // FSD stack currently on the car (AU HW4 = v13)
    updateChannel: "standard",       // 'advanced' pulls releases sooner (real Tesla setting)
    earlyAccess: false,              // Tesla Early Access Program → updates first
  };

  // Controllable factors that shift your effective rollout percentile.
  // NOTE: real-world owner reports say the Advanced vs Standard update toggle makes
  // little measurable difference to *timing*, so we don't model it. The Early Access
  // Program (EAP), however, demonstrably puts you in the first wave.
  const earlyAccessShift = -0.30;

  // ---- OS version distribution (drives rollout curves + release cadence) ----
  // CONVENTION: each version's `t0` is the rollout MIDPOINT for the AUSTRALIAN fleet
  // (AU is the baseline, AU_LAG=12 in predict.js). Predictions for other regions apply
  // `regions[market].osLagDays - 12` as a delta. Do NOT set t0 from a version's firstSeen
  // (that's the rollout START, ~10+ days before the midpoint) — see api.js hydration.
  // `markets` = the regions that actually RECEIVE this build. Tesla does NOT ship every build
  // to every market: the US & Canada get nearly all of them (including point releases), while
  // Europe and Australia/New Zealand get a sparser, different sequence (regulatory homologation
  // + RHD validation means they skip many interim builds and jump between majors). When a build
  // omits a region, that region's "previous/next build" is computed from ITS OWN path, not the
  // global list. Region keys must match `regions` below.
  const versions = [
    { version: "2026.20.4", firstSeen: "2026-06-19", fleetPct: 3.2, status: "rolling", branch: "standard",
      k: 0.30, t0: "2026-06-30", fsdBuild: { AI4: "v14.3.5", AI3: "v12.6.4" },
      markets: ["United States", "Canada"],
      notes: "Fresh North-America-only point release. Europe/AU/NZ won't see this one — they wait for the next broad wave." },
    { version: "2026.20.3", firstSeen: "2026-06-17", fleetPct: 9.8, status: "rolling", branch: "standard",
      k: 0.34, t0: "2026-06-27", fsdBuild: { AI4: "v14.3.4", AI3: "v12.6.4" },
      markets: ["United States", "Canada", "Europe", "Australia", "New Zealand"],
      notes: "The broad v14 wave — the build that eventually reaches every market. Dashcam Viewer, charging UI, Sentry power tuning." },
    { version: "2026.20", firstSeen: "2026-06-10", fleetPct: 6.1, status: "tapering", branch: "standard",
      k: 0.31, t0: "2026-06-20", fsdBuild: { AI4: "v14.3.2", AI3: "v12.6.4" },
      markets: ["United States", "Canada"],
      notes: "Initial .20 branch — North America only. RHD/EU markets skipped straight to 2026.20.3." },
    { version: "2026.14.6.11", firstSeen: "2026-06-05", fleetPct: 24.4, status: "mature", branch: "standard",
      k: 0.36, t0: "2026-06-12", fsdBuild: { AI4: "v14.3.4", AI3: "v12.6.4" },
      markets: ["United States", "Canada", "Australia"],
      notes: "Point fix on the .14.6 branch — shipped to NA + Australia; Europe & NZ skipped it." },
    { version: "2026.14.6", firstSeen: "2026-05-22", fleetPct: 35.7, status: "mature", branch: "standard",
      k: 0.33, t0: "2026-06-01", fsdBuild: { AI4: "v13.2.9", AI3: "v12.6.4" },
      markets: ["United States", "Canada", "Europe", "Australia", "New Zealand"],
      notes: "Global build. Most-installed in the AU fleet — likely your current version." },
    { version: "2026.14.2", firstSeen: "2026-05-08", fleetPct: 11.3, status: "legacy", branch: "standard",
      k: 0.30, t0: "2026-05-18", fsdBuild: { AI4: "v13.2.8", AI3: "v12.6.3" },
      markets: ["United States", "Canada", "Europe", "Australia", "New Zealand"],
      notes: "Older global build. Tapering everywhere as cars move up." },
  ];

  // ---- Region model: OS lag + per-hardware FSD status ----
  // FSD status per (region, hardware):
  //   current  — FSD version the car is on now
  //   next     — the next FSD version it will receive (null if capped)
  //   mode     — 'rolling' (active logistic), 'early' (just started, wide), 'gated'
  //              (regulatory approval window), 'current' (already newest → cadence), 'capped'
  //              (hardware can't run it), 'promised' (promised but never delivered, NO committed
  //              timeline — we refuse to invent a date)
  //   t0/k     — logistic rollout params for the next FSD wave (when applicable)
  //   approval — {earliestDays,modeDays,latestDays} for 'gated' regions
  //   note     — honest plain-language status for 'promised'/'capped'
  // FSD-on-HW3 reality (mid-2026): FSD (Supervised) v14 ships HW4-only. HW3's only path is the
  // in-development "v14 Lite" — US FIRST (~end-June 2026); international markets are promised but
  // Tesla has committed to NO dates (regulatory + RHD validation). AU/NZ HW3 never received FSD
  // (Supervised) at all and are justifiably skeptical — so we model them as 'promised', not a date.
  const regions = {
    "United States": { osLagDays: 0, drive: "LHD", fsd: {
      AI4: { current: "v14.3.4", next: "v14.4.x", mode: "current", k: 0.16, cadenceDays: 28 },
      AI3: { current: "v12.6.4", next: "v14 Lite", mode: "rolling", k: 0.10, t0: "2026-06-30" } } },
    "Canada": { osLagDays: 3, drive: "LHD", fsd: {
      AI4: { current: "v14.3.2", next: "v14.3.4", mode: "rolling", k: 0.18, t0: "2026-06-26" },
      AI3: { current: "v12.6.4", next: "v14 Lite", mode: "promised", note: "v14 Lite rolls out in the US first; international markets follow with no committed date, and Tesla has flagged Canada as possibly delayed." } } },
    "Europe": { osLagDays: 9, drive: "LHD", fsd: {
      AI4: { current: "v13.2.8", next: "v14.x", mode: "gated", approval: { earliestDays: 25, modeDays: 90, latestDays: 220 }, k: 0.09 },
      AI3: { current: "none", next: "v14 Lite", mode: "promised", note: "FSD (Supervised) never shipped to HW3 in Europe. v14 Lite is promised internationally, but EU regulators impose the strictest automated-steering limits and Tesla has given no committed date." } } },
    "Australia": { osLagDays: 12, drive: "RHD", fsd: {
      AI4: { current: "v13.2.9", next: "v14.x", mode: "early", firstSeen: "2026-06-09", fleetPct: 18, k: 0.11, t0: "2026-06-23", t0Sigma: 6, newDeliveryFirst: true, existingFleetDelayDays: 55, existingFleetSigma: 21 },
      AI3: { current: "none", next: "v14 Lite", mode: "promised", note: "FSD (Supervised) has never shipped to HW3 in Australia. v14 Lite for older hardware is promised, but it's US-first and right-hand-drive markets need extra validation + regulatory sign-off — Tesla has committed to no date. Owners are right to be skeptical." } } },
    "New Zealand": { osLagDays: 14, drive: "RHD", fsd: {
      AI4: { current: "v13.2.9", next: "v14.x", mode: "early", firstSeen: "2026-06-19", fleetPct: 9, k: 0.10, t0: "2026-07-01", t0Sigma: 7, newDeliveryFirst: true, existingFleetDelayDays: 60, existingFleetSigma: 24 },
      AI3: { current: "none", next: "v14 Lite", mode: "promised", note: "FSD (Supervised) has never shipped to HW3 in New Zealand. v14 Lite is promised internationally but US-first, with no committed RHD/NZ date. Skepticism warranted." } } },
  };

  // Release notes per version (fleetctrl-style changelog). In real mode these are
  // ingested + merged from the external trackers; this is the seed/offline copy.
  const releaseNotes = {
    "2026.20.4": { date: "2026-06-19", regions: ["US", "Canada"], fsd: "v14.3.5 (HW4)", source: "Teslascope",
      items: [
        { tag: "FSD", text: "FSD (Supervised) v14.3.5 for HW4 — North America only; refined merges & roundabout handling" },
        { tag: "Fix", text: "Hotfix for a charging-session display glitch on 2026.20.3" },
      ] },
    "2026.20.3": { date: "2026-06-17", regions: ["US", "Europe", "Down Under"], fsd: "v14.3.4 (HW4)", source: "FleetCtrl + Teslascope",
      items: [
        { tag: "FSD", text: "FSD (Supervised) v14.3.4 for HW4 — smoother lane changes, fewer interventions" },
        { tag: "Dashcam", text: "Dashcam Viewer timeline scrubbing & clip export" },
        { tag: "Charging", text: "Redesigned charging stats with cost-per-session breakdown" },
        { tag: "Sentry", text: "Sentry Mode power-draw optimisation (lower vampire drain)" },
      ] },
    "2026.20": { date: "2026-06-10", regions: ["US", "Europe"], fsd: "v14.3.2 (HW4)", source: "FleetCtrl",
      items: [
        { tag: "FSD", text: "FSD (Supervised) v14.3.2 for HW4 — initial v14 branch" },
        { tag: "Nav", text: "New trip planner with smarter charging stops" },
        { tag: "Fix", text: "Bluetooth reconnection stability fixes" },
      ] },
    "2026.14.6.11": { date: "2026-06-05", regions: ["US", "Down Under"], fsd: "v14.3.4 (HW4)", source: "Teslascope",
      items: [
        { tag: "FSD", text: "FSD v14.3.4 bundled for HW4 on the .14.6 branch" },
        { tag: "Nav", text: "Navigation reliability improvements" },
        { tag: "Fix", text: "Point fix addressing media playback dropouts" },
      ] },
    "2026.14.6": { date: "2026-05-22", regions: ["Global"], fsd: "v13.2.9 (HW4)", source: "TeslaFi",
      items: [
        { tag: "FSD", text: "FSD v13.2.9 for HW4" },
        { tag: "Safety", text: "Blind Spot camera image improvements" },
        { tag: "UI", text: "Refreshed media player interface" },
      ] },
    "2026.14.2": { date: "2026-05-08", regions: ["Global"], fsd: "v13.2.8 (HW4)", source: "TeslaFi",
      items: [
        { tag: "FSD", text: "FSD v13.2.8 for HW4" },
        { tag: "UI", text: "Minor UI polish and localisation fixes" },
      ] },
  };

  // FSD regulatory milestones (Australia headline; shown in the FSD card)
  // Mixed provenance: `kind:"observed"` events are anchored to real tracker first-seen dates /
  // widely-reported rollouts; `kind:"projected"` events are modelled estimates. The UI shows
  // the two differently so users know which is which.
  const fsdMilestones = [
    { date: "2025", label: "FSD v13 (Supervised) launches for AU/NZ HW4 — the first RHD markets. HW3 gets nothing.", kind: "observed" },
    { date: "2026-04-28", label: "After mounting owner pressure, Tesla promises a stripped-down “v14 Lite” for HW3 — internationally, but with no committed dates", kind: "observed" },
    { date: "2026-06-19", label: "FSD (Supervised) v14 officially rolls out in Australia & New Zealand — HW4 only", kind: "observed" },
    { date: "2026-06-30 (est.)", label: "FSD v14 Lite for HW3 begins in the US — HW3's first taste of FSD, and the US goes first", kind: "projected" },
    { date: "AU/NZ HW3 — no date", label: "HW3 in Australia & NZ has never received FSD (Supervised). v14 Lite is promised but US-first and RHD-gated by regulators — realistically late 2026 / 2027 at the earliest, if it ships at all", kind: "projected" },
  ];

  // Historical OS-branch first-seen anchors (illustrative in sample mode; the LIVE site back-tests
  // against the real first-seen dates aggregated from the trackers). Used only by the model
  // back-test in the calibration card — NOT shown in the firmware table / feed.
  const versionHistory = [
    { version: "2025.26", firstSeen: "2025-07-14" },
    { version: "2025.32", firstSeen: "2025-08-25" },
    { version: "2025.38", firstSeen: "2025-10-06" },
    { version: "2025.44", firstSeen: "2025-11-17" },
    { version: "2026.2",  firstSeen: "2026-01-19" },
    { version: "2026.8",  firstSeen: "2026-03-09" },
    { version: "2026.14", firstSeen: "2026-05-08" },
    { version: "2026.20", firstSeen: "2026-06-10" },
  ];

  const feedSeeds = [
    { region: "Sydney, AU", model: "Model Y Juniper", hw: "AI4", from: "2026.14.6", to: "2026.20.3" },
    { region: "Melbourne, AU", model: "Model 3 Highland", hw: "AI4", from: "2026.14.6.11", to: "2026.20.3" },
    { region: "Brisbane, AU", model: "Model Y Juniper", hw: "AI4", from: "2026.14.6", to: "2026.14.6.11" },
    { region: "Perth, AU", model: "Model S", hw: "AI3", from: "2026.14.2", to: "2026.14.6" },
    { region: "Auckland, NZ", model: "Model Y Juniper", hw: "AI4", from: "2026.14.6", to: "2026.20" },
    { region: "Adelaide, AU", model: "Model 3", hw: "AI4", from: "2026.20", to: "2026.20.3" },
    { region: "Canberra, AU", model: "Model Y Juniper", hw: "AI4", from: "2026.14.6.11", to: "2026.20.3" },
    { region: "Gold Coast, AU", model: "Model X", hw: "AI3", from: "2026.14.2", to: "2026.14.6.11" },
  ];

  const stats = { carsTracked: 18432, auCars: 6207, updatesLogged: 312395, versionsTracked: 824, releases2026: 58 };

  // back-compat: regionLag map derived from regions
  const regionLag = Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, v.osLagDays]));

  // ---- version helpers ----
  // Parse any "YYYY.WW[.x[.y[.z]]]" string (3–5 numeric parts), e.g. 2026.8.3.10.
  function parseOS(v) {
    const m = String(v).trim().match(/^(\d{4})((?:\.\d+){1,5})/);
    if (!m) return null;
    const parts = m[2].split(".").filter(s => s !== "").map(Number);
    return { year: +m[1], week: parts[0] || 0, p1: parts[1] || 0, p2: parts[2] || 0, p3: parts[3] || 0, parts };
  }
  // Single comparable integer (stays within JS safe-integer range; supports 5 fields).
  function verKey(v) {
    const p = parseOS(v); if (!p) return 0;
    const c = p.parts, g = (i, cap) => Math.min(cap, c[i] || 0);
    return p.year * 1e12 + g(0, 999) * 1e9 + g(1, 999) * 1e6 + g(2, 999) * 1e3 + g(3, 999);
  }
  function cmpOS(a, b) { return verKey(a) - verKey(b); }
  function isValidVersion(v) { return !!parseOS(v); }
  // Example older builds for the version picker (any valid version is accepted — these are
  // just suggestions; with a backend connected, the full real version list is offered).
  const versionSuggestions = ["2026.8.3.10", "2026.8.3", "2026.2.9", "2025.44.30.5"];
  // FSD major from a string like "v13.2.9", "v14.x", "v14 (lite)" -> 13 / 14
  function fsdMajor(v) { const m = String(v).match(/v?(\d+)/i); return m ? +m[1] : null; }
  // Full comparable key so "v14.3.5" > "v14.3.4" > "v13.2.9". "v14.x" / "v14 Lite" compare as
  // major-only (their finer track is decided by region mode, not by this number). "none" -> 0.
  function fsdKey(v) {
    if (v == null) return 0;
    const s = String(v).toLowerCase();
    if (!/\d/.test(s)) return 0; // "none", "—"
    const m = s.match(/v?\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?/);
    if (!m) return 0;
    return (+m[1] || 0) * 1e9 + (+m[2] || 0) * 1e6 + (+m[3] || 0) * 1e3 + (+m[4] || 0);
  }

  // ---- region build-path helpers ----
  const ALL_MARKETS = Object.keys(regions);
  // which regions receive a build (default: all, for builds without an explicit list / live data)
  function marketsFor(v) { return Array.isArray(v.markets) && v.markets.length ? v.markets : ALL_MARKETS; }
  function inRegion(v, market) { return !market || marketsFor(v).includes(market); }
  // the builds a given region actually gets, newest-first (null/"" market ⇒ the global list)
  function versionsForRegion(market) {
    const list = market ? versions.filter(v => inRegion(v, market)) : versions.slice();
    return list.sort((a, b) => verKey(b.version) - verKey(a.version));
  }
  // region-adjusted first-seen: builds reach a region ~osLagDays after the (AU-based) seed date.
  // AU is the seed baseline (lag 12), so delta = region.osLagDays - 12.
  function regionFirstSeen(v, market) {
    if (!v.firstSeen) return null;
    const r = regions[market]; if (!r) return v.firstSeen;
    const delta = (r.osLagDays || 0) - 12;
    const d = new Date(v.firstSeen + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }
  // your region's previous + next build relative to a version (within that region's own path)
  function neighborsForRegion(version, market) {
    const list = versionsForRegion(market); // newest-first
    const i = list.findIndex(v => v.version === version);
    return { prev: i >= 0 && i < list.length - 1 ? list[i + 1] : null,
             next: i > 0 ? list[i - 1] : null,
             list };
  }

  return { today, carPreset, versions, versionHistory, regions, regionLag, fsdMilestones, releaseNotes, feedSeeds, stats,
           // 'sample' until a live backend hydrates real data (api.js flips this to 'live').
           dataMode: "sample", versionSuggestions, allMarkets: ALL_MARKETS,
           marketsFor, inRegion, versionsForRegion, regionFirstSeen, neighborsForRegion,
           earlyAccessShift, parseOS, verKey, cmpOS, fsdMajor, fsdKey, isValidVersion };
})();
