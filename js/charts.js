/* wenFSD — dependency-free SVG charts */
const Charts = (function () {
  const NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* Rollout S-curve: fleet adoption % vs day, with confidence band + your-position marker.
   * pred = output of Predict.* ; today ISO string. */
  function rolloutCurve(container, pred, today) {
    clear(container);
    const W = container.clientWidth || 680, H = 300;
    const m = { l: 44, r: 16, t: 18, b: 34 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart", role: "img",
      "aria-label": `Rollout S-curve: most likely arrival in about ${Math.max(0, pred.daysToMedian)} days, with an 80% window.` });

    const horizon = pred.horizon;
    const x = d => m.l + (d / horizon) * iw;
    const y = pct => m.t + ih - (pct / 100) * ih;

    // grid + y labels
    for (let p = 0; p <= 100; p += 25) {
      svg.appendChild(el("line", { x1: m.l, y1: y(p), x2: m.l + iw, y2: y(p), class: "grid" }));
      const t = el("text", { x: m.l - 8, y: y(p) + 4, class: "axis", "text-anchor": "end" });
      t.textContent = p + "%"; svg.appendChild(t);
    }
    // x labels (dates)
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const d = Math.round((horizon / ticks) * i);
      const t = el("text", { x: x(d), y: H - 10, class: "axis", "text-anchor": "middle" });
      t.textContent = new Date(Predict.addDays(today, d)).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
      svg.appendChild(t);
    }

    // confidence band (p10..p90 window shaded vertically)
    const bandX1 = x(Math.max(0, pred.p10)), bandX2 = x(Math.min(horizon, pred.p90));
    svg.appendChild(el("rect", { x: bandX1, y: m.t, width: Math.max(1, bandX2 - bandX1), height: ih, class: "band" }));

    // adoption curve
    if (pred.curve && pred.curve.length) {
      let dPath = "", aPath = `M ${x(0)} ${y(0)} `;
      pred.curve.forEach((pt, i) => {
        const X = x(pt.day), Y = y(pt.pct);
        dPath += (i === 0 ? "M" : "L") + X + " " + Y + " ";
        aPath += "L" + X + " " + Y + " ";
      });
      aPath += `L ${x(horizon)} ${y(0)} Z`;
      svg.appendChild(el("path", { d: aPath, class: "area" }));
      svg.appendChild(el("path", { d: dPath, class: "curveline" }));
    }

    // your predicted position (median) marker
    const myDay = Math.max(0, Math.min(horizon, pred.median));
    const myPct = Predict.adoption(myDay - (pred.curve.length ? curveT0(pred) : 0), 0, 0); // not used
    svg.appendChild(el("line", { x1: x(myDay), y1: m.t, x2: x(myDay), y2: m.t + ih, class: "marker" }));
    const dot = el("circle", { cx: x(myDay), cy: y(estPctAt(pred, myDay)), r: 6, class: "markerdot" });
    svg.appendChild(dot);
    const lbl = el("text", { x: x(myDay), y: m.t - 4, class: "markerlbl", "text-anchor": "middle" });
    lbl.textContent = "you";
    svg.appendChild(lbl);

    container.appendChild(svg);
  }
  function curveT0(pred) { return 0; }
  function estPctAt(pred, day) {
    if (!pred.curve || !pred.curve.length) return 50;
    const c = pred.curve[Math.min(pred.curve.length - 1, Math.max(0, Math.round(day)))];
    return c ? c.pct : 50;
  }

  /* Probability histogram: P(your car updates on day d). Highlights guess + median. */
  function distribution(container, pred, today, guessDays) {
    clear(container);
    const W = container.clientWidth || 680, H = 220;
    const m = { l: 40, r: 12, t: 14, b: 30 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, class: "chart", role: "img",
      "aria-label": "Probability distribution of which day your car receives the update." });

    const lo = Math.max(0, Math.floor(pred.p10) - 2);
    const hi = Math.ceil(pred.p90) + 2;
    const span = Math.max(1, hi - lo);
    // bin into ~ up to 60 bars
    const binSize = Math.max(1, Math.round(span / 60));
    const bins = {};
    let maxV = 0;
    for (const k in pred.pmf) {
      const d = +k; if (d < lo || d > hi) continue;
      const b = Math.floor((d - lo) / binSize);
      bins[b] = (bins[b] || 0) + pred.pmf[k];
    }
    for (const b in bins) maxV = Math.max(maxV, bins[b]);
    const nBins = Math.ceil(span / binSize);
    const bw = iw / nBins;
    const x = b => m.l + b * bw;
    const y = v => m.t + ih - (v / (maxV || 1)) * ih;

    for (let b = 0; b < nBins; b++) {
      const v = bins[b] || 0;
      const dayCenter = lo + b * binSize + binSize / 2;
      const isGuess = guessDays != null && Math.abs(dayCenter - guessDays) <= binSize / 2;
      const isMedian = Math.abs(dayCenter - pred.median) <= binSize / 2;
      svg.appendChild(el("rect", {
        x: x(b) + 0.5, y: y(v), width: Math.max(1, bw - 1), height: m.t + ih - y(v),
        class: "bar" + (isGuess ? " bar-guess" : isMedian ? " bar-median" : ""),
      }));
    }
    // ALWAYS-visible marker lines so BOTH legend items show — even when your guess lands on
    // the model's median day (previously the blue guess bar hid the red median entirely).
    const vline = (dayVal, cls) => {
      if (dayVal == null) return;
      const dv = Math.max(lo, Math.min(hi, dayVal));
      const px = m.l + ((dv - lo) / span) * iw;
      svg.appendChild(el("line", { x1: px, y1: m.t, x2: px, y2: m.t + ih, class: cls }));
      svg.appendChild(el("polygon", { points: `${px - 4},${m.t} ${px + 4},${m.t} ${px},${m.t + 6}`, class: cls + "-tip" }));
    };
    vline(pred.median, "mk-median");                      // 🔴 model's best guess
    if (guessDays != null) vline(guessDays, "mk-guess");  // 🔵 your guess
    // x labels
    for (let i = 0; i <= 4; i++) {
      const d = Math.round(lo + (span / 4) * i);
      const t = el("text", { x: m.l + (iw / 4) * i, y: H - 9, class: "axis", "text-anchor": "middle" });
      t.textContent = new Date(Predict.addDays(today, d)).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
      svg.appendChild(t);
    }
    container.appendChild(svg);
  }

  return { rolloutCurve, distribution };
})();
