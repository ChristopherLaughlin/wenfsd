/* wenFSD — prediction engine (v2: generalized next-update predictor)
 * Predicts the NEXT thing a car will receive on either track:
 *   • next OS update   (predictNextOS)   — newest distributed build above yours, or, if
 *                                           you're current, the next branch projected from
 *                                           Tesla's historical release cadence.
 *   • next FSD version (predictNextFSD)  — region + hardware aware: rolling / early /
 *                                           regulatory-gated / cadence / capped (HW3).
 * Both run a Monte Carlo over rollout shape + your rollout percentile + regional lag to
 * return a DATE DISTRIBUTION with confidence bands — driven by live + historical + stats.
 */
const Predict = (function () {
  const DAY = 86400000;
  const AU_LAG = 12; // seed OS midpoints (versions[].t0) are AU-based; other regions offset from this

  // ---- dates ----
  // Parse calendar dates as UTC midnight so client + server compute identically
  // (server uses the same convention). Display still localises via toLocaleDateString.
  function toDate(s) { return new Date(typeof s === "string" && s.length <= 10 ? s + "T00:00:00Z" : s); }
  function daysBetween(a, b) { return (toDate(b) - toDate(a)) / DAY; }
  function addDays(s, n) { const d = (typeof s === "string") ? toDate(s) : new Date(s); return new Date(d.getTime() + n * DAY); }
  function isoDay(d) { return new Date(d).toISOString().slice(0, 10); }
  function fmtDate(d) { return new Date(d).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); }

  // ---- math ----
  function logit(p) { p = Math.min(0.999, Math.max(0.001, p)); return Math.log(p / (1 - p)); }
  function adoption(t, k, L) { return L / (1 + Math.exp(-k * t)); }
  function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function triangular(r, lo, mode, hi) { const u = r(), c = (mode - lo) / (hi - lo); return u < c ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode)); }
  function quantile(s, q) { const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo); }
  function hashInputs(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

  // ---- core Monte Carlo ----
  // opts: { t0Days, k, L, earliness, t0Sigma, N, approval?:{earliestDays,modeDays,latestDays},
  //         midpointAfterApprovalDays?, seedStr }
  function mcPredict(opts) {
    const N = opts.N || 4000, L = opts.L || 0.95;
    const r = rng(hashInputs(opts.seedStr || "x"));
    const samples = [], approvals = [];
    for (let i = 0; i < N; i++) {
      let t0;
      if (opts.approval) {
        const a = triangular(r, opts.approval.earliestDays, opts.approval.modeDays, opts.approval.latestDays) + gauss(r) * 6;
        approvals.push(a);
        t0 = a + (opts.midpointAfterApprovalDays || 22) + gauss(r) * 5;
      } else {
        t0 = opts.t0Days + gauss(r) * (opts.t0Sigma || 2.4);
      }
      const k = Math.max(0.04, opts.k + gauss(r) * (opts.k * 0.15));
      let p = opts.earliness + gauss(r) * 0.10; p = Math.min(0.97, Math.max(0.03, p));
      let t = t0 + logit(p) / k;
      // a feature can't arrive before the OS build that carries it (FSD floor)
      if (opts.floorDays != null) t = Math.max(t, opts.floorDays);
      samples.push(t);
    }
    const out = summarize(samples, opts.today, { k: opts.k, L, t0Base: opts.approval ? null : opts.t0Days });
    if (approvals.length) { approvals.sort((a, b) => a - b); out.approval = { p10: quantile(approvals, 0.1), median: quantile(approvals, 0.5), p90: quantile(approvals, 0.9) }; }
    return out;
  }

  function summarize(samples, today, shape) {
    samples.sort((a, b) => a - b);
    const median = quantile(samples, 0.5), p10 = quantile(samples, 0.1), p90 = quantile(samples, 0.9);
    const pmf = {};
    for (const s of samples) { const d = Math.max(0, Math.round(s)); pmf[d] = (pmf[d] || 0) + 1; }
    for (const key in pmf) pmf[key] /= samples.length;
    const horizon = Math.ceil(Math.min(400, Math.max(30, p90 + 14)));
    const curve = [];
    if (shape.t0Base != null) for (let d = 0; d <= horizon; d++) curve.push({ day: d, pct: adoption(d - shape.t0Base, shape.k, shape.L) * 100 });
    return {
      samples, median, p10, p90, pmf, curve, horizon,
      medianDate: addDays(today, median), p10Date: addDays(today, p10), p90Date: addDays(today, p90),
      daysToMedian: Math.round(median),
      probWithin: (days) => samples.filter(s => s <= days).length / samples.length,
    };
  }

  // ---- release cadence (statistical, from historical branch first-seen dates) ----
  function osCadence() {
    const branches = {};
    for (const v of WEN.versions) { const p = WEN.parseOS(v.version); const key = p.year + "." + p.week; if (!branches[key] || v.firstSeen < branches[key]) branches[key] = v.firstSeen; }
    const dates = Object.values(branches).sort();
    if (dates.length < 2) return { mean: 21, sd: 7 };
    const gaps = []; for (let i = 1; i < dates.length; i++) gaps.push(daysBetween(dates[i - 1], dates[i]));
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length) || mean * 0.4;
    return { mean, sd: Math.max(3, sd) };
  }

  // ---- NEXT OS UPDATE ----
  function predictNextOS(car, today) {
    const region = WEN.regions[car.market] || { osLagDays: AU_LAG };
    const delta = region.osLagDays - AU_LAG;
    const myKey = WEN.verKey(car.installedVersion);

    // newest distributed version strictly newer than yours
    const newer = WEN.versions.filter(v => WEN.verKey(v.version) > myKey &&
      (v.status === "rolling" || v.status === "tapering" || v.status === "mature"))
      .sort((a, b) => WEN.verKey(b.version) - WEN.verKey(a.version));

    if (newer.length) {
      const v = newer[0];
      const t0Days = daysBetween(today, v.t0) + delta;
      const out = mcPredict({ t0Days, k: v.k, L: 0.95, earliness: car.earlinessPercentile, today, seedStr: "OS" + v.version + car.market + car.earlinessPercentile });
      out.targetLabel = v.version; out.kind = "distributed"; out.branch = "os"; out._t0Days = t0Days; out._k = v.k;
      out.note = `Newest build above yours that's actively rolling. Midpoint ~${fmtDate(addDays(today, t0Days)).replace(/^\w+, /, "")}.`;
      return out;
    }

    // you're already current → project the NEXT branch from release cadence
    const cad = osCadence();
    const lastBranchDate = WEN.versions.map(v => v.firstSeen).sort().slice(-1)[0];
    const sinceLast = daysBetween(lastBranchDate, today);
    const t0Days = Math.max(2, cad.mean - sinceLast) + delta + 6; // midpoint a touch after first appearance
    const p = WEN.parseOS(WEN.versions[0].version);
    const projWeek = (p.week + Math.round(cad.mean / 7)) % 52 || p.week + 3;
    const out = mcPredict({ t0Days, k: 0.33, L: 0.95, earliness: car.earlinessPercentile, t0Sigma: cad.sd, today, seedStr: "OSproj" + car.market + car.earlinessPercentile });
    out.targetLabel = `2026.${projWeek}.x (projected)`; out.kind = "projected"; out.branch = "os"; out._t0Days = t0Days; out._k = 0.33;
    out.note = `You're on the newest build. Projected from Tesla's cadence (~${Math.round(cad.mean)}±${Math.round(cad.sd)} days between branches).`;
    return out;
  }

  function regionDelta(car) { const r = WEN.regions[car.market]; return (r ? r.osLagDays : AU_LAG) - AU_LAG; }
  // earliest distributed OS build whose bundled FSD build (for this hardware) is >= nextMajor
  function carrierBuild(car, nextMajor) {
    if (!nextMajor) return null;
    const carriers = WEN.versions.filter(v => {
      if (!(v.status === "rolling" || v.status === "tapering" || v.status === "mature")) return false;
      const fb = v.fsdBuild && v.fsdBuild[car.hardware];
      return fb && WEN.fsdMajor(fb) >= nextMajor;
    }).sort((a, b) => WEN.verKey(a.version) - WEN.verKey(b.version));
    return carriers[0] || null;
  }

  // ---- NEXT FSD VERSION ----
  function predictNextFSD(car, today) {
    const region = WEN.regions[car.market];
    const f = region && region.fsd ? region.fsd[car.hardware] : null;
    if (!f) return { unavailable: true, current: car.fsdVersion || "—", note: `No FSD data for ${car.hardware} in ${car.market}.` };
    if (f.mode === "capped") return { capped: true, current: f.current, note: `${car.hardware} is capped at ${f.current} — Tesla has stated this hardware can't run newer FSD.` };

    const nextMajor = WEN.fsdMajor(f.next);

    // 'current' — already on the newest FSD → project the next point from FSD cadence.
    if (f.mode === "current") {
      const cad = f.cadenceDays || 35, t0Days = cad;
      const out = mcPredict({ t0Days, k: f.k || 0.15, L: 0.9, earliness: car.earlinessPercentile, t0Sigma: cad * 0.45, today, seedStr: "FSDc" + car.market + car.earlinessPercentile });
      out._t0Days = t0Days; out._k = f.k || 0.15;
      out.targetLabel = f.next; out.current = f.current; out.mode = f.mode; out.branch = "fsd";
      out.note = `You're on the newest FSD (${f.current}). Projected next drop (${f.next}) from the ~${cad}-day FSD cadence.`;
      return out;
    }

    // ── FSD ships BUNDLED inside OS builds ─────────────────────────────────────────────────
    // The next FSD major version arrives exactly when you receive an OS build that carries it.
    // So its timing is NOT a separate schedule — it's the OS prediction for that carrier build.
    // This is why "next software update" and "next FSD version" must be consistent.
    const myKey = WEN.verKey(car.installedVersion || "0");
    const distributed = WEN.versions.filter(v => v.status === "rolling" || v.status === "tapering" || v.status === "mature");
    const nextBuild = distributed.filter(v => WEN.verKey(v.version) > myKey).sort((a, b) => WEN.verKey(b.version) - WEN.verKey(a.version))[0];
    const carrier = carrierBuild(car, nextMajor); // earliest distributed build whose FSD >= nextMajor

    if (nextBuild && nextBuild.fsdBuild && WEN.fsdMajor(nextBuild.fsdBuild[car.hardware]) >= nextMajor) {
      // your NEXT software update already carries the new FSD → they arrive together
      const os = predictNextOS(car, today);
      os.targetLabel = f.next; os.current = f.current; os.mode = f.mode; os.branch = "fsd"; os.bundledWith = nextBuild.version;
      os.note = `${f.next} ships inside OS build ${nextBuild.version} — which is your next software update — so they arrive together. FSD is bundled in the OS build, not on a separate schedule.`;
      return os;
    }
    if (f.mode === "gated") {
      const out = mcPredict({ approval: f.approval, k: f.k, L: 0.9, earliness: car.earlinessPercentile, today, seedStr: "FSDg" + f.next + car.market + car.earlinessPercentile });
      const a = out.approval;
      out.targetLabel = f.next; out.current = f.current; out.mode = f.mode; out.branch = "fsd";
      out.note = `${f.next} isn't approved for ${car.market} yet. Likely regulatory window ${shortFsd(addDays(today, a.p10))}–${shortFsd(addDays(today, a.p90))}, then it ships in an OS build.`;
      return out;
    }
    if (carrier) {
      // your next update doesn't carry it yet → you get it when build `carrier`+ reaches you
      const t0Days = daysBetween(today, carrier.t0) + regionDelta(car);
      const out = mcPredict({ t0Days, k: carrier.k || 0.33, L: 0.95, earliness: car.earlinessPercentile, today, seedStr: "FSDcar" + f.next + car.market + car.earlinessPercentile });
      out._t0Days = t0Days; out._k = carrier.k || 0.33;
      out.targetLabel = f.next; out.current = f.current; out.mode = f.mode; out.branch = "fsd"; out.bundledWith = carrier.version;
      out.note = `${f.next} ships in OS build ${carrier.version}+, newer than your next expected update — you'll get FSD ${f.next} when that build reaches you.`;
      return out;
    }
    // no carrier known (rare) → fall back to the region's FSD timeline
    const t0Days = f.t0 ? daysBetween(today, f.t0) : 30;
    const out = mcPredict({ t0Days, k: f.k || 0.1, L: 0.9, earliness: car.earlinessPercentile, t0Sigma: f.t0Sigma || 12, today, seedStr: "FSDfb" + car.market });
    out._t0Days = t0Days; out._k = f.k || 0.1;
    out.targetLabel = f.next; out.current = f.current; out.mode = f.mode; out.branch = "fsd";
    out.note = `${f.next} rollout for ${car.market} (estimated).`;
    return out;
  }

  function shortFsd(d) { return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" }); }

  // ---- guess scoring ----
  function scoreGuess(prediction, guessDateStr, today) {
    const g = daysBetween(today, guessDateStr), N = prediction.samples.length;
    const within3 = prediction.samples.filter(s => Math.abs(s - g) <= 3).length / N;
    const cdf = prediction.samples.filter(s => s <= g).length / N;
    const offsetDays = Math.round(g - prediction.median);
    const spread = Math.max(2, (prediction.p90 - prediction.p10) / 2);
    const score = Math.round(100 * Math.exp(-0.5 * Math.pow((g - prediction.median) / spread, 2)));
    return { within3, cdf, offsetDays, score, guessDays: g };
  }

  return { predictNextOS, predictNextFSD, scoreGuess, osCadence, adoption, addDays, isoDay, fmtDate, daysBetween, toDate };
})();
