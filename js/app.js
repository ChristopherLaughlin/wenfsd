/* wenFSD — app wiring (garage-driven) */
(function () {
  const $ = (id) => document.getElementById(id);
  const today = WEN.today;

  let gstate = Garage.get();           // { vehicles, activeId }
  const ui = { target: "standard", guessDays: null, addingHistory: false, exploreRegion: null, guessRisk: "bold" };

  function av() { return Garage.active(gstate); }

  // effective rollout percentile = base, shifted earlier if you're in the Early Access Program.
  // If earliness came from real logged history it already reflects that — don't double-count.
  function effEarliness(v) {
    let e = v.earliness;
    if (v.earlinessSource !== "history" && v.earlyAccess) e += WEN.earlyAccessShift;
    if (v.earlinessSource !== "history" && v.newCar) e -= 0.12; // recent deliveries trend earlier in the queue
    return Math.min(0.97, Math.max(0.03, e));
  }

  // map active garage vehicle -> shape the predictor expects
  function car() {
    const v = av();
    return {
      model: v.model, year: v.year, hardware: v.hardware,
      market: v.market, drive: v.drive,
      earlinessPercentile: effEarliness(v), installedVersion: v.installedVersion,
      fsdVersion: v.fsdVersion, earlyAccess: v.earlyAccess, newCar: !!v.newCar,
    };
  }

  // the headline prediction is always your NEXT UPDATE (the OS build) — FSD rides inside it,
  // and the FSD story is folded into the hero via renderFsdSummary (no confusing toggle).
  function currentPrediction() { return Predict.predictNextOS(car(), today); }

  // ---------------- render ----------------
  // unified FSD line: is the next FSD version bundled into your next update, later, or capped?
  function renderFsdSummary(osPred) {
    const el = $("fsdSummary"); if (!el) return;
    const v = av(); if (!v) { el.innerHTML = ""; return; }
    let fsd; try { fsd = Predict.predictNextFSD(car(), today); } catch (e) { el.innerHTML = ""; return; }
    if (!fsd || fsd.unavailable) { el.innerHTML = ""; return; }
    if (fsd.capped) { el.innerHTML = `<div class="fsum fsum-capped">🪚 <strong>FSD:</strong> ${esc(fsd.current || "your version")} is the end of the line for your ${esc(v.hardware)} hardware — Tesla caps it here.</div>`; return; }
    const bundled = fsd.bundledWith && osPred && (fsd.bundledWith === osPred.targetLabel || +new Date(fsd.medianDate) === +new Date(osPred.medianDate));
    if (bundled) {
      el.innerHTML = `<div class="fsum fsum-yay">🎉 <strong>This update brings FSD ${esc(fsd.targetLabel)}.</strong> It's bundled inside ${esc(osPred.targetLabel)} — your next software update <em>is</em> your next FSD version. One drop, one date.</div>`;
    } else if (fsd.mode === "current") {
      el.innerHTML = `<div class="fsum">🧭 You're on the newest FSD (<strong>${esc(fsd.current)}</strong>). Next point release (${esc(fsd.targetLabel)}) projected around <strong>${shortDate(fsd.medianDate)}</strong>.</div>`;
    } else {
      el.innerHTML = `<div class="fsum">🎯 Your <strong>FSD ${esc(fsd.targetLabel)}</strong> jump lands a little later than this update — around <strong>${shortDate(fsd.medianDate)}</strong> (it ships in a newer build than your next one).</div>`;
    }
  }

  function render() {
    const a0 = av();
    setTopConnect(!!(a0 && a0.connected), !!(a0 && a0.connected && a0.optedIn));
    if (!av()) { renderEmptyState(); return; }
    const pred = currentPrediction();
    $("curveVer").textContent = pred.targetLabel || "OS";

    if (pred.capped || pred.unavailable) { renderNoPrediction(pred); return pred; }

    renderHero(pred);
    renderYouBar(pred);
    Charts.rolloutCurve($("curveChart"), pred, today);
    Charts.distribution($("distChart"), pred, today, ui.guessDays);
    renderGuess(pred);
    renderTable();
    renderRegions();
    renderReleaseNotes();
    return pred;
  }

  function renderEmptyState() {
    $("curveVer").textContent = "";
    $("heroEyebrow").textContent = "Welcome to wenFSD";
    $("heroDate").textContent = "wen FSD? Let's find out.";
    $("heroWindow").textContent = "";
    $("ringDays").textContent = "—"; $("ringFg").style.strokeDashoffset = 2 * Math.PI * 78;
    $("confRow").innerHTML = "";
    if ($("heroFlavor")) $("heroFlavor").innerHTML = flavorPick("empty", [
      `😤 You've asked "wen FSD" one too many times. We built you a calculator. Add your Tesla.`,
      `🔮 Step right up. Add your Tesla and we'll tell you "two weeks" — but with actual math.`,
      `🚗 Add your car. Yes, the whole VIN. No, we won't sell it to anyone. (We can't even afford to.)`,
      `📡 Your Tesla is out there, asking "wen FSD" into the void. Connect it and let's get answers.`,
      `🍿 Add a vehicle and find out if you're "first wave" or "suffering in silence on {nope}".`.replace("{nope}", "an ancient build"),
    ]);
    $("heroNote").innerHTML = "Add your car by VIN (we'll decode the model, year &amp; hardware) and wenFSD predicts your next software update and next FSD version — with confidence bands. No vehicles are tracked until you add one. <em>(The answer is always two weeks. But these two weeks are data-driven.)</em>";
    $("predictTips").innerHTML = "";
    $("curveChart").innerHTML = svgEmpty("Add a vehicle to see its rollout curve");
    $("distChart").innerHTML = svgEmpty("Add a vehicle to see the probability distribution");
    $("guessResult").classList.remove("show"); $("guessResult").innerHTML = "";
    renderTable();
    renderRegions();
    renderReleaseNotes();
  }
  function svgEmpty(msg) {
    return `<div class="chart-empty">${esc(msg)}</div>`;
  }

  function renderNoPrediction(pred) {
    $("heroEyebrow").textContent = (ui.target === "fsd" ? "Next FSD version" : "Next update") + " for " + (av().nickname || "your car");
    $("heroDate").textContent = pred.capped ? "Not coming" : "Unknown";
    $("heroWindow").textContent = pred.capped ? "hardware-limited" : "";
    $("ringDays").textContent = pred.capped ? "—" : "?"; $("ringFg").style.strokeDashoffset = 2 * Math.PI * 78;
    $("confRow").innerHTML = "";
    if ($("heroFlavor")) $("heroFlavor").innerHTML = pred.capped ? `🪦 Your hardware tapped out. F in the chat.` : "";
    $("heroNote").innerHTML = `Currently on <strong>${esc(pred.current || "—")}</strong>. ${esc(pred.note || "")}`;
    $("predictTips").innerHTML = "";
    $("distChart").innerHTML = ""; $("curveChart").innerHTML = "";
    $("guessResult").classList.remove("show"); $("guessResult").innerHTML = "";
    renderTable();
    renderRegions();
    renderReleaseNotes();
  }

  // ---- regional humour (the wenFSD meme = "wen FSD? two weeks, trust me bro") ----
  // Picks are RANDOM but cached per page-load → stable while you click around, fresh on refresh.
  const _flavorCache = {};
  function flavorPick(key, arr) {
    if (!arr || !arr.length) return "";
    if (!(key in _flavorCache)) _flavorCache[key] = arr[Math.floor(Math.random() * arr.length)];
    return _flavorCache[key];
  }
  function rnd(arr) { return arr[Math.floor(Math.random() * arr.length)]; } // fresh every call (transient msgs)
  const MEME = ["Two weeks. Trust me bro. 🙏", "It's basically already on the truck.", "Source: a guy on the forums.", "Definitely this OTA. Probably. Maybe.", "Patience, you magnificent early-adopter."];
  const REGION_FLAVOR = {
    "Australia": { flag: "🇦🇺",
      soon: ["Two weeks. Trust me, mate. 🦘", "She'll be right — a fortnight, tops.", "Basically here. Crack a tinnie. 🍺", "Soon-ish, bruz. Trust."],
      quips: ["Strewth — still on {ver}? She'll be right.", "Your car's more behind than a tradie on a Friday arvo.", "No dramas, wen FSD is basically here. *distant kangaroo noises*", "Still on {ver}? Yeah-nah, the update's comin', mate.", "Hooroo to {ver} — eventually.", "Tell 'em they're dreamin'… then check again tomorrow.", "Carn, Tesla. We're not getting any younger down here.", "It's coming faster than a magpie in September. 🐦"] },
    "New Zealand": { flag: "🇳🇿",
      soon: ["Two weeks. Trust me, bro. 🥝", "Sweet as, basically rolling out.", "Yeah-nah-yeah, real soon.", "Chur, won't be long now."],
      quips: ["Still on {ver}? Sweet as, it's coming.", "Yeah nah yeah, it's basically rolling out, bro.", "Chur — won't be long now, eh.", "Still on {ver}? Hard. Hang in there, bro.", "She's a good keen update. Coming. Promise.", "Choice. Now we wait. Choice."] },
    "United States": { flag: "🇺🇸",
      soon: ["Two weeks. Trust me bro. 🦅", "It's coming. Probably this OTA. 🫡", "Soon™. Very soon™.", "Faster than you can say 'supervised'."],
      quips: ["Still on {ver}? That's downright un-American. 🦅", "Freedom units of patience required.", "Refresh harder. That always works.", "Still on {ver}? Elon tweeted, so… any minute now.", "It's coming faster than you can say 'Full Self-Driving (Supervised, terms apply)'.", "Manifest the update. Believe.", "Your neighbor has it. Of course they do."] },
    "Canada": { flag: "🇨🇦",
      soon: ["Two weeks. Trust me, bud. 🍁", "It'll be here before the next Tims run. ☕", "For sure for sure, soon.", "Give'r — almost there."],
      quips: ["Still on {ver}, eh? Sorry aboot that.", "Patience, bud — it's coming, for sure for sure.", "It'll be here before the next double-double. ☕", "Still on {ver}? Beauty. Hang tight, bud.", "Take off, {ver}. Eventually, eh.", "It's coming, dontcha know."] },
    "Europe": { flag: "🇪🇺",
      soon: ["Two weeks*. (*pending homologation) 📋", "Soon — once 17 agencies sign off. 🇪🇺", "Approval imminent. Allegedly.", "Bald. (That's 'soon' in German. Cope.)"],
      quips: ["Still on {ver}? Blame the regulators. 📋", "Approval pending since approximately forever.", "It's coming — after a public consultation period.", "Still on {ver}? The paperwork is, how you say, in progress.", "Coming soon to a TÜV-approved vehicle near you.", "GDPR-compliant patience required."] },
  };
  function flavorFor(market) { return REGION_FLAVOR[market] || REGION_FLAVOR["United States"]; }
  function heroFlavorLine(pred) {
    const v = av(); if (!v) return "";
    const fl = flavorFor(v.market), d = pred.daysToMedian;
    if (d != null && d >= 8 && d <= 18) return `${fl.flag} ${flavorPick("soon:" + v.market, fl.soon.concat(MEME))}`;   // the meme zone
    const q = flavorPick("quip:" + v.market, fl.quips).replace("{ver}", esc(v.installedVersion || "your build"));
    return `${fl.flag} ${q}`;
  }

  function renderHero(pred) {
    $("heroFlavor").innerHTML = heroFlavorLine(pred);
    $("heroEyebrow").textContent = `Your next update${pred.targetLabel ? " — " + pred.targetLabel : ""} on ${av().nickname || "your car"}`;
    $("heroDate").textContent = Predict.fmtDate(pred.medianDate);
    $("heroWindow").textContent = "80% window: " + shortDate(pred.p10Date) + " → " + shortDate(pred.p90Date);
    renderFsdSummary(pred);

    const ring = $("ringFg"), C = 2 * Math.PI * 78, d = pred.daysToMedian;
    const frac = Math.max(0.04, Math.min(1, 1 - Math.min(d, 120) / 120));
    ring.style.strokeDasharray = C; ring.style.strokeDashoffset = C * (1 - frac);
    $("ringDays").textContent = d <= 0 ? "now" : d;

    const w7 = Math.round(pred.probWithin(7) * 100), w14 = Math.round(pred.probWithin(14) * 100), w30 = Math.round(pred.probWithin(30) * 100);
    $("confRow").innerHTML = [chip("7 days", w7), chip("14 days", w14), chip("30 days", w30)].join("");
    $("heroNote").innerHTML = `${esc(pred.note || "")} <span class="mut-i">Placed by your <strong>${pctLabel(effEarliness(av()))}</strong> rollout position${av().earlyAccess ? " (incl. Early Access)" : ""}.</span>`;
    renderBasis(pred);
    renderTips(pred);
  }

  // persistent NOW → NEXT context (region-aware) so the progression is always obvious
  function renderYouBar(pred) {
    const el = $("youBar"); if (!el) return;
    const v = av();
    if (!v || !pred || pred.capped || pred.unavailable) { el.hidden = true; return; }
    el.hidden = false;
    const isFSD = ui.target === "fsd";
    const now = pred.current || v.installedVersion || "—";
    const next = pred.targetLabel || "next";
    const eta = pred.daysToMedian != null ? `~${Math.max(0, pred.daysToMedian)}d` : "";
    el.innerHTML =
      `<span class="yb-region">📍 ${esc(v.market)}</span>` +
      `<span class="yb-seg"><span class="yb-lbl">NOW</span><strong class="yb-ver" data-goto-version="${esc(now)}" role="button" tabindex="0">${esc(now)}</strong></span>` +
      `<span class="yb-arrow">→</span>` +
      `<span class="yb-seg"><span class="yb-lbl yb-next-lbl">NEXT${isFSD ? " FSD" : ""}</span><strong class="yb-ver yb-next" data-goto-version="${esc(next)}" role="button" tabindex="0">${esc(next)}</strong>${eta ? `<span class="yb-eta">${eta}</span>` : ""}</strong></span>`;
  }

  // plain-language breakdown of HOW the date was computed + what it's based on
  function renderBasis(pred) {
    const v = av(), isFSD = ui.target === "fsd";
    const pct = pctLabel(effEarliness(v));
    const k = pred._k != null ? pred._k : 0.33;
    const mid = pred._t0Days != null ? Predict.fmtDate(Predict.addDays(today, pred._t0Days)) : null;

    let anchor;
    if (pred.mode === "gated") {
      anchor = `<strong>${esc(v.market)}</strong> isn't approved for <strong>${esc(pred.targetLabel)}</strong> yet, so the date is a <em>modelled regulatory window</em> — the least certain kind of estimate.`;
    } else if (mid) {
      anchor = `the model centres <strong>${esc(pred.targetLabel)}</strong>'s rollout around <strong>${mid}</strong> (curve steepness k≈${k}). Your rollout position then shifts you earlier or later than that midpoint.`;
    } else {
      anchor = `projected from Tesla's measured release cadence between builds.`;
    }

    $("predBasisBody").innerHTML =
      `<p><strong>What:</strong> when <strong>${esc(pred.targetLabel || (isFSD ? "the next FSD version" : "the next update"))}</strong> reaches <strong>${esc(v.nickname || "your car")}</strong>${pred.current ? ` (currently on ${esc(pred.current)})` : ""}.</p>` +
      `<ol class="basis-steps">` +
        `<li><strong>Your position:</strong> we place your car at its <strong>${pct}</strong> rollout position${v.earlyAccess ? " (incl. Early Access)" : ""} — where your car has historically landed within each update wave.</li>` +
        (pred.bundledWith ? `<li><strong>Bundled:</strong> FSD ships <em>inside</em> OS build <strong>${esc(pred.bundledWith)}</strong>, so your next FSD version and your next software update arrive <strong>together</strong> — not on separate schedules.</li>` : "") +
        `<li><strong>The model:</strong> Tesla pushes each version as an S-curve across the fleet. We fit a logistic curve and read off your spot, then run Monte-Carlo for the 80% window.</li>` +
        `<li><strong>The timing anchor:</strong> ${anchor}</li>` +
      `</ol>` +
      `<p class="basis-conf">Confidence: <strong>${esc(confLabel(v))}</strong>.</p>` +
      `<p class="basis-warn">⚠️ Bands are <strong>modelled</strong> (logistic rollout + Monte-Carlo), not yet empirically back-tested against real per-car timing — treat as estimates. The anchor dates (the FSD one especially) are educated estimates, not a Tesla commitment.</p>`;
  }
  function confLabel(v) {
    return v.earlinessSource === "history" ? "higher — from your real update history"
      : v.earlyAccess ? "lower — typical-owner prior + your Early Access setting" : "lower — typical-owner prior";
  }

  // ONE actionable insight — the Early-Access delta (computed, not a generic CTA). The
  // generic "log history"/"connect Tesla" prompts live in the garage, so we don't repeat them.
  function renderTips(pred) {
    const v = av();
    let tip = "";
    if (!v.earlyAccess && v.earlinessSource !== "history") {
      const c2 = Object.assign(car(), { earlinessPercentile: effEarliness(Object.assign({}, v, { earlyAccess: true })) });
      const p2 = ui.target === "fsd" ? Predict.predictNextFSD(c2, today) : Predict.predictNextOS(c2, today);
      const delta = Math.round(pred.daysToMedian - (p2.daysToMedian != null ? p2.daysToMedian : pred.daysToMedian));
      if (delta >= 1) tip = `<div class="tips-list"><div class="tip">🔓 <strong>Tesla's Early Access Program</strong> would get this about <strong>${delta} day${delta > 1 ? "s" : ""} sooner</strong>. Too bad you aren't some sort of Tesla "influencer" filming yourself sitting in your car all day. 🎥</div></div>`;
    }
    $("predictTips").innerHTML = tip;
  }

  function chip(label, pct) {
    const cls = pct >= 66 ? "hi" : pct >= 33 ? "mid" : "lo";
    return `<div class="chip ${cls}"><div class="chip-pct">${pct}%</div><div class="chip-lbl">within ${label}</div></div>`;
  }

  // Kick off the Tesla OAuth link flow (works when served by the backend).
  function connectTesla() {
    if (/^https?:$/.test(location.protocol)) {
      window.location.href = "/auth/login";
    } else {
      alert("Connect Tesla works on the live site (wenfsd.info). In this offline preview, use 'Add by VIN' instead.");
    }
  }
  // persist a setting on a CONNECTED car to the server (so it survives reloads / devices).
  // Local-only cars and the file:// preview just update localStorage.
  function persistConnected(v, patch) {
    if (!v || !v.connected || !v.vin || !/^https?:$/.test(location.protocol)) return;
    fetch(`/api/me/vehicle/${encodeURIComponent(v.vin)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify(patch),
    }).catch(() => {});
  }
  // owner-triggered: wake the car and read its live software version (updates prediction).
  function refreshFromCar(v) {
    if (!/^https?:$/.test(location.protocol)) { alert("Waking your car works on the live site (wenfsd.info)."); return; }
    if (!v || !v.vin) return;
    const rb = $("refreshCarBtn"), rs = $("refreshStatus");
    if (rb) rb.disabled = true;
    if (rs) { rs.className = "refresh-status busy"; rs.textContent = "Waking your car… this can take up to ~30s"; }
    fetch(`/api/me/vehicle/${encodeURIComponent(v.vin)}/refresh`, { method: "POST", credentials: "same-origin" })
      .then(r => r.json().then(d => ({ status: r.status, d })))
      .then(({ status, d }) => {
        if (rb) rb.disabled = false;
        if (d.ok && d.version) {
          gstate = Garage.update(v.id, { installedVersion: d.version });
          if (rs) { rs.className = "refresh-status ok"; rs.textContent = `✓ Read ${d.version}${d.changed ? " — new version logged!" : " (unchanged)"}`; }
          renderActiveControls(); render();
        } else if (rs) {
          rs.className = "refresh-status err";
          rs.textContent = "⚠ " + (d.error || (status === 429 ? "Please wait a minute before trying again." : "Couldn't reach your car."));
        }
      })
      .catch(e => { if (rb) rb.disabled = false; if (rs) { rs.className = "refresh-status err"; rs.textContent = "⚠ " + (e && e.message || "request failed"); } });
  }
  function disconnectTesla() {
    if (!/^https?:$/.test(location.protocol)) return;
    fetch("/api/me", { method: "DELETE", credentials: "same-origin" }).catch(() => {}).finally(() => {
      const v = av(); if (v) gstate = Garage.update(v.id, { connected: false, optedIn: false });
      renderGarage(); renderActiveControls(); render();
    });
  }
  // reflect Tesla-connection + contribution state across the consent block + a header chip,
  // so it's always obvious whether you're linked and contributing.
  function renderConnectState(v) {
    const connected = !!(v && v.connected), contributing = connected && !!v.optedIn;
    const btn = $("connectTeslaBtn"), hint = $("connectHint"), chip = $("connChip");
    if (btn) {
      btn.classList.toggle("is-connected", connected);
      if (connected) { btn.textContent = "✓ Connected to Tesla — click to disconnect"; btn.onclick = () => { if (confirm("Disconnect your Tesla account and remove its linked data?")) disconnectTesla(); }; }
      else { btn.textContent = "🔗 Connect Tesla account — auto-track"; btn.onclick = connectTesla; }
    }
    if (hint) hint.innerHTML = connected
      ? `Your Tesla is linked <strong>read-only</strong> — wenFSD reads your software version automatically and scores a prediction when you next update. ${contributing ? "You're <strong>contributing</strong> anonymised version data to fleet stats." : "You're <strong>not</strong> contributing to fleet stats — tick the box above to help everyone's predictions."}`
      : `Linking uses Tesla's official OAuth (read-only) so wenFSD reads your software version automatically — no manual logging. You can disconnect or opt out anytime.`;
    if (chip) {
      chip.hidden = false;
      chip.className = "conn-chip " + (contributing ? "cc-on" : connected ? "cc-link" : "cc-off");
      chip.textContent = contributing ? "🔗 Connected · contributing" : connected ? "🔗 Connected" : "Not connected";
    }
    setTopConnect(connected, contributing);
    renderProfile(v);
  }
  // social profile editor (connected cars only): display name, TMC handle, public-share toggle
  let _profileLoaded = false;
  function renderProfile(v) {
    const block = $("profileBlock"); if (!block) return;
    const connected = !!(v && v.connected) && /^https?:$/.test(location.protocol);
    block.hidden = !connected;
    if (!connected) return;
    if (!_profileLoaded) {
      _profileLoaded = true;
      fetch("/api/me/profile", { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(r => r.ok ? r.json() : null).then(p => { if (!p) return; $("pf_name").value = p.displayName || ""; $("pf_tmc").value = p.tmcUsername || ""; $("pf_share").checked = !!p.publicShare; }).catch(() => {});
    }
    const save = $("pf_save"), st = $("pf_status");
    if (save) save.onclick = () => {
      if (st) { st.textContent = "Saving…"; st.className = "pf-status busy"; }
      fetch("/api/me/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ displayName: $("pf_name").value, tmcUsername: $("pf_tmc").value, publicShare: $("pf_share").checked }) })
        .then(r => r.json()).then(() => { if (st) { st.textContent = "✓ Saved"; st.className = "pf-status ok"; } renderLeaderboard(); })
        .catch(() => { if (st) { st.textContent = "⚠ couldn't save"; st.className = "pf-status err"; } });
    };
  }

  // ---- regional leaderboard ----
  function renderLeaderboard(region) {
    const body = $("leaderboardBody"); if (!body) return;
    if (!/^https?:$/.test(location.protocol)) { body.innerHTML = `<p class="lb-empty">The leaderboard runs on the live site (wenfsd.info). Not available in this offline preview.</p>`; return; }
    const reg = region || (av() ? av().market : "Australia");
    const sel = $("lbRegion");
    if (sel) { if (!sel.dataset.filled) { sel.innerHTML = Object.keys(WEN.regions).map(m => `<option>${esc(m)}</option>`).join(""); sel.dataset.filled = "1"; } sel.value = reg; sel.onchange = () => renderLeaderboard(sel.value); }
    body.innerHTML = `<p class="lb-empty">${esc(rnd(["Summoning the legends of", "Tallying bragging rights across", "Polling the group chat in", "Counting who's furthest ahead in"]))} ${esc(reg)}…</p>`;
    fetch(`/api/leaderboard?region=${encodeURIComponent(reg)}`, { headers: { Accept: "application/json" } })
      .then(r => r.json()).then(paintLeaderboard).catch(() => { body.innerHTML = `<p class="lb-empty">${esc(rnd(["Leaderboard's asleep. Like your Tesla.", "The board's having a moment — try again.", "Couldn't load it. Blame the regulators. 📋"]))}</p>`; });
  }
  function paintLeaderboard(d) {
    const body = $("leaderboardBody"); if (!body || !d) return;
    if ($("lbSub")) $("lbSub").textContent = `${d.region} · ${d.participants} sharing${d.sample ? " · sample" : ""}`;
    if (!d.participants) {
      body.innerHTML = `<p class="lb-empty">Nobody's sharing in <strong>${esc(d.region)}</strong> yet. <strong>Be the first</strong> — connect your Tesla and flip on the leaderboard toggle in Your garage. 🏆</p>`;
      return;
    }
    const nameCell = (p) => `${esc(p.name)}${p.tmc ? ` <span class="lb-tmc" title="self-claimed TMC handle (unverified)">TMC</span>` : ""}`;
    const board = (title, emoji, rows, valFn) => rows && rows.length ? `<div class="lb-board"><div class="lb-title">${emoji} ${title}</div><ol class="lb-list">${rows.map((p, i) => `<li><span class="lb-rank">${i + 1}</span><span class="lb-name">${nameCell(p)}</span><span class="lb-val">${valFn(p)}</span></li>`).join("")}</ol></div>` : "";
    body.innerHTML =
      (d.sample ? `<div class="est-badge">⚠️ Sample leaderboard (offline/dev mode). The live board shows only real drivers who opted into sharing.</div>` : "") +
      `<div class="lb-grid">` +
        board("wenPoints 🪙", "🏆", d.points, p => `${p.pts.toLocaleString()}${p.hits ? ` · ${p.hits}✓` : ""}`) +
        board("Furthest ahead", "🚀", d.ahead, p => esc(p.version)) +
        board("Earliest in line", "⚡", d.earliest, p => `${p.pct}th pct`) +
        board("Most overdue", "🐌", d.overdue, p => esc(p.version)) +
      `</div>` +
      `<p class="lb-foot">Only drivers who opted into public sharing appear here · TMC handles are self-claimed (unverified) · 🪙 wenPoints come from settled "Call your shot" wagers.</p>`;
  }

  // top-bar connection control — visible from the very top, the first thing users act on
  function setTopConnect(connected, contributing) {
    const tc = $("topConnect"); if (!tc) return;
    tc.className = "top-connect " + (contributing ? "tc-on" : connected ? "tc-link" : "tc-off");
    tc.textContent = contributing ? "✓ Connected · sharing" : connected ? "✓ Connected" : "🔗 Connect Tesla";
    tc.title = connected ? "Manage your Tesla connection in Your garage" : "Link your Tesla (read-only) to auto-track your version";
    tc.onclick = connected
      ? () => { const g = $("garageCard"); if (g) g.scrollIntoView({ behavior: "smooth", block: "start" }); }
      : connectTesla;
  }

  // ---------------- garage ----------------
  function renderGarage() {
    if (!gstate.vehicles.length) {
      $("activeControls").hidden = true;
      $("addVehicleBtn").hidden = $("addForm").hidden ? false : true;
      $("garageList").innerHTML =
        `<div class="garage-empty">` +
        `<div class="ge-icon">🚗</div>` +
        `<div class="ge-title">Add your Tesla to get a prediction</div>` +
        `<div class="ge-sub">Two ways to track — pick one:</div>` +
        `<div class="ge-options">` +
          `<div class="ge-opt"><div class="ge-opt-h">🔗 Connect Tesla account</div>` +
          `<div class="ge-opt-d">Reads your software version automatically (read-only, never sends commands). Most accurate.</div>` +
          `<button class="btn" id="geConnect" type="button">Connect Tesla account</button></div>` +
          `<div class="ge-opt"><div class="ge-opt-h">⌨️ Add by VIN</div>` +
          `<div class="ge-opt-d">No account needed — enter your VIN and current version yourself.</div>` +
          `<button class="btn-ghost" id="geAdd" type="button">Add by VIN</button></div>` +
        `</div>` +
        `<button class="btn-link" id="geDemo" type="button">or just explore with a demo car</button></div>`;
      $("geConnect").onclick = connectTesla;
      $("geAdd").onclick = () => { $("addForm").hidden = false; $("addVehicleBtn").hidden = true; resetForm(); $("garageList").innerHTML = ""; $("vinInput").focus(); };
      $("geDemo").onclick = () => { gstate = Garage.loadDemo(); ui.guessDays = null; clearGuess(); renderGarage(); renderActiveControls(); render(); };
      return;
    }
    $("activeControls").hidden = false;
    $("garageList").innerHTML = gstate.vehicles.map(v => {
      const isA = v.id === gstate.activeId;
      const verText = v.installedVersion ? "on " + esc(v.installedVersion) : "version unknown — waiting for first Tesla read";
      return `<div class="gcar ${isA ? "active" : ""}" data-id="${v.id}">` +
        `<div class="gcar-main"><div class="gcar-name">${esc(v.nickname || v.model)}${v.connected ? ' <span class="gcar-link" title="Connected to your Tesla account">🔗 connected</span>' : ''}</div>` +
        `<div class="gcar-sub">${v.year} ${esc(v.model)}${v.generation ? " " + v.generation : ""} · ${v.hardware} · ${esc(v.market)}</div>` +
        `<div class="gcar-ver">${verText}</div></div>` +
        `<button class="gcar-x" data-del="${v.id}" title="Remove this vehicle">×</button>` +
        `</div>`;
    }).join("");

    $("garageList").querySelectorAll(".gcar").forEach(node => {
      node.onclick = (e) => {
        if (e.target.dataset.del) return;
        gstate = Garage.setActive(node.dataset.id);
        ui.guessDays = null; clearGuess();
        renderActiveControls(); render();
      };
    });
    $("garageList").querySelectorAll("[data-del]").forEach(b => {
      b.onclick = (e) => { e.stopPropagation(); gstate = Garage.remove(b.dataset.del); renderActiveControls(); renderGarage(); render(); };
    });
  }

  function renderActiveControls() {
    if (!av()) { $("activeControls").hidden = true; return; }
    $("activeControls").hidden = false;
    const v = av();
    $("carBadge").textContent = v.hardware + (v.hardware === "AI4" ? " · HW4" : v.hardware === "AI3" ? " · HW3" : "");
    $("carModel").textContent = `${v.year} ${v.model}` + (v.generation ? ` · ${v.generation}` : "");
    $("carMeta").textContent = `${v.market} · ${v.drive || "—"}`;

    const ms = $("marketSel");
    ms.innerHTML = Object.keys(WEN.regionLag).map(m => `<option ${m === v.market ? "selected" : ""}>${m}</option>`).join("");
    ms.onchange = () => setMarket(ms.value);

    populateVersionOptions();
    const vs = $("versionSel");
    vs.value = v.installedVersion || "";
    setVerHint(vs.value);
    const commitVer = () => {
      const val = vs.value.trim();
      setVerHint(val);
      gstate = Garage.update(v.id, { installedVersion: val });
      renderGarage(); render();
    };
    vs.onchange = commitVer;
    vs.oninput = () => setVerHint(vs.value.trim());

    const es = $("earlySlider");
    es.value = Math.round(v.earliness * 100);
    setEarlyLabel();
    es.oninput = () => {
      gstate = Garage.update(v.id, { earliness: (+es.value) / 100, earlinessSource: "manual" });
      setEarlyLabel(); ui.guessDays = null; clearGuess(); render();
    };

    const ea = $("earlyAccessChk"); ea.checked = !!v.earlyAccess;
    ea.onchange = () => { gstate = Garage.update(v.id, { earlyAccess: ea.checked }); persistConnected(v, { earlyAccess: ea.checked }); ui.guessDays = null; clearGuess(); setEarlyLabel(); render(); };
    const nc = $("newCarChk"); if (nc) { nc.checked = !!v.newCar; nc.onchange = () => { gstate = Garage.update(v.id, { newCar: nc.checked }); ui.guessDays = null; clearGuess(); render(); }; }

    const opt = $("optInToggle");
    opt.checked = !!v.optedIn;
    opt.onchange = () => { gstate = Garage.update(v.id, { optedIn: opt.checked }); persistConnected(v, { optedIn: opt.checked }); renderConnectState(av()); };
    renderConnectState(v);

    // wake-car-and-read-version (connected cars only)
    const rr = $("refreshRow"), rb = $("refreshCarBtn"), rs = $("refreshStatus");
    if (rr) rr.hidden = !v.connected;
    if (rb) { rb.onclick = () => refreshFromCar(v); if (rs && !rs.textContent) rs.textContent = ""; }

    const clr = $("clearDataBtn");
    if (clr) clr.onclick = () => {
      if (confirm("Remove all your vehicles and history from this device? This can't be undone.")) {
        gstate = Garage.clearAll(); ui.guessDays = null; clearGuess(); renderGarage(); renderActiveControls(); render();
      }
    };

    renderHistory();
  }
  function setVerHint(val) {
    const el = $("verHint"); if (!el) return;
    if (!val) { el.textContent = ""; el.className = ""; return; }
    const ok = WEN.isValidVersion(val);
    el.textContent = ok ? "" : "— check the format (e.g. 2026.8.3.10)";
    el.className = ok ? "" : "ver-warn";
  }
  function populateVersionOptions() {
    const set = new Set();
    WEN.versions.forEach(v => set.add(v.version));
    (WEN.versionSuggestions || []).forEach(v => set.add(v));
    gstate.vehicles.forEach(v => { if (v.installedVersion) set.add(v.installedVersion); (v.history || []).forEach(h => h.version && set.add(h.version)); });
    const dl = $("versionOptions");
    if (dl) dl.innerHTML = [...set].sort((a, b) => WEN.verKey(b) - WEN.verKey(a)).map(v => `<option value="${esc(v)}"></option>`).join("");
  }
  function setEarlyLabel() {
    const v = av(), base = v.earliness, eff = effEarliness(v);
    const shifted = Math.abs(eff - base) > 0.005 && v.earlinessSource !== "history";
    $("earlyVal").textContent = shifted ? `${pctLabel(eff)} (after settings)` : pctLabel(eff);
  }

  // ---- update history -> estimated earliness ----
  function renderHistory() {
    const v = av();
    const list = (v.history || []).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
    const srcTag = (h) => h.source === "tesla" ? `<span class="hsrc hsrc-tesla" title="Read automatically from your Tesla">🛰️ auto</span>`
      : h.source === "estimated" ? `<span class="hsrc hsrc-est" title="Estimated from the model — edit the date to make it exact">✏️ est</span>` : "";
    $("histList").innerHTML = list.length
      ? list.map((h) => `<li><span class="hver">${esc(h.version)}</span>${srcTag(h)}<input type="date" class="hdate" data-hkey="${esc(h.version + "|" + h.date)}" value="${esc(h.date)}" aria-label="date for ${esc(h.version)}"/><button class="hist-x" data-hkey="${esc(h.version + "|" + h.date)}" aria-label="remove">×</button></li>`).join("")
      : `<li class="hist-empty">No updates logged yet. Hit <strong>📅 Estimate</strong> to fill in likely dates (then edit any to exact), or log one manually.</li>`;

    $("histList").querySelectorAll(".hist-x").forEach(b => b.onclick = () => {
      const [ver, date] = b.dataset.hkey.split("|");
      gstate = Garage.update(v.id, { history: (v.history || []).filter(h => !(h.version === ver && h.date === date)) });
      applyEstimate(); renderHistory();
    });
    $("histList").querySelectorAll(".hdate").forEach(inp => inp.onchange = () => {
      const [ver, date] = inp.dataset.hkey.split("|"); const nd = inp.value;
      if (!nd) return;
      const hist = (v.history || []).map(h => (h.version === ver && h.date === date) ? { version: ver, date: nd, source: "exact" } : h);
      gstate = Garage.update(v.id, { history: hist });
      gstate = Garage.update(v.id, { earlinessSource: "history" });
      applyEstimate(); renderActiveControls(); render();
    });

    const est = Garage.estimateEarliness(v);
    if (est) {
      $("earlyEstimate").innerHTML =
        `<div class="est-row"><span>📊 Estimated from ${est.n} logged update${est.n > 1 ? "s" : ""}: ` +
        `<strong>${pctLabel(est.earliness)}</strong></span>` +
        `<button class="btn-sm" id="applyEstBtn" type="button">Use this</button></div>` +
        `<div class="est-note">Derived by inverting the modelled rollout curve for each version — sharper than the slider, but only as good as the model until we have your live data.</div>`;
      $("applyEstBtn").onclick = () => {
        gstate = Garage.update(v.id, { earliness: est.earliness, earlinessSource: "history" });
        renderActiveControls(); ui.guessDays = null; clearGuess(); render();
      };
    } else {
      $("earlyEstimate").innerHTML = "";
    }
  }
  function applyEstimate() {
    const v = av(); const est = Garage.estimateEarliness(v);
    if (est && v.earlinessSource === "history") {
      gstate = Garage.update(v.id, { earliness: est.earliness });
      renderActiveControls(); render();
    }
  }

  // Fill in LIKELY dates for the car's recent updates (from the model + your rollout position),
  // tagged "est" and editable — correct any to exact and it becomes real signal.
  function estimateHistory() {
    const v = av(); if (!v) return;
    const myKey = WEN.verKey(v.installedVersion || "0");
    const P = Math.min(0.97, Math.max(0.03, effEarliness(v)));
    const logit = (p) => Math.log(p / (1 - p));
    const path = (WEN.versions || [])
      .filter(x => WEN.verKey(x.version) <= myKey && ["rolling", "tapering", "mature", "legacy"].includes(x.status))
      .sort((a, b) => WEN.verKey(b.version) - WEN.verKey(a.version)).slice(0, 4);
    const est = path.map(x => {
      const t0 = x.t0 || x.firstSeen; if (!t0) return null;
      const offset = Math.round(logit(P) / (x.k || 0.33));
      const date = Predict.isoDay(Predict.addDays(t0, offset));
      return (date && new Date(date) <= new Date(today)) ? { version: x.version, date, source: "estimated" } : null;
    }).filter(Boolean);
    const merged = (v.history || []).slice();
    for (const e of est) if (!merged.some(h => h.version === e.version)) merged.push(e);
    gstate = Garage.update(v.id, { history: merged });
    renderHistory();
  }

  // Merge REAL update history (version snapshots) read from the owner's Tesla, by VIN.
  function addHistory(entries) {
    if (!Array.isArray(entries) || !entries.length) return;
    const byVin = {};
    entries.forEach(e => { if (e.vin && e.version && e.date) (byVin[String(e.vin).toUpperCase()] = byVin[String(e.vin).toUpperCase()] || []).push(e); });
    const s = Garage.get(); let touched = false;
    s.vehicles.forEach(veh => {
      const ev = byVin[String(veh.vin || "").toUpperCase()]; if (!ev) return;
      const nonTesla = (veh.history || []).filter(h => h.source !== "tesla");
      const tesla = ev.map(e => ({ version: e.version, date: String(e.date).slice(0, 10), source: "tesla" }));
      const seen = new Set(), merged = [];
      for (const h of tesla.concat(nonTesla)) { const k = h.version + "|" + h.date; if (!seen.has(k)) { seen.add(k); merged.push(h); } }
      Garage.update(veh.id, { history: merged });
      if (merged.some(h => h.source === "tesla" || h.source === "exact")) Garage.update(veh.id, { earlinessSource: "history" });
      touched = true;
    });
    if (touched) { gstate = Garage.get(); applyEstimate(); try { renderActiveControls(); render(); } catch (e) {} }
  }

  // ---------------- add vehicle + VIN ----------------
  function wireAddForm() {
    $("addVehicleBtn").onclick = () => { $("addForm").hidden = false; $("addVehicleBtn").hidden = true; resetForm(); $("vinInput").focus(); };
    $("cancelVehicleBtn").onclick = () => { $("addForm").hidden = true; $("addVehicleBtn").hidden = false; renderGarage(); };

    $("f_market").innerHTML = Object.keys(WEN.regionLag).map(m => `<option ${m === "Australia" ? "selected" : ""}>${m}</option>`).join("");
    populateVersionOptions();

    $("vinDecodeBtn").onclick = doDecode;
    $("vinInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doDecode(); } });

    $("saveVehicleBtn").onclick = () => {
      const vin = $("vinInput").value.trim().toUpperCase();
      let gen = "";
      if (vin.length === 17) { const d = VIN.decode(vin); if (d.valid) gen = d.generation; }
      const market = $("f_market").value, hw = $("f_hw").value;
      const region = WEN.regions[market] || {};
      const fsdInfo = region.fsd ? region.fsd[hw] : null;
      const veh = {
        nickname: $("f_nick").value.trim() || $("f_model").value,
        vin,
        model: $("f_model").value,
        year: +$("f_year").value || 2026,
        generation: gen,
        hardware: hw,
        market,
        drive: region.drive || "RHD",
        installedVersion: $("f_ver").value.trim() || (WEN.versions[0] && WEN.versions[0].version) || "2026.14.6",
        fsdVersion: fsdInfo ? fsdInfo.current : "—",
        earliness: 0.5, earlinessSource: "default",
        updateChannel: "standard", earlyAccess: false,
        optedIn: false, history: [],
      };
      gstate = Garage.add(veh);
      $("addForm").hidden = true; $("addVehicleBtn").hidden = false;
      ui.guessDays = null; clearGuess();
      renderGarage(); renderActiveControls(); render();
    };

    $("connectTeslaBtn").onclick = connectTesla;

    $("addHistBtn").onclick = () => { $("histForm").hidden = !$("histForm").hidden; };
    if ($("estHistBtn")) $("estHistBtn").onclick = () => estimateHistory();
    $("h_add").onclick = () => {
      const ver = $("h_ver").value.trim(), date = $("h_date").value;
      if (!ver || !date) return;
      const v = av(); const hist = (v.history || []).concat([{ version: ver, date }]);
      gstate = Garage.update(v.id, { history: hist });
      $("h_date").value = ""; $("h_ver").value = ""; $("histForm").hidden = true;
      populateVersionOptions(); renderHistory();
    };
  }
  function resetForm() {
    $("vinInput").value = ""; $("vinResult").innerHTML = "";
    $("f_nick").value = ""; $("f_model").value = "Model Y"; $("f_year").value = 2026; $("f_hw").value = "AI4"; $("f_ver").value = "";
  }
  function doDecode() {
    const d = VIN.decode($("vinInput").value);
    if (!d.valid && d.warnings.length) {
      $("vinResult").innerHTML = `<div class="vin-warn">⚠ ${esc(d.warnings.join(" "))}</div>`;
      return;
    }
    // autofill the form
    if (d.model) $("f_model").value = d.model;
    if (d.year) $("f_year").value = d.year;
    if (d.hardware) $("f_hw").value = d.hardware;
    if (!$("f_nick").value) $("f_nick").value = d.displayName;
    const bits = [d.displayName, d.hardware + " (" + d.hardwareNote + ")", d.plant ? "Built " + d.plant : ""].filter(Boolean);
    $("vinResult").innerHTML = `<div class="vin-ok">✓ ${esc(bits.join(" · "))}</div>` +
      (d.warnings.length ? `<div class="vin-warn">⚠ ${esc(d.warnings.join(" "))}</div>` : "");
  }

  // ---------------- "Call your shot" guess game ----------------
  const RISK = {
    safe: { label: "🛡️ Sensible", window: 10, mult: 1, tag: "safe" },
    bold: { label: "🎯 Confident", window: 5, mult: 2.5, tag: "bold" },
    yolo: { label: "🎲 Trust me bro", window: 2, mult: 6, tag: "yolo" },
  };
  function renderGuess(pred) {
    if (!$("guessDate").value) $("guessDate").value = Predict.isoDay(pred.medianDate);
    document.querySelectorAll("#nervePick .nerve-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.risk === ui.guessRisk);
      b.onclick = () => {
        ui.guessRisk = b.dataset.risk;
        document.querySelectorAll("#nervePick .nerve-btn").forEach(x => x.classList.toggle("active", x === b));
        if (ui.guessDays != null) showGuessResult(pred);
      };
    });
    if (ui.guessDays != null) showGuessResult(pred);
  }
  function showGuessResult(pred) {
    const guessStr = $("guessDate").value;
    if (!guessStr || isNaN(new Date(guessStr + "T00:00:00Z"))) {
      $("guessResult").classList.add("show");
      $("guessResult").innerHTML = `<div class="muted">${esc(rnd(["Pick a valid date first 📅", "Bold of you to bet on 'whenever'. Pick a day. 📅", "We need an actual date, prophet. 🔮"]))}</div>`;
      return;
    }
    const risk = RISK[ui.guessRisk] || RISK.bold;
    const g = Predict.daysBetween(today, guessStr);
    ui.guessDays = g;
    const odds = Math.round(Math.max(0, Math.min(1, pred.probWithin(g + risk.window) - pred.probWithin(g - risk.window))) * 100);
    const potential = Math.round(100 * risk.mult);
    const v = av();
    const target = pred.targetLabel || "the next update";
    const dateNice = Predict.fmtDate(guessStr).replace(/^\w+, /, "");
    const blurb = `📲 Calling it: my Tesla gets ${target} by ${dateNice} (${risk.label} mode). wenFSD gives me ${odds}%. Screenshot so you can mock me later 😤 → wenfsd.info`;
    $("guessResult").innerHTML =
      `<div class="shot shot-${risk.tag}">` +
        `<div class="shot-mode">${risk.label} mode</div>` +
        `<div class="shot-call">You're calling <strong>${esc(target)}</strong> by <strong>${esc(dateNice)}</strong>.</div>` +
        `<div class="shot-stats"><div><b>${odds}%</b><span>house odds you nail the ±${risk.window}-day window</span></div><div><b>🪙 ${potential}</b><span>wenPoints if you're right</span></div></div>` +
        `<div class="shot-verdict">${guessVerdict(risk, odds, g, pred)}</div>` +
        `<div class="shot-stake" id="shotStake">${v && v.connected ? "🔒 Hit “Lock in” to stake this for real — it auto-settles when your car updates, and pays out wenPoints to the leaderboard." : "📸 Lock it in, screenshot it, hold yourself to it. Connect your Tesla to stake it for real + earn wenPoints."}</div>` +
        `<div class="shot-actions"><button class="btn-sm" id="copyBrag" type="button">🔗 Copy brag</button><button class="btn-sm" id="shareTmc" type="button">💬 Take it to TMC</button></div>` +
      `</div>`;
    $("guessResult").classList.add("show");
    Charts.distribution($("distChart"), pred, today, ui.guessDays);
    $("copyBrag").onclick = () => copyText(blurb, $("copyBrag"));
    $("shareTmc").onclick = () => { copyText(blurb, $("shareTmc")); window.open("https://teslamotorsclub.com/tmc/", "_blank", "noopener"); };
  }
  // "Lock in" → render the card AND, for a connected car, stake the wager server-side (settles
  // automatically when the car updates → real wenPoints).
  function lockInGuess(pred) {
    showGuessResult(pred);
    const v = av(), guessStr = $("guessDate").value;
    if (!v || !v.connected || !/^https?:$/.test(location.protocol) || !guessStr) return;
    const risk = RISK[ui.guessRisk] || RISK.bold, st = $("shotStake");
    if (st) st.textContent = "Staking…";
    fetch("/api/me/guess", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
      body: JSON.stringify({ guessDate: guessStr, windowDays: risk.window, mult: risk.mult, target: pred.targetLabel || null }) })
      .then(r => r.json()).then(d => { if (st) st.textContent = d && d.staked ? "🔒 Staked! Settles automatically when your car updates — then it pays out wenPoints." : "🔒 Saved."; })
      .catch(() => { if (st) st.textContent = "⚠ Couldn't stake it (you can still screenshot your call)."; });
  }
  function guessVerdict(risk, odds, g, pred) {
    const off = Math.round(g - pred.daysToMedian);
    if (risk.tag === "yolo") {
      if (odds <= 12) return `Absolute degenerate behaviour. The model gives you ${odds}%. Two weeks? Trust me bro. 🫡`;
      if (odds >= 35) return `Bold <em>and</em> the model agrees?! Suspicious. Are you secretly a Tesla engineer?`;
      return `Respect the nerve — ${odds}% at a 6× payout. Fortune favours the brave (occasionally).`;
    }
    if (risk.tag === "safe") {
      return odds >= 45 ? `The sensible choice. You'll probably be right, and nobody will be impressed. 🥱`
        : `Playing it safe… while still fighting the model. Bold strategy, Cotton.`;
    }
    if (off > 7) return `Betting it drags. The cynic's special — the model thinks you're <em>too</em> pessimistic.`;
    if (off < -7) return `Betting it lands early, you optimist. The model says don't hold your breath.`;
    return `A respectable call. The model gives you ${odds}%.`;
  }
  function copyText(text, btn) {
    const done = () => { if (!btn) return; const t = btn.textContent; btn.textContent = "✓ Copied!"; setTimeout(() => { btn.textContent = t; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta); if (done) done();
  }
  function clearGuess() { $("guessResult").classList.remove("show"); $("guessResult").innerHTML = ""; $("guessDate").value = ""; }

  // ---------------- static panels ----------------
  function pctLabel(p) {
    const pct = Math.round(p * 100);
    const word = p <= 0.2 ? "very early" : p <= 0.4 ? "earlier than most" : p <= 0.6 ? "average" : p <= 0.8 ? "later than most" : "very late";
    return `${word} (~${pct}th pct)`;
  }
  const MODE_LABEL = { rolling: "Rolling out", early: "Early/staged rollout", gated: "Awaiting approval", current: "On newest", capped: "Hardware-capped" };
  function activeFsdRegion() { return ui.exploreRegion || (av() ? av().market : "Australia"); }

  function renderFSD() {
    const v = av(), rname0 = activeFsdRegion();
    const region = WEN.regions[rname0] || {};
    const hw = v ? v.hardware : "AI4";
    const isYours = !!(v && rname0 === v.market);
    const f = region.fsd ? region.fsd[hw] : null;

    // region picker
    const sel = $("exploreRegionSel");
    if (sel) {
      sel.innerHTML = Object.keys(WEN.regions).map(m => `<option ${m === rname0 ? "selected" : ""}>${m}${v && m === v.market ? " — you" : ""}</option>`).join("");
      sel.onchange = () => { ui.exploreRegion = sel.value.replace(/ — you$/, ""); renderFSD(); renderRegions(); };
    }

    // typical-car ETA for the explored region (existing fleet, 50th pct) — or your car if it's your region
    const etaCar = isYours ? car() : { market: rname0, hardware: hw, fsdVersion: f ? f.current : null, earlinessPercentile: 0.5, earlyAccess: false, newCar: false };
    const fp = f ? Predict.predictNextFSD(etaCar, today) : null;
    const eta = fp && !fp.capped && !fp.unavailable ? Predict.fmtDate(fp.medianDate).replace(/^\w+, /, "") : (f && (f.mode === "capped" || (fp && fp.capped)) ? "capped" : "—");
    $("fsdGrid").innerHTML =
      `<div class="fsd-stat"><div class="fsd-num">${f ? (MODE_LABEL[f.mode] || f.mode) : "—"}</div><div class="fsd-lbl">FSD status · ${esc(rname0)} ${esc(hw)}</div></div>` +
      `<div class="fsd-stat"><div class="fsd-num">${f ? esc(f.current) : "—"}</div><div class="fsd-lbl">current FSD ${isYours ? "(yours)" : "(typical car)"}</div></div>` +
      `<div class="fsd-stat"><div class="fsd-num">${esc(eta)}</div><div class="fsd-lbl">next FSD — ${isYours ? "your ETA" : "typical-car ETA"}</div></div>`;

    // region × hardware matrix (highlights the explored region)
    const rows = Object.keys(WEN.regions).map(rname => {
      const r = WEN.regions[rname];
      const cell = (hw) => {
        const x = r.fsd[hw];
        if (!x) return `<td class="mx-na">—</td>`;
        const next = x.next ? `<span class="mx-next">→ ${esc(x.next)}</span>` : `<span class="mx-capped">capped</span>`;
        return `<td><div class="mx-cur">${esc(x.current)}</div><div class="mx-mode mode-${x.mode}">${MODE_LABEL[x.mode] || x.mode}</div>${next}</td>`;
      };
      const isShown = rname === rname0, isCar = v && rname === v.market;
      return `<tr class="${isShown ? "mx-active" : ""} mx-click" data-explore-region="${esc(rname)}" title="Explore ${esc(rname)}"><td class="mx-region">${esc(rname)}${isCar ? ' <span class="tag-you">you</span>' : ''}</td>${cell("AI4")}${cell("AI3")}</tr>`;
    }).join("");
    $("fsdMatrix").innerHTML =
      `<table class="mx-table"><thead><tr><th>Region</th><th>HW4 / AI4</th><th>HW3 / AI3</th></tr></thead><tbody>${rows}</tbody></table>`;

    const tlHead = $("fsdTlHead"); if (tlHead) tlHead.innerHTML = `${esc(rname0)} FSD timeline <span class="mut-i" style="font-weight:400;font-size:11px">— <span style="color:#5fd1a0">✓ observed</span> events are real (tracker first-seen / reported rollouts); <span style="color:#e8b15a">~ projected</span> are modelled estimates</span>`;
    $("fsdTimeline").innerHTML = WEN.fsdMilestones.map(m => {
      const obs = m.kind === "observed";
      return `<li class="${obs ? "done" : "pending"}"><span class="tl-dot"></span><span class="tl-date">${esc(m.date)}</span><span class="tl-label">${esc(m.label)} <span class="tl-kind ${obs ? "tl-obs" : "tl-proj"}">${obs ? "✓ observed" : "~ projected"}</span></span></li>`;
    }).join("");
  }
  // ---- sample-vs-live honesty indicator ----
  function renderDataMode() {
    const live = WEN.dataMode === "live";
    const el = $("dataMode"), lbl = $("dataModeLabel");
    if (lbl) lbl.textContent = live ? "live fleet data" : "sample data";
    if (el) { el.classList.toggle("is-sample", !live); el.title = live ? "Live, aggregated from connected cars + trackers" : "Illustrative sample data — connect a backend / your Tesla for live figures"; }
    const fwSub = document.querySelector("#fwSub");
    if (fwSub) fwSub.textContent = live ? "live distribution" : "sample distribution";
    // fleet sections: always visible. Firmware/feed become REAL once live (tracker-aggregated);
    // the FSD-by-region matrix, OS-lag panel and release-note text stay modelled either way, so
    // they keep an honest "regional timing is modelled" badge even in live mode.
    // release notes become REAL when scraped live; the FSD-by-region & OS-lag panels are
    // always modelled (their regional *timing* is always our estimate).
    const ALWAYS_MODELLED = new Set(["fsdCard", "regionCard"]);
    if (WEN.releaseNotesSource !== "live") ALWAYS_MODELLED.add("releaseNotesCard");
    document.querySelectorAll(".fleet-card").forEach(card => {
      card.style.display = "";
      if (card.id === "calibrationCard") { const b = card.querySelector(":scope > .est-badge"); if (b) b.remove(); card.classList.remove("estimate-mode"); return; } // self-describes its own mode
      const modelled = ALWAYS_MODELLED.has(card.id);
      const showBadge = modelled || !live;
      card.classList.toggle("estimate-mode", showBadge);
      let badge = card.querySelector(":scope > .est-badge");
      if (showBadge) {
        if (!badge) { badge = document.createElement("div"); badge.className = "est-badge"; card.insertBefore(badge, card.firstChild); }
        badge.innerHTML = modelled
          ? `⚖️ <strong>Part observed, part modelled.</strong> Versions, FSD builds &amp; first-seen dates are <strong>real</strong> (from the trackers + connected cars); the per-region <strong>ETA</strong> is a model fitted to those real observations — accurate as far as the data goes, not a Tesla announcement.`
          : `⚠️ Modelled estimate — not live fleet data. <span>Firms up as real cars connect &amp; trackers are aggregated.</span>`;
      } else if (badge) { badge.remove(); }
    });
    const banner = $("sampleBanner");
    if (banner) {
      banner.hidden = false;
      banner.className = live ? "sample-banner sb-live" : "sample-banner";
      banner.innerHTML = live
        ? `✓ Showing live fleet data aggregated from connected cars + public trackers.`
        : `Showing <strong>your real car data</strong> plus <em>modelled estimates</em> for the fleet-wide views below — each one clearly badged. Estimates become live figures as real Teslas connect and we aggregate the public trackers. No figure is presented as observed unless it is.`;
    }
  }

  // ---- model calibration / back-test against real tracker history ----
  function renderCalibration(cal) {
    const el = $("calibrationBody");
    if (!el) return;
    const acc = cal && cal.accuracy;
    const haveLive = cal && cal.mode === "live";
    const haveAcc = acc && acc.scored > 0;
    if (!haveLive && !haveAcc) {
      const openNote = acc && acc.open ? ` <strong>${acc.open} prediction${acc.open === 1 ? "" : "s"}</strong> currently open, awaiting the next update.` : "";
      el.innerHTML = `<p class="cal-note">Calibration appears once live sources are enabled. It back-tests the engine against real release history from the public trackers — cadence, rollout velocity and coverage. No fabricated accuracy figure is shown: per-car hit-rate is published only once enough connected cars provide ground truth.${openNote}</p>`;
      return;
    }
    const c = cal.cadence, v = cal.velocity, cov = cal.coverage, tiles = [];
    if (haveAcc) tiles.push(["Prediction accuracy", `${acc.hitRate}% in-window`, `${acc.scored} connected-car prediction${acc.scored === 1 ? "" : "s"} scored vs reality${acc.medianAbsErrorDays != null ? ` · median miss ±${acc.medianAbsErrorDays}d` : ""}`, true]);
    if (c) tiles.push(["Release cadence", `~${c.medianDays}d`, `median between OS branches · ${c.meanDays}±${c.sdDays}d mean · from ${c.branches} real branches`]);
    if (v) tiles.push(["Rollout velocity", `~${v.medianDaysQ1toQ3}d`, `installs go 25%→75% once a version reaches cars · ${v.sampleVersions} rollouts (TeslaFi daily data)`]);
    if (cov) tiles.push(["Coverage", `${cov.versions} versions`, `${cov.versionsWithShare} with fleet share · ${cov.sourceCount} live sources`]);
    el.innerHTML =
      `<div class="cal-grid">` +
      tiles.map(([h, big, sub, hot]) => `<div class="cal-tile${hot ? " cal-hot" : ""}"><div class="cal-h">${esc(h)}</div><div class="cal-big">${esc(big)}</div><div class="cal-sub">${esc(sub)}</div></div>`).join("") +
      `</div>` +
      (cov && cov.sources && cov.sources.length ? `<div class="cal-src">Validated against real history from: <strong>${cov.sources.map(esc).join(" · ")}</strong></div>` : "") +
      `<div class="cal-honesty">✓ ${esc(cal.honesty || "")}</div>`;
  }

  // ---- data sources attribution (we aggregate the public trackers) ----
  const DEFAULT_SOURCES = [
    { name: "Tessie", homepage: "https://stats.tessie.com/", ok: true }, { name: "Teslascope", homepage: "https://teslascope.com/software", ok: true }, { name: "TeslaFi", homepage: "https://teslafi.com/firmware.php", ok: true },
    { name: "Tesla Updates", homepage: "https://teslaupdates.org/rollouts", ok: true }, { name: "FleetCtrl", homepage: "https://fleetctrl.app/", ok: true },
  ];
  function renderDataSources(sources, live) {
    const list = sources || DEFAULT_SOURCES;
    $("dataSources").innerHTML =
      `<span class="ds-label">${live ? "Live data aggregated from" : "Aggregates"}:</span>` +
      list.map(s => {
        const inner = `${esc(s.name)}${s.ok !== false && s.versions ? " · " + s.versions : ""}`;
        const cls = `ds-pill ${s.ok === false ? "ds-down" : ""}`;
        return s.homepage ? `<a class="${cls}" href="${esc(s.homepage)}" target="_blank" rel="noopener" title="Open ${esc(s.name)}">${inner} ↗</a>` : `<span class="${cls}">${inner}</span>`;
      }).join("") +
      `<span class="ds-note">wenFSD merges these (fleet-weighted) and adds the prediction layer none of them have.</span>`;
  }

  // ---- release notes (fleetctrl-style changelog) ----
  const RN_TAG = { FSD: "rn-fsd", Dashcam: "rn-feat", Charging: "rn-feat", Sentry: "rn-feat", Nav: "rn-feat", Fix: "rn-fix", Safety: "rn-safety", UI: "rn-ui" };
  function renderReleaseNotes() {
    const mine = av() ? av().installedVersion : null;
    const order = WEN.versions.map(v => v.version).filter(v => WEN.releaseNotes[v]);
    $("releaseNotes").innerHTML = order.map(ver => {
      const rn = WEN.releaseNotes[ver];
      const isMine = ver === mine;
      const items = rn.items.map(it => `<li><span class="rn-tag ${RN_TAG[it.tag] || "rn-feat"}">${esc(it.tag)}</span>${esc(it.text)}</li>`).join("");
      const regions = (rn.regions || []).map(r => `<span class="rn-region">${esc(r)}</span>`).join("");
      return `<details class="rn-item${isMine ? " rn-mine" : ""}" data-ver="${esc(ver)}"${isMine ? " open" : ""}>` +
        `<summary><span class="rn-ver">${esc(ver)}</span>${isMine ? ' <span class="tag-you">you</span>' : ''}` +
        `<span class="rn-date">${esc(rn.date)}</span><span class="rn-fsdb">FSD ${esc(rn.fsd || "—")}</span>` +
        `<span class="rn-regions">${regions}</span></summary>` +
        `<ul class="rn-items">${items}</ul>` +
        `<div class="rn-src">via ${esc(rn.source || "trackers")}</div></details>`;
    }).join("");
  }

  // ---- per-region OS rollout panel (country breakdown) ----
  // change the active car's market (used by the region dropdown, region rows, FSD matrix)
  function setMarket(name) {
    const v = av(); if (!v || !WEN.regions[name] || name === v.market) return;
    gstate = Garage.update(v.id, { market: name });
    persistConnected(v, { market: name });
    renderActiveControls(); renderGarage(); ui.guessDays = null; clearGuess(); render();
  }
  // jump to a version's release note (opening it) or its firmware-table row
  function flash(el) { el.classList.add("rn-flash"); setTimeout(() => el.classList.remove("rn-flash"), 1200); }

  // expanded detail for any version: distribution, FSD build, regions, activity, notes, and
  // where it sits relative to YOUR car (NOW/NEXT/ahead/behind).
  function showVersionDetail(ver) {
    const body = $("verModalBody"); if (!body) return;
    const d = (WEN.versions || []).find(x => x.version === ver);
    const rn = WEN.releaseNotes[ver];
    const v = av();
    // relation to the user's current build
    let rel = "";
    if (v && v.installedVersion) {
      if (v.installedVersion === ver) rel = `<span class="vm-rel vm-now">This is your current version</span>`;
      else {
        const diff = WEN.verKey(ver) - WEN.verKey(v.installedVersion);
        const ahead = (WEN.versions || []).filter(x => WEN.verKey(x.version) > WEN.verKey(v.installedVersion) && WEN.verKey(x.version) <= WEN.verKey(ver)).length;
        rel = diff > 0
          ? `<span class="vm-rel vm-newer">Newer than your ${esc(v.installedVersion)}${ahead ? ` — ${ahead} build${ahead > 1 ? "s" : ""} ahead` : ""}</span>`
          : `<span class="vm-rel vm-older">Older than your ${esc(v.installedVersion)}</span>`;
      }
    }
    const stat = (label, val) => `<div class="vm-stat"><span>${esc(label)}</span><b>${val}</b></div>`;
    const regions = (d && d.regions && d.regions.length) ? d.regions : (rn && rn.regions || []);
    const notesItems = rn && rn.items ? rn.items.map(it => `<li><span class="rn-tag ${RN_TAG[it.tag] || "rn-feat"}">${esc(it.tag)}</span>${esc(it.text)}</li>`).join("") : "";
    body.innerHTML =
      `<h3 id="verModalTitle" class="vm-title">${esc(ver)}${v && v.installedVersion === ver ? ' <span class="tag-you">you</span>' : ''}</h3>` +
      (rel ? `<div class="vm-rel-row">${rel}</div>` : "") +
      `<div class="vm-stats">` +
        stat("Fleet share (global)", d && d.fleetPct != null ? d.fleetPct + "%" : "not reported") +
        stat("Status", d ? (d.status || "—") : "—") +
        stat("First seen", d && d.firstSeen ? shortDate(d.firstSeen) : "—") +
        stat("FSD build (AI4)", d && d.fsdBuild && d.fsdBuild.AI4 && d.fsdBuild.AI4 !== "—" ? d.fsdBuild.AI4 : "—") +
        (d && d.recentInstalls ? stat("Installs this week", "🔥 " + Number(d.recentInstalls).toLocaleString()) : "") +
      `</div>` +
      (regions.length ? `<div class="vm-regions"><span class="vm-k">Seen in:</span> ${regions.map(r => `<span class="rn-region">${esc(r)}</span>`).join("")}</div>` : "") +
      (d && d.sources && d.sources.length ? `<div class="vm-src">via ${d.sources.map(esc).join(" · ")}</div>` : "") +
      (notesItems ? `<div class="vm-notes-h">Release notes${rn.source ? ` <span class="mut-i">via ${esc(rn.source)}</span>` : ""}</div><ul class="rn-items">${notesItems}</ul>` : `<p class="vm-nonotes">No release notes captured for this build yet.</p>`);
    $("verModal").hidden = false;
    document.body.style.overflow = "hidden";
    const cl = $("verModalClose"); if (cl) cl.focus();
  }
  function closeVersionModal() { const m = $("verModal"); if (m) m.hidden = true; document.body.style.overflow = ""; }

  // explore a region's data (FSD card + region highlights) — independent of your car
  function exploreRegion(name) {
    if (!WEN.regions[name]) return;
    ui.exploreRegion = name; renderFSD(); renderRegions();
    const card = $("fsdCard"); if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function renderRegions() {
    const shown = activeFsdRegion();
    const carMarket = av() ? av().market : null;
    const base = WEN.regions["United States"].osLagDays;
    const lags = Object.values(WEN.regions).map(r => r.osLagDays - base);
    const maxLag = Math.max(1, ...lags);
    $("regionPanel").innerHTML = Object.keys(WEN.regions).map(name => {
      const r = WEN.regions[name];
      const lag = r.osLagDays - base;
      const p = Predict.predictNextOS({ market: name, hardware: "AI4", installedVersion: "2026.14.6", earlinessPercentile: 0.5 }, today);
      const isShown = name === shown, isCar = name === carMarket;
      const barW = (lag / maxLag) * 100;
      return `<div class="rp-row ${isShown ? "rp-active" : ""} rp-click" data-explore-region="${esc(name)}" title="Explore ${esc(name)}">` +
        `<div class="rp-name">${esc(name)}${isCar ? ' <span class="tag-you">you</span>' : ''} <span class="rp-drive">${r.drive}</span></div>` +
        `<div class="rp-lag">${lag === 0 ? "US baseline" : "+" + lag + "d behind US"}</div>` +
        `<div class="rp-bar"><span style="width:${Math.max(2, barW)}%"></span></div>` +
        `<div class="rp-eta">${esc(p.targetLabel)} in <strong>~${Math.max(0, p.daysToMedian)}d</strong></div>` +
        `</div>`;
    }).join("");
  }

  // 7-day install-velocity sparkline, derived from the version's logistic (mirrors the
  // "install calendar" the real trackers show — but generated from the model).
  function sparkSVG(v) {
    const t0Days = Predict.daysBetween(today, v.t0), L = 0.95, fleet = WEN.stats.auCars;
    const vals = []; let max = 0;
    for (let d = -6; d <= 0; d++) {
      const inst = Math.max(0, (Predict.adoption(d - t0Days, v.k, L) - Predict.adoption(d - 1 - t0Days, v.k, L)) * fleet);
      vals.push(inst); if (inst > max) max = inst;
    }
    const w = 60, h = 18, bw = w / 7;
    const bars = vals.map((inst, i) => { const bh = max > 0 ? Math.max(1, (inst / max) * h) : 1; return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${(bw - 1.5).toFixed(1)}" height="${bh.toFixed(1)}" rx="1"/>`; }).join("");
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="7-day install velocity">${bars}</svg>`;
  }
  function renderTable() {
    const mine = av() ? av().installedVersion : null;
    const nextVer = av() ? (currentPrediction().targetLabel || null) : null;
    $("fwBody").innerHTML = WEN.versions.map(v => {
      const isMine = v.version === mine;
      const isNext = nextVer && v.version === nextVer;
      return `<tr class="${isMine ? "mine" : ""}${isNext ? " fw-next" : ""}">` +
        `<td><strong class="fw-verlink" data-goto-version="${esc(v.version)}" role="button" tabindex="0" title="Details for ${esc(v.version)}">${v.version}</strong>${isMine ? ' <span class="tag-you">you</span>' : ''}${isNext ? ' <span class="tag-next">next</span>' : ''}</td>` +
        `<td><span class="status status-${v.status}">${v.status}</span></td>` +
        `<td>${v.fleetPct != null ? `<div class="pctcell"><span class="pctbar" style="width:${Math.min(100, v.fleetPct * 2.2)}%"></span><em>${v.fleetPct}%</em></div>` : `<span class="mut-i">not reported</span>`}</td>` +
        `<td>${v.fleetPct != null ? sparkSVG(v) : "—"}</td>` +
        `<td>${v.firstSeen ? shortDate(v.firstSeen) : "—"}</td><td>${(v.fsdBuild && v.fsdBuild.AI4) || "—"}</td>` +
        `<td class="notes">${v.recentInstalls ? `<span class="fw-active">🔥 ${Number(v.recentInstalls).toLocaleString()} installs this week</span>` : (v.notes || "")}</td></tr>`;
    }).join("");
  }
  function renderStats() {
    if (WEN.dataMode !== "live") {
      $("statsStrip").innerHTML = `<div class="stats-sample">Fleet totals appear here once real cars connect — wenFSD shows no invented numbers.</div>`;
      return;
    }
    const s = WEN.stats; // real DB-derived counts in live mode
    $("statsStrip").innerHTML = [["cars tracked", (+s.carsTracked || 0).toLocaleString()], ["AU cars", (+s.auCars || 0).toLocaleString()],
      ["updates logged", (+s.updatesLogged || 0).toLocaleString()], ["versions", s.versionsTracked || 0]]
      .map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");
  }
  // Real rollout-activity feed: recent version RELEASES from the tracker data (firstSeen,
  // fleet %, install activity, FSD build, sources). Replaces the old fabricated per-car
  // ticker — no invented cities, no fake "just now" stream. Live in live mode; seed model
  // (badged) in sample mode. Sorted newest-first by first-seen.
  function renderFeed() {
    const feed = $("feed");
    if (!feed) return;
    const rows = (WEN.versions || [])
      .filter(v => v.firstSeen)
      .slice()
      .sort((a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)))
      .slice(0, 8);
    if (!rows.length) { feed.innerHTML = `<li class="feed-empty">No recent rollout activity yet.</li>`; $("feedSub").textContent = ""; return; }
    const mine = av() ? av().installedVersion : null;
    const nextVer = av() ? (currentPrediction().targetLabel || null) : null;
    feed.innerHTML = rows.map(v => {
      const pct = v.fleetPct != null ? `${v.fleetPct}% of fleet` : null;
      const inst = v.recentInstalls ? `🔥 ${Number(v.recentInstalls).toLocaleString()} installs/wk` : null;
      const fsd = (v.fsdBuild && v.fsdBuild.AI4 && v.fsdBuild.AI4 !== "—") ? `FSD ${v.fsdBuild.AI4}` : null;
      const meta = [pct, inst, fsd].filter(Boolean).join(" · ");
      const src = (v.sources && v.sources.length) ? `via ${v.sources.join(", ")}` : "";
      const tag = v.version === mine ? ' <span class="tag-you">you</span>' : (nextVer && v.version === nextVer ? ' <span class="tag-next">next</span>' : "");
      return `<li><span class="feed-when">${shortDate(v.firstSeen)}</span>` +
        `<span class="feed-main"><strong class="feed-relver" data-goto-version="${esc(v.version)}" role="button" tabindex="0" title="Details for ${esc(v.version)}">${esc(v.version)}</strong>${tag}${meta ? ` <span class="feed-meta">${esc(meta)}</span>` : ""}</span>` +
        `<span class="feed-ver">${esc(src)}</span></li>`;
    }).join("");
    $("feedSub").textContent = rows.length + " recent releases";
  }

  // ---------------- events ----------------
  function wire() {
    // delegated clicks for dynamically-rendered interactive elements (region rows, FSD
    // matrix rows, firmware/feed version links) — bound once, survive re-renders.
    function handleActivate(e) {
      const er = e.target.closest("[data-explore-region]");
      if (er) { e.preventDefault(); exploreRegion(er.getAttribute("data-explore-region")); return; }
      const g = e.target.closest("[data-goto-version]");
      if (g) { e.preventDefault(); showVersionDetail(g.getAttribute("data-goto-version")); return; }
    }
    document.addEventListener("click", handleActivate);
    document.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-goto-version],[data-explore-region]")) handleActivate(e); });

    // version-detail modal close (×, backdrop, Esc)
    const mClose = $("verModalClose"), mBack = $("verModalBackdrop");
    if (mClose) mClose.onclick = closeVersionModal;
    if (mBack) mBack.onclick = closeVersionModal;
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeVersionModal(); });

    $("guessBtn").onclick = () => lockInGuess(currentPrediction());
    window.addEventListener("resize", debounce(() => render(), 150));
  }
  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function shortDate(d) { return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" }); }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  // ---------------- boot ----------------
  // Expose the live-data bridge FIRST, before any render runs — so js/api.js can always
  // call setLinkState/addConnectedVehicles even if a boot render throws.
  window.WENFSD = {
    rerender() { renderFSD(); renderStats(); renderDataMode(); renderFeed(); render(); },
    setSources(list, live) { renderDataSources(list, live); },
    setCalibration(cal) { renderCalibration(cal); },
    addConnectedVehicles, setLinkState, addHistory,
    get activeVehicle() { return av(); },
  };

  $("todayLabel").textContent = new Date(today + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  renderGarage();
  renderActiveControls();
  wireAddForm();
  renderFSD();
  renderStats();
  renderDataMode();
  renderDataSources();
  renderFeed();
  renderCalibration();
  renderLeaderboard();
  wire();
  render();

  // Pull the owner's Tesla-linked vehicles (from /api/me/vehicles) into the garage.
  function addConnectedVehicles(list) {
    if (!Array.isArray(list) || !list.length) return;
    list.forEach(v => {
      const market = (WEN.regions[v.market]) ? v.market : "Australia";
      const region = WEN.regions[market] || {};
      const s = Garage.get();
      const existing = s.vehicles.find(x => (x.vin || "").toUpperCase() === (v.vin || "").toUpperCase());
      if (existing) {
        const patch = {
          model: v.model || existing.model, year: v.model_year || existing.year,
          generation: v.generation || existing.generation, hardware: v.hardware || existing.hardware,
          market, drive: v.drive || region.drive || existing.drive,
          earlyAccess: !!v.early_access, optedIn: !!v.opted_in, connected: true,
        };
        if (v.current_version) patch.installedVersion = v.current_version;   // don't clobber a manual entry with null
        if (v.earliness != null) { patch.earliness = v.earliness; patch.earlinessSource = "history"; }
        gstate = Garage.update(existing.id, patch);
      } else {
        gstate = Garage.add({
          nickname: [v.model_year, v.model, v.generation].filter(Boolean).join(" ") || "My Tesla",
          vin: v.vin, model: v.model || "Model Y", year: v.model_year || 2026, generation: v.generation || "",
          hardware: v.hardware || "AI4", market, drive: v.drive || region.drive || "RHD",
          installedVersion: v.current_version || "", fsdVersion: "",
          earliness: v.earliness != null ? v.earliness : 0.5, earlinessSource: v.earliness != null ? "history" : "default",
          earlyAccess: !!v.early_access, optedIn: !!v.opted_in, connected: true, history: [],
        });
      }
    });
    // render defensively — the car is already saved to the garage, so a render hiccup
    // in one section never prevents it appearing.
    try { renderGarage(); } catch (e) { console.warn(e); }
    try { renderActiveControls(); } catch (e) { console.warn(e); }
    try { render(); } catch (e) { console.warn(e); }
  }

  // Visible Tesla-connection status (so the link state is never a mystery).
  function setLinkState(state) {
    const el = $("linkStatus"); if (!el) return;
    el.hidden = false;
    if (state.status === 200 && Array.isArray(state.vehicles) && state.vehicles.length) {
      el.className = "link-status ls-ok";
      el.innerHTML = `🔗 <strong>Connected to Tesla</strong> — ${state.vehicles.length} vehicle${state.vehicles.length > 1 ? "s" : ""} linked.`;
      addConnectedVehicles(state.vehicles);
    } else if (state.status === 200) {
      el.className = "link-status ls-warn";
      el.innerHTML = `Connected to Tesla, but the API returned no vehicles yet. If you just linked, wait a moment and reload.`;
    } else {
      el.className = "link-status ls-off";
      el.innerHTML = `Not connected on this device (or your session expired). Use <strong>Connect Tesla account</strong> below to link your car.`;
    }
  }
})();
