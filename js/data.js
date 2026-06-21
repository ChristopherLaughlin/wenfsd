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
  const versions = [
    { version: "2026.20.3", firstSeen: "2026-06-17", fleetPct: 9.8, status: "rolling", branch: "standard",
      k: 0.34, t0: "2026-06-27", fsdBuild: { AI4: "v14.3.4", AI3: "v12.6.4" },
      notes: "Latest wave. Dashcam Viewer, charging UI, Sentry power tuning." },
    { version: "2026.20", firstSeen: "2026-06-10", fleetPct: 6.1, status: "tapering", branch: "standard",
      k: 0.31, t0: "2026-06-20", fsdBuild: { AI4: "v14.3.2", AI3: "v12.6.4" },
      notes: "Initial .20 branch, superseded for most by 2026.20.3." },
    { version: "2026.14.6.11", firstSeen: "2026-06-05", fleetPct: 24.4, status: "mature", branch: "standard",
      k: 0.36, t0: "2026-06-12", fsdBuild: { AI4: "v14.3.4", AI3: "v12.6.4" },
      notes: "Point fix on the dominant .14.6 branch." },
    { version: "2026.14.6", firstSeen: "2026-05-22", fleetPct: 35.7, status: "mature", branch: "standard",
      k: 0.33, t0: "2026-06-01", fsdBuild: { AI4: "v13.2.9", AI3: "v12.6.4" },
      notes: "Most-installed build in the AU fleet. Likely your current version." },
    { version: "2026.14.2", firstSeen: "2026-05-08", fleetPct: 11.3, status: "legacy", branch: "standard",
      k: 0.30, t0: "2026-05-18", fsdBuild: { AI4: "v13.2.8", AI3: "v12.6.3" },
      notes: "Older but widely seen overall. Tapering as cars move up." },
  ];

  // ---- Region model: OS lag + per-hardware FSD status ----
  // FSD status per (region, hardware):
  //   current  — FSD version the car is on now
  //   next     — the next FSD version it will receive (null if capped)
  //   mode     — 'rolling' (active logistic), 'early' (just started, wide), 'gated'
  //              (regulatory approval window), 'current' (already newest → cadence), 'capped'
  //   t0/k     — logistic rollout params for the next FSD wave (when applicable)
  //   approval — {earliestDays,modeDays,latestDays} for 'gated' regions
  const regions = {
    "United States": { osLagDays: 0, drive: "LHD", fsd: {
      AI4: { current: "v14.3.4", next: "v14.4.x", mode: "current", k: 0.16, cadenceDays: 28 },
      AI3: { current: "v12.6.4", next: "v14 (lite)", mode: "rolling", k: 0.10, t0: "2026-07-05" } } },
    "Canada": { osLagDays: 3, drive: "LHD", fsd: {
      AI4: { current: "v14.3.2", next: "v14.3.4", mode: "rolling", k: 0.18, t0: "2026-06-26" },
      AI3: { current: "v12.6.4", next: "v14 (lite)", mode: "gated", approval: { earliestDays: 10, modeDays: 35, latestDays: 80 }, k: 0.10 } } },
    "Europe": { osLagDays: 9, drive: "LHD", fsd: {
      AI4: { current: "v13.2.8", next: "v14.x", mode: "gated", approval: { earliestDays: 25, modeDays: 90, latestDays: 220 }, k: 0.09 },
      AI3: { current: "v12.6.4", next: null, mode: "capped" } } },
    "Australia": { osLagDays: 12, drive: "RHD", fsd: {
      AI4: { current: "v13.2.9", next: "v14.x", mode: "early", firstSeen: "2026-06-09", fleetPct: 5.4, k: 0.085, t0: "2026-07-14", t0Sigma: 7 },
      AI3: { current: "v12.6.4", next: "v14 (lite)", mode: "gated", approval: { earliestDays: 5, modeDays: 30, latestDays: 75 }, k: 0.09 } } },
    "New Zealand": { osLagDays: 14, drive: "RHD", fsd: {
      AI4: { current: "v13.2.9", next: "v14.x", mode: "gated", approval: { earliestDays: 14, modeDays: 45, latestDays: 110 }, k: 0.08 },
      AI3: { current: "v12.6.4", next: "v14 (lite)", mode: "gated", approval: { earliestDays: 14, modeDays: 50, latestDays: 120 }, k: 0.08 } } },
  };

  // Release notes per version (fleetctrl-style changelog). In real mode these are
  // ingested + merged from the external trackers; this is the seed/offline copy.
  const releaseNotes = {
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
  const fsdMilestones = [
    { date: "2025-XX", label: "FSD v13 (Supervised) goes live for AU HW4 — first RHD market", done: true },
    { date: "2026-02-15", label: "Limited AU early-access v14 testing", done: true },
    { date: "2026-05-20", label: "Regulatory clearance for supervised v14 use", done: true },
    { date: "2026-06-09", label: "FSD v14 begins rolling out to AU HW4 owners (first batch)", done: true },
    { date: "2026-06-18", label: "Wider Sydney / Melbourne / Brisbane expansion", done: true },
    { date: "2026-Q3 (est.)", label: "Broad v14 availability across AU HW4 cars", done: false },
    { date: "2026-06-28 (est.)", label: "HW3 'v14 lite' begins (Autosteer on city streets)", done: false },
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
  // parse "2026.20.3" -> {year:2026, week:20, points:[3]} ; comparable via verKey
  function parseOS(v) {
    const m = String(v).match(/^(\d{4})\.(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!m) return null;
    return { year: +m[1], week: +m[2], p1: m[3] ? +m[3] : 0, p2: m[4] ? +m[4] : 0 };
  }
  function verKey(v) { const p = parseOS(v); return p ? p.year * 1e9 + p.week * 1e6 + p.p1 * 1e3 + p.p2 : 0; }
  function cmpOS(a, b) { return verKey(a) - verKey(b); }
  // FSD major from a string like "v13.2.9", "v14.x", "v14 (lite)" -> 13 / 14
  function fsdMajor(v) { const m = String(v).match(/v?(\d+)/i); return m ? +m[1] : null; }

  return { today, carPreset, versions, regions, regionLag, fsdMilestones, releaseNotes, feedSeeds, stats,
           earlyAccessShift, parseOS, verKey, cmpOS, fsdMajor };
})();
