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
    // Branch cadence is genuinely variable; a tiny small-sample sd makes the projected "next
    // update" window absurdly overconfident (the historical back-test flagged this). Floor sigma
    // at ~30% of the mean gap so the 80% window honestly reflects cadence variance.
    return { mean, sd: Math.max(sd, mean * 0.3, 5) };
  }

  // the FSD version a car is actually on now (its own reading, else the region's typical current)
  function curFsd(car, region) {
    const v = car.fsdVersion;
    if (v && !/^(none|—|-|)$/i.test(String(v).trim())) return v;
    return (region && region.fsd && region.fsd[car.hardware]) ? region.fsd[car.hardware].current : null;
  }

  // ---- NEXT OS UPDATE ----
  function predictNextOS(car, today) {
    const region = WEN.regions[car.market] || { osLagDays: AU_LAG };
    const delta = region.osLagDays - AU_LAG;
    const myKey = WEN.verKey(car.installedVersion);

    // newest distributed version strictly newer than yours — restricted to builds your REGION
    // actually receives (the US/Canada get builds AU/NZ/EU never will, so "next" differs by market)
    const newer = WEN.versions.filter(v => WEN.verKey(v.version) > myKey &&
      (v.status === "rolling" || v.status === "tapering" || v.status === "mature") &&
      (WEN.inRegion ? WEN.inRegion(v, car.market) : true))
      .sort((a, b) => WEN.verKey(b.version) - WEN.verKey(a.version));

    if (newer.length) {
      const v = newer[0];
      let t0Days = daysBetween(today, v.t0) + delta;
      let earliness = car.earlinessPercentile, t0Sigma;
      // STALENESS GUARD: a car many WEEKS behind the newest build it could get is a demonstrated
      // laggard (usually offline or holding updates) — the active-fleet rollout curve doesn't
      // describe it, so don't claim it leaps to the newest build at the rollout midpoint. Push it
      // into the late tail, delay the midpoint, and widen the window to an honest range. Only when
      // we have no measured earliness (real history/manual override always wins).
      const pc = WEN.parseOS(car.installedVersion), pn = WEN.parseOS(v.version);
      const weeksBehind = (pc && pn) ? Math.max(0, (pn.year * 52 + pn.week) - (pc.year * 52 + pc.week)) : 0;
      const noHistory = car.earlinessSource == null || car.earlinessSource === "default";
      const stale = noHistory && weeksBehind >= 9;   // ~2+ branches behind
      // regions that simply receive OS builds slowly + infrequently (RHD / EU — high osLag). For
      // these, being many weeks behind is the NORM Tesla creates, not evidence the owner's car is
      // doing anything wrong. We frame the lag honestly by cause rather than blaming the car.
      const slowRegion = (region.osLagDays || 0) >= 9;
      if (stale) {
        // a car this far back lands on no predictable cadence — push the midpoint well out and
        // widen hard. We are NOT confident it lands soon.
        earliness = Math.min(0.95, Math.max(earliness, weeksBehind >= 15 ? 0.9 : 0.82));
        t0Days += Math.min(120, Math.round(weeksBehind * 2.5));
        t0Sigma = Math.max(21, Math.min(70, Math.round(weeksBehind * 1.8)));
      }
      const out = mcPredict({ t0Days, k: v.k, L: 0.95, earliness, t0Sigma, today, seedStr: "OS" + v.version + car.market + earliness + (stale ? "s" : "") });
      out.targetLabel = v.version; out.kind = stale ? "stale" : "distributed"; out.branch = "os"; out._t0Days = t0Days; out._k = v.k;
      out.stale = stale; out.weeksBehind = weeksBehind;
      // FSD ships INSIDE this OS build. Surface whether this particular software update actually
      // changes your FSD version, or is a maintenance build that leaves FSD untouched.
      out.fsdCurrent = curFsd(car, region);
      out.fsdInBuild = (v.fsdBuild && v.fsdBuild[car.hardware]) || null;
      out.bringsNewFsd = !!(out.fsdInBuild && out.fsdInBuild !== "—" && WEN.fsdKey(out.fsdInBuild) > WEN.fsdKey(out.fsdCurrent));
      out.note = stale
        ? (slowRegion
            ? `This is the OS software update — separate from FSD (see below). ${car.market} gets far fewer OS builds than the US/Canada, and they arrive late and on no set schedule, so a car in ${car.market} sitting ~${weeksBehind} weeks behind the newest build it's even eligible for is closer to normal than alarming — it usually reflects how sparsely Tesla ships here, not anything wrong with your car. When the next one does land it may jump you straight to ${v.version}. Because there's no predictable cadence to fit, this is a wide, low-confidence guess — not a date to bank on.`
            : `This is the OS software update — separate from FSD (see below). Your ${car.installedVersion} is ~${weeksBehind} weeks behind, having skipped the builds since. That usually means the car hasn't been pulling updates (parked offline, sitting on an old branch, or set to decline them). If it starts updating again it could jump to ${v.version} fairly quickly; until then there's no reliable cadence to fit, so this is a wide, low-confidence guess — not a date to bank on.`)
        : `Newest build above yours that's actively rolling. Midpoint ~${fmtDate(addDays(today, t0Days)).replace(/^\w+, /, "")}.`;
      return out;
    }

    // you're already current → project the NEXT branch from release cadence
    const cad = osCadence();
    const lastBranchDate = WEN.versions.map(v => v.firstSeen).sort().slice(-1)[0];
    const sinceLast = daysBetween(lastBranchDate, today);
    const t0Days = Math.max(2, cad.mean - sinceLast) + delta + 6; // midpoint a touch after first appearance
    const p = WEN.parseOS(WEN.versions[0].version);
    const projWeek = (p.week + Math.round(cad.mean / 7)) % 52 || p.week + 3;
    // self-calibrating window: widen/narrow the cadence spread by the empirical band factor the
    // back-test derived from real history (defaults to 1 until there's enough history).
    const bandF = Math.min(2.5, Math.max(0.6, +WEN.cadenceBandFactor || 1));
    const out = mcPredict({ t0Days, k: 0.33, L: 0.95, earliness: car.earlinessPercentile, t0Sigma: cad.sd * bandF, today, seedStr: "OSproj" + car.market + car.earlinessPercentile });
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
      if (WEN.inRegion && !WEN.inRegion(v, car.market)) return false; // a region can only get FSD via a build it actually receives
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
    // 'promised' — promised but never delivered, with NO committed timeline. We refuse to invent a
    // date (the whole point of the site). Return an honest no-ETA result the UI renders as such.
    if (f.mode === "promised") return {
      promised: true, current: f.current, targetLabel: f.next, mode: "promised", branch: "fsd",
      note: f.note || `${f.next} has been promised for ${car.hardware} in ${car.market} but never delivered — Tesla has given no committed timeline.`,
    };

    const nextMajor = WEN.fsdMajor(f.next);
    const cur = curFsd(car, region);          // the FSD version this car is on now
    const curKey = WEN.fsdKey(cur);

    // 'gated' — regulators haven't cleared the next FSD for this region. Builds may technically
    // carry the package, but you can't legally receive it yet → a modelled regulatory window.
    if (f.mode === "gated") {
      const out = mcPredict({ approval: f.approval, k: f.k, L: 0.9, earliness: car.earlinessPercentile, today, seedStr: "FSDg" + f.next + car.market + car.earlinessPercentile });
      const a = out.approval;
      out.targetLabel = f.next; out.current = cur; out.mode = f.mode; out.branch = "fsd";
      out.note = `${f.next} isn't approved for ${car.market} yet. Likely regulatory window ${shortFsd(addDays(today, a.p10))}–${shortFsd(addDays(today, a.p90))}, after which it ships inside an OS build.`;
      return out;
    }

    // ── FSD rides INSIDE OS builds, but most builds keep the SAME FSD version ───────────────
    // The real question is whether the software update you're about to get actually changes your
    // FSD version. Compare your current FSD to the FSD the build carries.
    const osNext = predictNextOS(car, today);   // your next software update (newest in-region build)
    const buildFsd = osNext.fsdInBuild;
    const buildKey = (buildFsd && buildFsd !== "—") ? WEN.fsdKey(buildFsd) : null;

    // (1) your next software update carries a NEWER FSD → they arrive together, same build, same day.
    if (osNext.kind !== "projected" && buildKey != null && buildKey > curKey) {
      const carrierLabel = osNext.targetLabel;            // the OS build that carries the new FSD
      osNext.bundledWith = carrierLabel;                  // (set before we relabel to the FSD version)
      osNext.targetLabel = buildFsd; osNext.current = cur; osNext.mode = "bundled"; osNext.branch = "fsd";
      osNext.fsdChanges = true;
      osNext.note = `Good news — your next software update (${carrierLabel}) actually changes your FSD: it carries FSD ${buildFsd} (up from ${cur}). FSD ships inside the OS build, so the two arrive on the same day.`;
      return osNext;
    }

    // (2) the region has a newer FSD modelled that no in-region build carries yet (e.g. US 'v14 Lite'
    //     for HW3, or a forthcoming major). It'll land in a FUTURE build — separately from, and
    //     usually later than, your next maintenance update.
    const configHasNewer = nextMajor != null && nextMajor > (WEN.fsdMajor(cur) || 0) && (f.t0 || f.mode === "rolling" || f.mode === "early" || f.mode === "current");
    if (configHasNewer) {
      const carrier = carrierBuild(car, nextMajor);
      if (carrier) {
        const t0Days = daysBetween(today, carrier.t0) + regionDelta(car);
        const out = mcPredict({ t0Days, k: carrier.k || 0.33, L: 0.95, earliness: car.earlinessPercentile, today, seedStr: "FSDcar" + f.next + car.market + car.earlinessPercentile });
        out._t0Days = t0Days; out._k = carrier.k || 0.33;
        out.targetLabel = f.next; out.current = cur; out.mode = f.mode; out.branch = "fsd"; out.laterBuild = carrier.version; out.fsdChanges = true;
        out.note = `${f.next} ships inside OS build ${carrier.version}+, newer than your next maintenance update — you'll get it when that build reaches you (a separate, later software update).`;
        return out;
      }
      const t0Days = f.t0 ? daysBetween(today, f.t0) : 30;
      const out = mcPredict({ t0Days, k: f.k || 0.1, L: 0.9, earliness: car.earlinessPercentile, t0Sigma: f.t0Sigma || 14, today, seedStr: "FSDfb" + car.market });
      out._t0Days = t0Days; out._k = f.k || 0.1;
      out.targetLabel = f.next; out.current = cur; out.mode = f.mode; out.branch = "fsd"; out.fsdChanges = true;
      out.note = `${f.next} for ${car.hardware} in ${car.market} is expected around this window. It arrives inside a future OS build — not necessarily your very next one.`;
      return out;
    }

    // (3) 'current' — you're already on the newest FSD; project the next point from FSD cadence.
    if (f.mode === "current") {
      const cad = f.cadenceDays || 35, t0Days = cad;
      const out = mcPredict({ t0Days, k: f.k || 0.15, L: 0.9, earliness: car.earlinessPercentile, t0Sigma: cad * 0.45, today, seedStr: "FSDc" + car.market + car.earlinessPercentile });
      out._t0Days = t0Days; out._k = f.k || 0.15;
      out.targetLabel = f.next; out.current = cur; out.mode = f.mode; out.branch = "fsd";
      out.note = `You're on the newest FSD (${cur}). Projected next point release (${f.next}) from the ~${cad}-day FSD cadence — it'll ship inside a future OS build.`;
      return out;
    }

    // (4) nothing newer anywhere in the pipeline → your upcoming software update(s) keep FSD as-is.
    return {
      sameFsd: true, current: cur, targetLabel: null, mode: "same", branch: "fsd",
      bundledWith: osNext.kind !== "projected" ? osNext.targetLabel : null,
      note: `Your next software update${osNext.kind !== "projected" ? ` (${osNext.targetLabel})` : ""} keeps FSD ${cur} — it's a maintenance build with no FSD change. A newer FSD will arrive in a future build Tesla hasn't shipped yet.`,
    };
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
