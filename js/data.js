/* wenFSD — seed data (v2: version-track + region + hardware aware)
 * Models BOTH tracks Tesla ships on:
 *   • OS version  — YYYY.WW.point  (e.g. 2026.20.3 = year 2026, week-20 branch, point 3)
 *   • FSD version — v12 / v13 / v14 …, a separate stack bundled into OS builds per hardware
 * Rollout differs by region (lag + regulatory gating) and by hardware (HW3/AI3 vs HW4/AI4).
 * Seeded from mid-2026 tracker snapshots + public FSD rollout reporting; tune freely.
 */
const WEN = (function () {
  const today = "2026-06-26";

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
  // Builds in circulation as of late June 2026 (sourced from notateslaapp / Teslascope / TeslaFi /
  // Tessie public trackers). TWO kinds of build live here, and conflating them is the classic mistake:
  //   • MAINSTREAM OS builds (2026.20.x) — feature/security updates (parental controls, Grok, dashcam
  //     encryption). They go to EVERY market and BOTH HW3 + HW4, and they do NOT change your FSD version.
  //   • FSD-carrying builds — region-specific numbers for the same FSD version because of RHD/regulatory
  //     forks: North America 2026.14.6.x (v14.3.4), Oceania 2026.16.6 (v14.3.3), Europe 2026.17.5
  //     (v14.2.2.6). These are HW4-only; HW3 stays on v12.6.4.
  // So the OS "next build" is REGION-driven (hardware-agnostic); the FSD version is HARDWARE + REGION
  // driven (see `regions` below). fsdBuild here is the FSD a build CARRIES; whether you actually receive
  // that FSD is gated by your region's FSD status (a paused/gated region won't get it via a mainstream build).
  const versions = [
    { version: "2026.20.3", firstSeen: "2026-06-09", fleetPct: 37.0, status: "rolling", branch: "standard",
      k: 0.34, t0: "2026-06-22", fsdBuild: { AI4: "v14.3.4", AI3: "v12.6.4" },
      markets: ["United States", "Canada", "Europe", "Australia", "New Zealand"],
      notes: "Most widely rolled-out build (~37% of the fleet). Mainstream OS update — parental controls, Grok assistant, encrypted Dashcam. Reaches every market and both HW3 + HW4; it does NOT change your FSD version." },
    { version: "2026.20.5.1", firstSeen: "2026-06-29", fleetPct: 0.1, status: "early", branch: "standard",
      k: 0.12, t0: "2026-07-18", fsdBuild: { AI4: "—", AI3: "v14 Lite" },
      markets: ["United States"],
      notes: "FSD v14 Lite for HW3 — the FIRST build to bring v14 to AI3 cars (distilled from the HW4 v14 neural net to ~15% its size so it fits HW3's older compute). Began 29 Jun 2026 to US early-access HW3 owners (high Safety Score + influencers), widening 'over the coming weeks' per Tesla AI chief Ashok Elluswamy. Still Level-2 supervised — it does NOT make HW3 self-driving. AU/NZ/EU HW3 expected to follow, no committed date. (status:'early' = real build, shown for reference, but it's the FSD region status — not this row — that drives your v14 Lite estimate.)" },
    { version: "2026.20", firstSeen: "2026-05-30", fleetPct: 13.9, status: "tapering", branch: "standard",
      k: 0.31, t0: "2026-06-10", fsdBuild: { AI4: "v14.3.4", AI3: "v12.6.4" },
      markets: ["United States", "Canada", "Europe", "Australia", "New Zealand"],
      notes: "The .20 base build (rolled Europe-first, then North America). Superseded by 2026.20.3 for most cars." },
    { version: "2026.17.5", firstSeen: "2026-06-14", fleetPct: 1.4, status: "rolling", branch: "standard",
      k: 0.12, t0: "2026-06-24", fsdBuild: { AI4: "v14.2.2.6", AI3: "—" },
      markets: ["Europe"],
      notes: "Europe's FSD (Supervised) build — carries FSD v14.2.2.6 (HW4). EU sits a step behind North America on the FSD branch due to regulatory approval." },
    { version: "2026.16.6", firstSeen: "2026-06-19", fleetPct: 0.2, status: "rolling", branch: "standard",
      k: 0.10, t0: "2026-06-22", fsdBuild: { AI4: "v14.3.3", AI3: "—" },
      markets: ["Australia", "New Zealand"],
      notes: "Oceania's FSD (Supervised) build — carried FSD v14.3.3 (HW4) to the first AU/NZ cars around 19 Jun, before Tesla paused the rollout. RHD-specific; HW4 only." },
    { version: "2026.14.6.10", firstSeen: "2026-06-13", fleetPct: 6.0, status: "mature", branch: "standard",
      k: 0.33, t0: "2026-06-16", fsdBuild: { AI4: "v14.3.4", AI3: "v12.6.4" },
      markets: ["United States", "Canada"],
      notes: "North America's FSD (Supervised) build — carries FSD v14.3.4 (HW4), the newest FSD branch. HW3 cars on it stay on v12.6.4." },
    { version: "2026.2.6.5", firstSeen: "2026-04-18", fleetPct: 7.5, status: "legacy", branch: "standard",
      k: 0.30, t0: "2026-04-28", fsdBuild: { AI4: "v13.2.9", AI3: "v12.6.4" },
      markets: ["United States", "Canada", "Europe", "Australia", "New Zealand"],
      notes: "Older global build still common on cars that update slowly. Pre-v14 for HW4 (v13.2.9)." },
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
  // "v14 Lite" for HW3 is PROMISED, not shipping — Tesla teased a reduced FSD for older hardware
  // (US first) but committed to NO date anywhere, and every build still ships v12.6.4 to HW3. So we
  // model ALL regions as 'promised' (no fabricated date) — including the US — until it actually lands.
  const regions = {
    "United States": { osLagDays: 0, drive: "LHD", fsd: {
      AI4: { current: "v14.3.4", next: "v14.4.x", mode: "current", k: 0.16, cadenceDays: 28 },
      AI3: { current: "v12.6.4", next: "v14 Lite", mode: "early", k: 0.12, t0: "2026-07-18", t0Sigma: 12, note: "HW3's first FSD beyond v12.6.4 is finally real. Tesla started rolling FSD v14 Lite (build 2026.20.5.1) to US early-access HW3 cars on 29 Jun 2026 — high Safety Score drivers + influencers first — and says it'll widen 'over the coming weeks' based on feedback. The window below is modelled off that: early-access cars already have it; most HW3 owners are looking at the following few weeks. Still Level-2 supervised." } } },
    "Canada": { osLagDays: 3, drive: "LHD", fsd: {
      AI4: { current: "v13.2.9", next: "v14.3.4", mode: "rolling", k: 0.18, t0: "2026-06-26" },
      AI3: { current: "v12.6.4", next: "v14 Lite", mode: "promised", note: "HW3 is capped at FSD v12.6.4. v14 Lite is no longer just a promise — Tesla started the US early-access rollout (build 2026.20.5.1) on 29 Jun 2026 and is widening it 'over the coming weeks.' Canada follows the US, but Tesla has given no committed Canadian date yet, so we won't fake one." } } },
    "Europe": { osLagDays: 9, drive: "LHD", fsd: {
      AI4: { current: "v14.2.2.6", next: "v14.3.x", mode: "gated", approval: { earliestDays: 20, modeDays: 70, latestDays: 180 }, k: 0.09 },
      AI3: { current: "none", next: "v14 Lite", mode: "promised", note: "FSD (Supervised) never shipped to HW3 in Europe. v14 Lite is now real — Tesla started the US early-access rollout (build 2026.20.5.1) on 29 Jun 2026 — but EU regulators impose the strictest automated-steering limits, so Europe follows the US with no committed date. It's coming; the when is genuinely unknown." } } },
    "Australia": { osLagDays: 12, drive: "RHD", fsd: {
      AI4: { current: "v13.2.9", next: "v14.3.3", mode: "early", firstSeen: "2026-06-19", fleetPct: 1, k: 0.11, t0: "2026-06-22", t0Sigma: 6, newDeliveryFirst: true, existingFleetDelayDays: 55, existingFleetSigma: 21, paused: true, pausedSince: "2026-06-21", pauseNote: "FSD (Supervised) v14.3.3 began reaching AU HW4 cars around 19 June 2026 via build 2026.16.6 — then, after only a small number of cars got it, Tesla paused the rollout. No committed resume date (new Model Y / Model Y L deliveries are still waiting too). We've frozen the estimate rather than show a date that no longer holds; it un-freezes automatically once enough owners report it rolling again." },
      AI3: { current: "none", next: "v14 Lite", mode: "promised", note: "FSD (Supervised) has never shipped to HW3 in Australia — but v14 Lite is no longer vapourware. Tesla started rolling it to US early-access HW3 cars (build 2026.20.5.1) on 29 Jun 2026 and says international markets follow 'in the coming weeks.' For RHD Australia that still means extra validation + regulatory sign-off and NO committed date — but it's real now, and your turn is coming." } } },
    "New Zealand": { osLagDays: 14, drive: "RHD", fsd: {
      AI4: { current: "v13.2.9", next: "v14.3.3", mode: "early", firstSeen: "2026-06-19", fleetPct: 0.5, k: 0.10, t0: "2026-06-24", t0Sigma: 7, newDeliveryFirst: true, existingFleetDelayDays: 60, existingFleetSigma: 24, paused: true, pausedSince: "2026-06-21", pauseNote: "FSD (Supervised) v14.3.3 started rolling to NZ HW4 cars alongside Australia (around 19 June 2026), then Tesla paused the Oceania rollout after only a handful received it — no committed resume date. We've frozen the estimate rather than show a date that no longer holds; it un-freezes automatically once enough owners report it rolling again." },
      AI3: { current: "none", next: "v14 Lite", mode: "promised", note: "FSD (Supervised) has never shipped to HW3 in New Zealand — but v14 Lite is real now: Tesla began the US early-access rollout (build 2026.20.5.1) on 29 Jun 2026, with international markets to follow 'in the coming weeks.' RHD NZ needs extra validation + regulatory sign-off, so there's no committed date — but it's no longer just a promise." } } },
  };

  // Release notes per version (fleetctrl-style changelog). In real mode these are
  // ingested + merged from the external trackers; this is the seed/offline copy.
  const releaseNotes = {
    "2026.20.3": { date: "2026-06-09", regions: ["Global"], fsd: "unchanged", source: "notateslaapp + Teslascope",
      items: [
        { tag: "OS", text: "Mainstream update (most-installed build, ~37% of the fleet). Does NOT change your FSD version." },
        { tag: "Safety", text: "Parental Controls — block Browser, Theater & Arcade (Controls › Safety › Parental Controls)" },
        { tag: "Privacy", text: "Dashcam clips are now encrypted on USB — only your car can view them" },
        { tag: "AI", text: "Grok assistant (xAI) in the App Launcher / long-press voice / “Hey Grok”" },
        { tag: "Fix", text: "Point fixes on the .20 branch; blind-spot warning while parked" },
      ] },
    "2026.20.5.1": { date: "2026-06-29", regions: ["United States"], fsd: "v14 Lite (HW3)", source: "Tesla / notateslaapp + Tesla Oracle",
      items: [
        { tag: "FSD", text: "FSD (Supervised) v14 Lite for HW3 — the first v14 build for AI3 cars, distilled from the HW4 v14 neural net (~15% the size) to fit HW3. Brings v14-style navigation, merges, traffic-light & pedestrian handling, plus parking/unparking/reversing with arrival options." },
        { tag: "FSD", text: "Began 29 Jun 2026 to US early-access HW3 owners (high Safety Score + influencers); wider rollout 'over the coming weeks' based on feedback. Still Level-2 supervised — hands ready, eyes on the road." },
        { tag: "Note", text: "International HW3 (Europe, Australia, New Zealand) is expected to follow, with no committed date." },
      ] },
    "2026.20": { date: "2026-05-30", regions: ["Global"], fsd: "unchanged", source: "notateslaapp",
      items: [
        { tag: "OS", text: "The .20 base build — rolled Europe-first, then North America. Feature/security update, FSD unchanged." },
        { tag: "AI", text: "Grok assistant introduced" },
        { tag: "Privacy", text: "Encrypted Dashcam footage" },
      ] },
    "2026.17.5": { date: "2026-06-14", regions: ["Europe"], fsd: "v14.2.2.6 (HW4)", source: "notateslaapp",
      items: [
        { tag: "FSD", text: "FSD (Supervised) v14.2.2.6 for HW4 — Europe's FSD branch sits behind North America pending regulatory approval" },
      ] },
    "2026.16.6": { date: "2026-06-19", regions: ["Australia", "New Zealand"], fsd: "v14.3.3 (HW4)", source: "Tesla Oracle + notateslaapp",
      items: [
        { tag: "FSD", text: "FSD (Supervised) v14.3.3 for HW4 — Oceania's first v14 build (RHD). Reached a small number of cars before Tesla paused the rollout." },
      ] },
    "2026.14.6.10": { date: "2026-06-13", regions: ["United States", "Canada"], fsd: "v14.3.4 (HW4)", source: "Tesla Oracle + notateslaapp",
      items: [
        { tag: "FSD", text: "FSD (Supervised) v14.3.4 for HW4 — rebuilt AI compiler (MLIR), ~20% faster reaction time" },
        { tag: "FSD", text: "Actually Smart Summon for Cybertruck; parking options shown on the map at your destination" },
        { tag: "Fun", text: "Celebratory confetti when you hit an FSD streak milestone" },
      ] },
    "2026.2.6.5": { date: "2026-04-18", regions: ["Global"], fsd: "v13.2.9 (HW4)", source: "TeslaFi",
      items: [
        { tag: "FSD", text: "FSD v13.2.9 for HW4 (pre-v14)" },
        { tag: "UI", text: "Older global build, still common on slow-updating cars" },
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
    { date: "2026-06-29", label: "FSD v14 Lite for HW3 begins — Tesla starts the US early-access rollout (build 2026.20.5.1). HW3's first FSD beyond v12.6.4, distilled from the HW4 v14 brain to ~15% its size. Widening over the coming weeks.", kind: "observed" },
    { date: "AU/NZ HW3 — coming, no date", label: "v14 Lite has now started overseas (US, 29 Jun) — so HW3 FSD is real, not vapourware. Tesla says international markets follow 'in the coming weeks,' but RHD Australia & NZ still need extra validation + regulatory sign-off, so there's no committed date yet.", kind: "projected" },
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
    { version: "2026.20", firstSeen: "2026-05-30" },
  ];

  const feedSeeds = [
    { region: "Sydney, AU", model: "Model Y Juniper", hw: "AI4", from: "2026.14.6", to: "2026.20.3" },
    { region: "Melbourne, AU", model: "Model 3 Highland", hw: "AI4", from: "2026.2.6.5", to: "2026.20.3" },
    { region: "Brisbane, AU", model: "Model Y Juniper", hw: "AI4", from: "2026.16.6", to: "2026.20.3" },
    { region: "Perth, AU", model: "Model S", hw: "AI3", from: "2026.2.6.5", to: "2026.20" },
    { region: "Auckland, NZ", model: "Model Y Juniper", hw: "AI4", from: "2026.14.6", to: "2026.16.6" },
    { region: "Adelaide, AU", model: "Model 3", hw: "AI4", from: "2026.20", to: "2026.20.3" },
    { region: "Canberra, AU", model: "Model Y Juniper", hw: "AI3", from: "2026.2.6.5", to: "2026.20.3" },
    { region: "Gold Coast, AU", model: "Model X", hw: "AI3", from: "2026.14.6", to: "2026.20" },
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
