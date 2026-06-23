/* wenFSD — app wiring (garage-driven) */
(function () {
  const $ = (id) => document.getElementById(id);
  const today = WEN.today;

  let gstate = Garage.get();           // { vehicles, activeId }
  const ui = { target: "standard", guessDays: null, addingHistory: false, exploreRegion: null, guessRisk: "bold", rnFilter: "all", paceWindow: "day", trackRegion: null, griefPick: null };

  function av() { return Garage.active(gstate); }

  // privacy-first funnel instrumentation: fire-and-forget aggregate event ping (no PII, no cookies).
  // Server validates against an allowlist and only increments a daily counter. No-ops off http(s).
  function track(event) {
    try {
      if (!/^https?:$/.test(location.protocol)) return;
      const body = JSON.stringify({ event });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/event", new Blob([body], { type: "application/json" }));
      else fetch("/api/event", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
    } catch (e) {}
  }

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
      earlinessSource: v.earlinessSource, fsdVersion: v.fsdVersion, earlyAccess: v.earlyAccess, newCar: !!v.newCar,
      fsdEntitlement: v.fsdEntitlement || "unknown",
      pendingUpdate: v.connected ? v.pendingUpdate : null,   // observed OTA from the car (connected only)
    };
  }
  // the FSD version YOUR car is actually on (its own reading, else its region's typical current).
  // Single source of truth so every "current FSD (yours)" reference agrees with the hero.
  function carCurrentFsd() {
    const v = av(); if (!v) return null;
    const raw = v.fsdVersion;
    if (raw && !/^(none|—|-|)$/i.test(String(raw).trim())) return raw;
    const r = WEN.regions[v.market], fdef = r && r.fsd ? r.fsd[v.hardware] : null;
    return fdef ? fdef.current : null;
  }

  // the headline prediction is always your NEXT UPDATE (the OS build) — FSD rides inside it,
  // and the FSD story is folded into the hero via renderFsdSummary (no confusing toggle).
  function currentPrediction() { return Predict.predictNextOS(car(), today); }

  // ---------------- render ----------------
  // unified FSD line: is the next FSD version bundled into your next update, later, or capped?
  // Brutally honest (but very funny) treatment for HW3 cars in Australia / New Zealand —
  // RHD + our regulators + capped hardware ⇒ realistically, FSD v14 is never landing here.
  const DOOM_HEAD = [
    "let's be upfront: this is realistically <strong>never</strong> happening on your car. 🪦",
    "the honest answer is <strong>no</strong>. Not soon. Not late. <em>No.</em>",
    "we modelled it. The model laughed, then gently closed its laptop. 💻",
    "FSD v14 on HW3 in {mkt}? That's not a rollout, that's a hostage situation with no demands.",
    "you have a better chance of Tesla mailing you a HW4 board personally signed by Elon.",
    "the ETA is best expressed in geological epochs. 🪨",
    "the model checked, double-checked, then offered you a hug instead of a date. 🫂",
    "your car's hardware and your hope are both, respectfully, end-of-life.",
    "ETA: shortly after the heat death of the universe, give or take a fortnight. 🌌",
    "we ran the numbers. The numbers asked us not to share them with you.",
  ];
  const BETTER_LUCK = [
    "You'd have better luck teaching a magpie to parallel park. 🐦🚗",
    "You'd have better luck getting the Cybertruck street-legal in {mkt}. 🔺",
    "You'd have better luck summoning rain by washing your car. 🌧️",
    "You'd have better luck asking a wombat to co-sign your mortgage. 🐾",
    "You'd have better luck waiting for the second Roadster. (Remember that?) 🏎️",
    "You'd have better luck winning Powerball, twice, on the same ticket. 🎟️",
    "You'd have better luck training your cat to supervise the supervision. 🐱",
    "You'd have better luck spotting a Tasmanian tiger doing donuts in a car park. 🐅",
    "You'd have better luck convincing the regulator that roundabouts are 'basically optional'. 🔄",
    "You'd have better luck if the car identified as a HW4 and committed to the bit. 🎭",
    "You'd have better luck getting a straight answer out of a Tesla service centre. 📞",
    "You'd have better luck teaching the Autopark to respect a single line marking. 🅿️",
    "You'd have better luck finding the indicator stalk they deleted. 🫥",
    "You'd have better luck if you renamed the car 'HW4' and just believed really hard. 🙏",
  ];
  const DOOM_ADVICE = [
    "Our official recommendation: enjoy the Autopilot you've got, and make peace. 🧘",
    "Consider channelling the wait into a hobby. Sourdough. Macramé. Grief. 🍞",
    "Set expectations to zero and you can only be pleasantly surprised. (You won't be.)",
    "Honestly? Buy a HW4 car. We'll wait. We have nothing but time, and so do you.",
    "Name a houseplant 'FSD' so something in your life finally grows. 🪴",
    "Treat 'HW3' as a personality, not a limitation. Lean in. Thrive. 💅",
    "Picture the v14 you'll never get. Hold it. Let it go. That's the whole journey. 🎈",
    "The good news: Autopilot still works. The bad news: that was the good news.",
  ];
  function isDownUnderHW3(v) { return v && v.hardware === "AI3" && (v.market === "Australia" || v.market === "New Zealand"); }
  function renderDoom(el, v, fresh) {
    const fill = (s) => s.replace(/\{mkt\}/g, esc(v.market));
    const head = fill(fresh ? rnd(DOOM_HEAD) : flavorPick("doomHead", DOOM_HEAD));
    const luck = fill(fresh ? rnd(BETTER_LUCK) : flavorPick("doomLuck", BETTER_LUCK));
    const adv = fill(fresh ? rnd(DOOM_ADVICE) : flavorPick("doomAdvice", DOOM_ADVICE));
    el.innerHTML = `<div class="fsum fsum-doom" id="doomBox" role="button" tabindex="0" title="Tap for more bad news">` +
      `<div class="doom-h">💀 FSD on your HW3 ${esc(v.market)} car — ${head}</div>` +
      `<div class="doom-why">The upfront truth: HW3 (AI3) can't run the HW4-only v14 (Supervised). Tesla has <em>promised</em> a stripped-down “v14 Lite” for older hardware — but it's rolling out in the <strong>US first</strong>, and ${esc(v.market)} (right-hand-drive, stricter regulators) has been given <strong>no committed date at all</strong>. HW3 owners here were promised FSD years ago and still have none. Realistically: late 2026, 2027, or never. We're not being mean; we're being <em>accurate</em>, which is worse.</div>` +
      `<div class="doom-luck">${luck}</div>` +
      `<div class="doom-adv">${adv}</div>` +
      `<div class="doom-foot">…but hey, <strong>maybe</strong>. Tap for more bad news. 🔁</div>` +
    `</div>`;
    const box = $("doomBox");
    if (box) {
      const go = (e) => { e.preventDefault(); renderDoom(el, v, true); };
      box.addEventListener("click", go);
      box.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); });
    }
  }
  // The FSD half of the hero's two-up header — a SEPARATE predicted date (or honest "no date"),
  // so software-update timing and FSD-version timing are never conflated.
  // is the FSD update riding along in the SAME build as the next software update?
  function fsdIsBundled(osPred, fsd) {
    return !!(fsd && fsd.bundledWith && !fsd.promised && !fsd.capped && !fsd.sameFsd && osPred &&
      (fsd.bundledWith === osPred.targetLabel || +new Date(fsd.medianDate) === +new Date(osPred.medianDate)));
  }

  function renderFsdPred(osPred, fsd) {
    const verEl = $("fsdPredVer"), dateEl = $("fsdPredDate"), winEl = $("fsdPredWindow"), quipEl = $("fsdPredQuip");
    const block = document.querySelector(".hpred-fsd");
    if (!verEl || !dateEl || !winEl) return;
    const v = av();
    const set = (cls, ver, date, win, state) => {
      if (block) block.className = "hpred hpred-fsd" + (cls ? " " + cls : "");
      verEl.textContent = ver ? "· " + ver : "";
      dateEl.textContent = date;
      winEl.textContent = win;
      if (quipEl) quipEl.textContent = state ? fsdPredQuip(state, v ? v.market : "") : "";
    };
    if (!v || !fsd || fsd.unavailable) { set("fsd-none", "", "—", "no FSD data for this car", ""); return; }
    if (isDownUnderHW3(v) || fsd.promised) { set("fsd-none", fsd.targetLabel, "No committed date", `promised for HW3 in ${v.market}, never delivered`, "promised"); return; }
    if (fsd.capped) { set("fsd-none", "", "Not coming", `${v.hardware} can't run newer FSD — capped`, "capped"); return; }
    // car has no FSD plan — feature stays dormant regardless of which build lands
    if (fsd.notEntitled) { set("fsd-same", fsd.targetLabel, "Needs an FSD plan", `your car can run ${fsd.targetLabel}, but FSD activates only with a purchase/subscription`, "notEntitled"); return; }
    // your upcoming software update is a maintenance build — no FSD change
    if (fsd.sameFsd) { set("fsd-same", fsd.current || "", "No FSD change yet", `your next software update keeps FSD ${fsd.current || "as-is"}`, "same"); return; }
    if (fsdIsBundled(osPred, fsd)) { set("fsd-bundled", fsd.targetLabel, Predict.fmtDate(fsd.medianDate), "🎁 same build as your next software update ↑", "bundled"); return; }
    const win = fsd.mode === "gated"
      ? "⚠️ modelled regulatory window — least certain"
      : (fsd.mode === "current" ? "next point release · " : "later build than your next update · ") + "Most likely " + shortDate(fsd.p10Date) + " – " + shortDate(fsd.p90Date);
    set("", fsd.targetLabel, Predict.fmtDate(fsd.medianDate), win, fsd.mode === "gated" ? "gated" : "dated");
  }

  // the software card's one-line tag: does THIS software update change your FSD version?
  function renderOsFsdTag(osPred, fsd) {
    const el = $("osFsdTag"); if (!el) return;
    if (fsd && fsd.notEntitled) {
      el.className = "hpred-tag tag-fsd-no";
      el.textContent = "🧠 FSD not enabled on this car";
    } else if (fsdIsBundled(osPred, fsd)) {
      el.className = "hpred-tag tag-fsd-yes";
      el.innerHTML = `🧠 also bumps <strong>FSD ${esc(fsd.targetLabel)}</strong> — see FSD card`;
    } else {
      el.className = "hpred-tag tag-fsd-no";
      el.textContent = "🧠 FSD version unchanged in this build";
    }
  }

  function renderFsdSummary(osPred, fsd) {
    const el = $("fsdSummary"); if (!el) return;
    const v = av(); if (!v) { el.innerHTML = ""; return; }
    if (isDownUnderHW3(v)) { renderDoom(el, v, false); return; }   // 🇦🇺/🇳🇿 + HW3 → the give-up special
    if (fsd === undefined) { try { fsd = Predict.predictNextFSD(car(), today); } catch (e) { fsd = null; } }
    if (!fsd || fsd.unavailable) { el.innerHTML = ""; return; }
    if (fsd.promised) { el.innerHTML = `<div class="fsum fsum-promised">🤷 <strong>FSD ${esc(fsd.targetLabel)} — promised, no timeline.</strong> ${esc(fsd.note || "")}</div>`; return; }
    if (fsd.capped) { el.innerHTML = `<div class="fsum fsum-capped">🪚 <strong>FSD:</strong> ${esc(fsd.current || "your version")} is the end of the line for your ${esc(v.hardware)} hardware — Tesla caps it here.</div>`; return; }
    if (fsd.notEntitled) {
      el.innerHTML = `<div class="fsum fsum-same">🔑 <strong>Your car can run FSD ${esc(fsd.targetLabel)}, but it isn't enabled.</strong> FSD activates only with a <strong>purchase or subscription</strong>. Your software updates still arrive on their normal schedule — the FSD features just stay dormant until you add a plan. (Set "Do you have FSD?" to update this.)</div>`;
      return;
    }
    if (fsd.sameFsd) {
      el.innerHTML = `<div class="fsum fsum-same">🧰 <strong>No FSD change in your next software update.</strong> Your next build${fsd.bundledWith ? ` (${esc(fsd.bundledWith)})` : ""} is a maintenance release — it keeps <strong>FSD ${esc(fsd.current || "as-is")}</strong>. New FSD versions only arrive in <em>some</em> software builds; a newer one will land in a future build Tesla hasn't shipped yet.</div>`;
      return;
    }
    if (fsdIsBundled(osPred, fsd)) {
      el.innerHTML = `<div class="fsum fsum-yay">🎉 <strong>Your next software update bumps FSD to ${esc(fsd.targetLabel)}.</strong> It ships <em>inside</em> ${esc(osPred.targetLabel)} — so this is one of those builds where the software update <em>and</em> a new FSD version land on the same day.</div>`;
    } else if (fsd.mode === "current") {
      el.innerHTML = `<div class="fsum">🧭 You're on the newest FSD (<strong>${esc(fsd.current)}</strong>). Next point release (${esc(fsd.targetLabel)}) projected around <strong>${shortDate(fsd.medianDate)}</strong> — it'll ride inside a future software build.</div>`;
    } else {
      el.innerHTML = `<div class="fsum">🎯 <strong>FSD ${esc(fsd.targetLabel)}</strong> lands <em>later</em> than your next software update — around <strong>${shortDate(fsd.medianDate)}</strong>${fsd.laterBuild ? `, inside build ${esc(fsd.laterBuild)}+` : ""}. Your next maintenance update comes first; the new FSD rides in a later build.</div>`;
    }
  }

  function render() {
    const a0 = av();
    if (ui.trackRegion == null) ui.trackRegion = a0 ? a0.market : "";   // default tracking views to YOUR region
    setTopConnect(!!(a0 && a0.connected), !!(a0 && a0.connected && a0.optedIn));
    if (!av()) { renderEmptyState(); return; }
    if ($("quickStart")) $("quickStart").hidden = true;   // a car exists → the garage takes over
    if ($("lede")) $("lede").hidden = true;               // returning user: drop the marketing lede, reclaim the space
    showPredictionZone(true);                             // a car exists → reveal the prediction zone
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
    renderRolloutPace();
    renderHumour();
    renderGrief();
    renderUpdateAlert();
    return pred;
  }

  // First visit (no car): single funnel — show only the lede + quickStart, and hide the entire
  // prediction zone (header, hero, garage+charts grid, guess game) until there's a car to fill it.
  function showPredictionZone(show) {
    ["zonePred", "heroCard", "predGrid", "guessCard"].forEach(id => { const el = $(id); if (el) el.hidden = !show; });
  }
  function renderEmptyState() {
    showPredictionZone(false);
    if ($("quickStart")) { $("quickStart").hidden = false; wireQuickStart(); }   // front-and-centre no-login path
    if ($("lede")) $("lede").hidden = false;              // no car yet → show the value-prop lede
    $("curveVer").textContent = "";
    $("heroEyebrow").textContent = "Welcome to wenFSD";
    $("heroDate").textContent = "wen FSD? Let's find out.";
    $("heroWindow").textContent = "";
    if ($("osPredVer")) $("osPredVer").textContent = "";
    if ($("fsdPredVer")) $("fsdPredVer").textContent = "";
    if ($("fsdPredDate")) $("fsdPredDate").textContent = "—";
    if ($("fsdPredWindow")) $("fsdPredWindow").textContent = "add a car to see both dates";
    if ($("osPredQuip")) $("osPredQuip").textContent = "";
    if ($("fsdPredQuip")) $("fsdPredQuip").textContent = "";
    if ($("osFsdTag")) $("osFsdTag").textContent = "";
    if ($("osDetail")) $("osDetail").hidden = true;
    if ($("fsdDetail")) $("fsdDetail").hidden = true;
    if ($("ringCap")) $("ringCap").hidden = true;
    $("ringDays").textContent = "—"; $("ringFg").style.strokeDashoffset = 2 * Math.PI * 78;
    $("confRow").innerHTML = "";
    if ($("heroFlavor")) $("heroFlavor").innerHTML = flavorPick("empty", [
      `😤 You've asked "wen FSD" one too many times. We built you a calculator. Add your Tesla.`,
      `🔮 Step right up. Add your Tesla and we'll tell you "two weeks" — but with actual math.`,
      `🚗 Add your car. Yes, the whole VIN. No, we won't sell it to anyone. (We can't even afford to.)`,
      `📡 Your Tesla is out there, asking "wen FSD" into the void. Connect it and let's get answers.`,
      `🍿 Add a vehicle and find out if you're "first wave" or "suffering in silence on {nope}".`.replace("{nope}", "an ancient build"),
      `🧮 Pick your car above. We'll convert "soon™" into an actual date with actual error bars.`,
      `🛋️ No login, no VIN, no commitment. It's the least Tesla-like experience you'll have all day.`,
      `🔭 Tell us your model, year and version. We'll tell you "two weeks" — but, like, responsibly.`,
    ]);
    $("heroNote").innerHTML = "👆 <strong>Use the quick form above</strong> — just your model, year &amp; current software. <strong>No login, no VIN, nothing leaves your browser.</strong> We'll predict your next software update and next FSD version, with confidence bands. (Prefer to auto-track or use your VIN? Those are optional, in the garage below.)";
    $("predictTips").innerHTML = "";
    $("curveChart").innerHTML = svgEmpty("Add a vehicle to see its rollout curve");
    $("distChart").innerHTML = svgEmpty("Add a vehicle to see the probability distribution");
    $("guessResult").classList.remove("show"); $("guessResult").innerHTML = "";
    renderTable();
    renderRegions();
    renderReleaseNotes();
    renderRolloutPace();
    renderHumour();
    renderGrief();
    renderUpdateAlert();
  }
  function svgEmpty(msg) {
    return `<div class="chart-empty">${esc(msg)}</div>`;
  }

  function renderNoPrediction(pred) {
    $("heroEyebrow").textContent = (ui.target === "fsd" ? "Next FSD version" : "Next update") + " for " + (av().nickname || "your car");
    $("heroDate").textContent = pred.capped ? "Not coming" : "Unknown";
    $("heroWindow").textContent = pred.capped ? "hardware-limited" : "";
    if ($("osPredVer")) $("osPredVer").textContent = "";
    if ($("osPredQuip")) $("osPredQuip").textContent = "";
    if ($("osFsdTag")) $("osFsdTag").textContent = "";
    if ($("osDetail")) $("osDetail").hidden = true;
    if ($("fsdDetail")) $("fsdDetail").hidden = true;
    if ($("ringCap")) $("ringCap").hidden = true;
    renderFsdPred(pred, null);
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
    renderRolloutPace();
    renderHumour();
    renderGrief();
    renderUpdateAlert();
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
  const MEME = ["Two weeks. Trust me bro. 🙏", "It's basically already on the truck.", "Source: a guy on the forums.", "Definitely this OTA. Probably. Maybe.", "Patience, you magnificent early-adopter.", "Coming right after the robotaxis. 🚕", "Soon™ — on Elon Time™.", "Two more weeks. (The two weeks renew automatically.)",
    "It's in the next build. The one after the next one.", "Leaked on X by a guy with a rocket emoji. Ironclad.", "The wizard said two weeks. The wizard always says two weeks. 🧙", "Your car can feel you refreshing. It's getting embarrassed.", "So close you can almost taste the regression bugs.", "Optimus will hand-deliver it. Standby. 🤖", "Imminent. In the geological sense.", "The OTA gods are merely buffering. 🙏", "Any minute now. For a generous definition of 'minute'.",
    "It's coming. Like Christmas, but you don't know the year. 🎄", "Two weeks — now with a confidence interval of ± two weeks.", "Closer than it appears. The mirror is lying, but still.", "Your update and the robotaxi are in a footrace. Both pulled a hamstring. 🏃", "It's queued. Behind everyone in California. And Texas. And Norway. 🇳🇴", "Elon liked a tweet about it. That's basically a changelog. ❤️", "Downloading at the speed of vibes. 📶", "Patience is a virtue. Tesla is testing exactly how virtuous you are.", "It's in beta. The beta is in beta. The beta's beta has a beta. ♾️", "Manifesting. Loudly. Into the software menu. 🔮",
    "Schrödinger's update: simultaneously rolling out and definitely not for you. 📦", "It's 90% rolled out. You are reliably, dependably, in the other 10%. 🎯", "The app says 'Up to date.' The app lies with the confidence of a used-car salesman. 📱", "Update ETA: after the Roadster, before the heat death of the universe. 🌌", "Your VIN is on a list. A long list. A suspiciously US-shaped list. 📋", "One firmware push away. Tesla just has 47 other things 'one push away' too.", "The changelog says 'minor bug fixes.' The bugs strongly disagree. 🐛", "Soon, comrade — the means of OTA production will be seized any day now. 🚩", "Buffering since the Cybertruck reveal. We've made our peace. ⏳", "It updates the moment you stop checking. So, never, because you'll never stop. 👀"];
  // region-agnostic Tesla/FSD meme one-liners — mixed into the hero flavour for variety
  const GENERIC = [
    "Still on {ver}? It's fine. FSD is 'two weeks' away. It's always two weeks away.",
    "{ver} → the robotaxis were promised first, and look how that's going. 🚕",
    "Refreshing the software menu doesn't make it come faster. (You're still doing it. So are we.)",
    "Your car is 'Full Self-Driving (Supervised).' Heavy, heavy emphasis on <em>supervised</em>.",
    "It'll appreciate into an appreciating asset any day now. Any day. 📈",
    "Sentry Mode watched your car all night and still has no idea wen FSD either.",
    "Stuck on {ver}? At least Actually Smart Summon crossed the car park in under four minutes.",
    "Phantom braking for no reason builds character. The update builds… eventually.",
    "Elon said 'this year.' He didn't say which year. ⏳",
    "HW3 owners typing 'wen retrofit' into the void. We see you. 🫡",
    "The update is coming. The over-the-air gods are merely… buffering.",
    "{ver} → still no robotaxi, still no flying car, still refreshing. The dream lives. ✨",
    "Tesla Time conversion: stated ETA × π, rounded up to the next quarter.",
    "The car drove itself to the shops. Then it parked across two bays. Supervised! 🅿️",
    "Smart Summon is on its way. It took the scenic route. Through a hedge. 🌳",
    "Your yoke has opinions about roundabouts. The update has opinions about your patience.",
    "$99/month for the privilege of supervising a computer that's smarter than you. Bargain.",
    "It saw a plastic bag and slammed the brakes. World-changing technology. 🛍️",
    "Buy now — the price goes up Tuesday. (It always goes up Tuesday. There's always a Tuesday.)",
    "Cybertruck owners got it first. They've suffered enough; let them have this. 🔺",
    "The visualisation rendered three traffic cones that weren't there. Vibes-based driving.",
    "Regenerative braking gives energy back. The waiting gives nothing back. 🔋",
    "Grok was asked wen FSD. Grok also said two weeks. The machines have unionised. 🤝",
    "It's coming in the same update as the Roadster, the van, and world peace.",
    "Your Tesla has more compute than the Apollo missions and uses it to ignore you.",
    "Autopark found a spot, considered it, and emotionally withdrew. Relatable.",
    "{ver} → your car depreciated faster than the FSD timeline. Impressive, honestly. 📉",
    "The wipers came on. It was not raining. The wipers know something. 🌦️",
    "It detected a stop sign on a billboard and got philosophical about it. 🛑",
    "You bought the future. The future is buffering. Please hold. ⏳",
    "Cabin overheat protection kicked in. Your patience has no such protection. 🥵",
    "Lane-change signalled, reconsidered, signalled again. A true Libra. ♎",
    "Stuck on {ver}? Your software updates and your gym membership share a usage pattern.",
    "It can play Cuphead and fart noises but won't change lanes near a truck. Priorities. 💨",
    "The yoke turns. The wheel does not. We do not talk about the yoke. 🛞",
    "It's basically AGI, but for finding reasons not to update your specific car. 🤖",
  ];
  const REGION_FLAVOR = {
    "Australia": { flag: "🇦🇺",
      soon: ["Two weeks. Trust me, mate. 🦘", "She'll be right — a fortnight, tops.", "Basically here. Crack a tinnie. 🍺", "Soon-ish, bruz. Trust.", "Won't be a sec — go put the snags on. 🌭", "It's comin' quicker than a bin chicken on a chip. 🐦", "Any tick of the clock now, champ. ⏰", "Closer than a magpie in swooping season. 🐦‍⬛", "Hang about — it's nearly here, you legend.", "Coming faster than you can say 'where's the GST'.", "Reckon it lands before the next servo sausage sizzle. 🌭"],
      quips: ["Strewth — still on {ver}? She'll be right.", "Your car's more behind than a tradie on a Friday arvo.", "No dramas, wen FSD is basically here. *distant kangaroo noises*", "Still on {ver}? Yeah-nah, the update's comin', mate.", "Hooroo to {ver} — eventually.", "Tell 'em they're dreamin'… then check again tomorrow.", "Carn, Tesla. We're not getting any younger down here.", "It's coming faster than a magpie in September. 🐦",
        "Still on {ver}? Reckon it'll land between smoko and knock-off.", "Your update's doing a Bradbury — last in the queue, might still win. ⛸️", "Fair dinkum, {ver}'s older than a servo pie under the heat lamp. 🥧", "She's flat out like a lizard drinkin', that rollout. 🦎", "Yeah-nah it's close, but also yeah-nah it's RHD, so… nah. 🚗", "Drier than the Nullarbor out here on {ver}. Send update.", "Bit of a wait, but that's just Straya tax on everything, eh."] },
    "New Zealand": { flag: "🇳🇿",
      soon: ["Two weeks. Trust me, bro. 🥝", "Sweet as, basically rolling out.", "Yeah-nah-yeah, real soon.", "Chur, won't be long now.", "Munted wait, but she's coming, bro.", "Bee's knees — any day now, eh.", "Hard out, it's nearly here, bro.", "Lands before the jandals come off for winter. 🩴", "Couple sleeps away, ya beauty.", "Track stand — it's right round the corner, eh. 🚲"],
      quips: ["Still on {ver}? Sweet as, it's coming.", "Yeah nah yeah, it's basically rolling out, bro.", "Chur — won't be long now, eh.", "Still on {ver}? Hard. Hang in there, bro.", "She's a good keen update. Coming. Promise.", "Choice. Now we wait. Choice.",
        "Aussie gets it first again? Yeah, nah, classic. 🐑", "Still on {ver}? Egg, mate. The update's the same egg. 🥚", "Stink one, bro — {ver}'s ancient. But she'll come right.", "Jandals on, kettle's boiled, still no update. 🩴", "Population: 5 million. Teslas updated this week: possibly 3.", "Box of birds once it lands. Just gotta wait for Aus to finish, eh."] },
    "United States": { flag: "🇺🇸",
      soon: ["Two weeks. Trust me bro. 🦅", "It's coming. Probably this OTA. 🫡", "Soon™. Very soon™.", "Faster than you can say 'supervised'.", "Locked, loaded, and rolling. Allegedly. 🇺🇸", "Elon tweeted a rocket. That counts. 🚀", "Inbound like a drive-thru order. 🍔", "Any minute, freedom-units of soon. 🦅", "Closer than the next price change (and those are frequent).", "It's basically already in your driveway. Manifest it. ✨"],
      quips: ["Still on {ver}? That's downright un-American. 🦅", "Freedom units of patience required.", "Refresh harder. That always works.", "Still on {ver}? Elon tweeted, so… any minute now.", "It's coming faster than you can say 'Full Self-Driving (Supervised, terms apply)'.", "Manifest the update. Believe.", "Your neighbor has it. Of course they do.",
        "You get builds first and you STILL complain. Bald eagle sheds a tear. 🦅", "Still on {ver}? Texas got it last Tuesday. Texas gets everything.", "Drive-thru's faster than this rollout, and that's saying something. 🍔", "It's your god-given right to a point release. Demand it.", "Stuck on {ver}? Tweet at Elon. Worked for that one guy, probably.", "Robotaxi's launching in your city any day. So's the update. Same energy."] },
    "Canada": { flag: "🇨🇦",
      soon: ["Two weeks. Trust me, bud. 🍁", "It'll be here before the next Tims run. ☕", "For sure for sure, soon.", "Give'r — almost there.", "Soon, bud. Sorry for the wait. 🙏", "Beauty — basically out, eh.", "Soon as the snow clears. So, May. ❄️", "Closer than the puck at a faceoff. 🏒", "Two-four says it lands this long weekend. 🍺", "Almost there, bud, no word of a lie."],
      quips: ["Still on {ver}, eh? Sorry aboot that.", "Patience, bud — it's coming, for sure for sure.", "It'll be here before the next double-double. ☕", "Still on {ver}? Beauty. Hang tight, bud.", "Take off, {ver}. Eventually, eh.", "It's coming, dontcha know.",
        "Update's frozen solid out here. Give'r a sec to thaw. ❄️", "Still on {ver}? It's a real gong show, bud.", "Coming slower than a Zamboni between periods. 🏒", "Sorry. Sorry. It's late. Sorry. (Very Canadian apology.)", "Two-four says it lands this weekend. 🍺", "It'll be here, bud — right after the Leafs win the Cup. So… eventually."] },
    "Europe": { flag: "🇪🇺",
      soon: ["Two weeks*. (*pending homologation) 📋", "Soon — once 17 agencies sign off. 🇪🇺", "Approval imminent. Allegedly.", "Bald. (That's 'soon' in German. Cope.)", "Soon, after the consultation period. 📝", "Imminent — in three official languages. 🗣️", "Soon — subject to a working-group sub-committee. 📚", "Bientôt. Bald. Presto. Pick a language to wait in. 🗣️", "Any decade now, pending impact assessment. 📊", "Closer than EU-wide phone-charger standardisation took. 🔌"],
      quips: ["Still on {ver}? Blame the regulators. 📋", "Approval pending since approximately forever.", "It's coming — after a public consultation period.", "Still on {ver}? The paperwork is, how you say, in progress.", "Coming soon to a TÜV-approved vehicle near you.", "GDPR-compliant patience required.",
        "FSD in Europe: a beautiful theoretical concept, like a balanced budget.", "Still on {ver}? The UNECE working group will get back to you. Eventually. 📚", "Roundabout handling pending approval from every roundabout individually. 🔄", "Your update is stuck in committee. The committee is stuck in another committee.", "It'll arrive precisely when the regulators mean it to. ⏳🧙", "Autobahn-ready software, delivered at the speed of bureaucracy. 🐌"] },
  };
  function flavorFor(market) { return REGION_FLAVOR[market] || REGION_FLAVOR["United States"]; }
  function heroFlavorLine(pred) {
    const v = av(); if (!v) return "";
    const fl = flavorFor(v.market), d = pred.daysToMedian;
    if (d != null && d >= 8 && d <= 18) return `${fl.flag} ${flavorPick("soon:" + v.market, fl.soon.concat(MEME))}`;   // the meme zone
    const q = flavorPick("quip:" + v.market, fl.quips.concat(GENERIC)).replace(/\{ver\}/g, esc(v.installedVersion || "your build"));
    return `${fl.flag} ${q}`;
  }

  // ---- the two hero prediction cards: funny + RELENTLESSLY clear that these are guesses ----
  // Picked stable-per-load (fresh on refresh), keyed by market so switching cars re-rolls.
  const OS_PRED_QUIPS = [
    "Our crystal ball's best guess — not a Tesla announcement. Tesla doesn't do those. 🔮",
    "A prediction, not a promise. We don't work at Tesla; we just refresh the menu like you do.",
    "Modelled, not confirmed — if Tesla published real dates, 'two weeks' would be out of a job.",
    "Educated guess, heavy on the guess. Tesla's release calendar is written in disappearing ink. 🖊️",
    "A forecast. The only 'official' Tesla date is the one that just slipped to next quarter.",
    "Somewhere between 'soon™' and 'on Elon Time™' — we did the maths so you can cope. ⏳",
    "A projection. Treat it like FSD itself: supervise it, don't trust it blindly. 👀",
    "Best numbers we've got. Tesla's actual ship date remains a closely guarded state secret. 🤫",
    "We modelled it; we did not pinky-promise it. Nobody at Tesla signed off on this. ✍️",
    "A forecast with error bars — which already makes it more honest than 'two weeks'. 📏",
    "Statistically literate hope. The best kind. 🤓",
    "If it's late, blame the rollout curve. If it's early, you're welcome. 😎",
  ];
  const OS_PRED_REGION = {
    "Australia": ["A guess, not gospel — and {m} gets the build only after the US finds all the bugs. 🐛", "Predicted, not promised. Down here, 'soon' is measured in seasons. ☀️→🍂", "Forecast, mate. RHD markets sit last in the OTA queue, behind every roundabout on Earth. 🔄"],
    "New Zealand": ["Predicted, not promised — and Australia gets it before you, as is tradition, bro. 🐑", "A guess. Population 5 million; Teslas updated this week: possibly 3. Calibrate accordingly.", "Forecast only, eh. Sweet as — just don't hold your breath waiting on it. 🥝"],
    "United States": ["A prediction — but you're first in line, so gloat responsibly. 🦅", "Best guess. You'll probably have it before you finish reading this sentence. Probably.", "A forecast, not a tweet from Elon — and those are somehow less reliable. 🚀"],
    "Canada": ["A guess, bud — sorry if it's off. Should land before the next Tims run. Probably. ☕", "Predicted, not promised. Patience, eh — it's a beauty when it finally shows up. 🍁"],
    "Europe": ["A forecast — pending homologation, consultation, and 17 agencies signing off. 🇪🇺", "Predicted, not promised. The real date lives in a committee, which lives in another committee. 📚", "An estimate, delivered at the stately speed of bureaucracy. 🐌"],
  };
  function osPredQuip() {
    const v = av(); if (!v) return "";
    const arr = OS_PRED_QUIPS.concat(OS_PRED_REGION[v.market] || []);
    return flavorPick("osPredQuip:" + v.market, arr).replace(/\{m\}/g, v.market);
  }
  const FSD_PRED_QUIPS = {
    promised: ["We refuse to predict a date Tesla never gave — this is the literal opposite of a promise. 🫥", "No date to forecast, because Tesla announced none. We won't invent one (unlike some trackers). 🤥", "Nothing here to predict but vibes, and the vibes are, frankly, dire. 💀"],
    bundled: ["Predicted to ride shotgun in your next OS update — same date, same caveats, no guarantees. 🎁", "A guess: it's bundled in, so if the software slips, FSD slips with it. One disappointment, one for free.", "Forecast — it ships inside the build above. Two predictions, one ETA, zero promises."],
    capped: ["Nothing to predict — your hardware tapped out. We can't forecast a ghost. 🪦", "No forecast possible: Tesla capped this hardware. The future arrived for everyone else. 🚪"],
    same: ["Your next software update is bug-fixes and vibes — FSD stays exactly put. 🧰", "Maintenance build incoming. The robotaxi dream rides a *later* parcel. 📦", "No new FSD this round. Most builds are like this; the shiny one comes later.", "FSD holds steady. A newer version lands in a future build Tesla hasn't shipped. ⏳"],
    notEntitled: ["The hardware's ready and willing. Your wallet has the floor. 💳", "Software updates: free. FSD: a small fortune. The dormant module waits patiently. 😴", "Your car *could* drive itself, if you'd just sign the cheque. 🖊️", "FSD's installed and napping — it wakes up when you buy the alarm clock. ⏰"],
    gated: ["A modelled regulatory window — i.e. a guess about when the bureaucrats finish reading. 📋", "Predicted, not promised, and gated behind regulators who do nothing in a hurry. ⏳"],
    dated: ["A forecast — and FSD dates are Tesla's most theoretical numbers, which is really saying something.", "Predicted, not promised. 'Full Self-Driving' is supervised; so is this estimate. 👀", "Educated guess. FSD ETAs have a half-life shorter than a phantom brake. 🛑", "Modelled, not confirmed — Elon said 'this year', he just declined to specify which one. 📆", "We'd stake our reputation on it, but we've seen Tesla's roadmap. 🫣", "An estimate. The robotaxi keynote was also, technically, an estimate. 🎤"],
  };
  function fsdPredQuip(state, market) {
    const arr = FSD_PRED_QUIPS[state] || FSD_PRED_QUIPS.dated;
    return flavorPick("fsdPredQuip:" + state + ":" + market, arr);
  }

  // Rotating funny card subtitles — picked stable-per-load (fresh on refresh) so the whole
  // page reads differently every visit. Set the text content of decorative .card-sub spans.
  const SUBS = {
    whenSub: ["probability by day (science!)", "your wen, quantified", "a graph of pure hope 📈", "statistically: soon-ish", "the suspense, plotted", "every day's odds, ranked by cope", "maths, but make it anxious", "a bell curve of yearning 🔔", "the only Tesla timeline with error bars", "feelings, but with axes"],
    shotSub: ["wen, exactly? Put a date on it.", "no take-backs, hero 🎯", "easy to say 'two weeks' — prove it", "stake your bragging rights", "the model is watching 👀", "calling it is free; being wrong is forever", "bet the house (the house is a Tesla)", "your turn to say 'trust me bro'", "loser buys the Supercharger session ⚡"],
    fsdRegSub: ["who gets it first (probably not you)", "the global FSD pecking order", "a leaderboard of smugness", "spoiler: the US, again 🇺🇸", "geography decides your autonomy", "find out exactly how jealous to be", "your region is your destiny 🌏", "luck of the regulatory draw 🍀", "rank your continent's heartbreak", "the autonomy hunger games 🏹", "right region, right hardware, right vibes 🎰", "blame the regulators, then refresh anyway"],
    osRegSub: ["how far behind the US wave each market runs", "the global queue, ranked by suffering", "who's eating Tesla's dust, by region 🌫️", "days of lag, served cold", "how late your continent runs", "the OTA pecking order (you're near the back)"],
    paceScope: ["how many cars are updating", "the fleet, escaping old builds", "cars-per-day clawing their way forward", "rollout velocity, such as it is", "how fast the herd is moving 🐂", "the great migration off your build"],
    calSub: ["back-tested against real tracker history", "marking our own homework (honestly)", "how wrong we've been, quantified 📐", "receipts for our guessing", "we grade ourselves on a curve (an S-curve)", "proof we're not just vibing"],
    // NOTE: the data/trust cards (OS rollout, calibration, rollout pace) deliberately keep their
    // plain static subtitles from the HTML — humour there reads as less credible (per the audit).
    footQuip: [
      "Built by people who also check the software menu every morning. We are not well.",
      "No Teslas were woken in anger during the making of this site. A few were gently asked their version.",
      "If this site is wrong, remember: so was every \"two weeks\" since 2016. We're in good company.",
      "Powered by hope, S-curves, and an unhealthy relationship with the refresh button.",
      "wenFSD: because \"soon\" was not a satisfying answer and neither was \"trust me bro\".",
      "Disclaimer: staring at the prediction will not make the update arrive faster. We've tested this. Extensively.",
      "Not affiliated with Tesla, who would frankly be horrified by our candour.",
      "We aggregate public trackers and feelings. The trackers are public. The feelings are ours.",
      "Open source, so you can read exactly how the sausage of cope is made. 🌭",
      "Every figure here is one Elon tweet away from being gloriously wrong.",
    ],
  };
  // "Why wenFSD beats the trackers?" → "It doesn't. But at least…" (cycles on click + per load)
  const AT_LEAST = [
    "we admit it.",
    "it's free.",
    "it won't give you an STD.",
    "it won't turn your Tesla into a Ford Ranger.",
    "it never said \"funding secured.\"",
    "it won't phantom-brake on the freeway.",
    "it doesn't cost $99 a month to be disappointed.",
    "it won't try to summon itself into a parked Kia.",
    "it's never once said \"two weeks\" and meant it — but at least it's honest about lying.",
    "it won't get recalled by the regulator.",
    "it didn't promise you a robotaxi in 2020.",
    "it won't brick over-the-air during a thunderstorm.",
    "it won't deduct the FSD price from your car's resale value overnight.",
    "it won't slam the brakes for a plastic bag and call it 'safety'.",
    "it doesn't have a yoke.",
    "it won't open a falcon-wing door into your garage ceiling.",
    "it won't ask you to keep your hands on the wheel while it drives.",
    "it never tweeted anything that moved a stock price.",
    "it won't update itself at 3am and move all your buttons into a submenu.",
    "it can't be repossessed by an app.",
    "it won't ship a feature, remove it, then sell it back to you.",
    "your insurance premium won't read this site and panic.",
    "it won't rename a perfectly good button into a fourth-level submenu.",
    "it won't decide, mid-merge, that the truck beside you is a suggestion.",
    "it never said the robotaxis would print you money while you sleep. 💸",
    "it won't lock you out of your own car to install at 3am.",
    "it doesn't get a software update that removes features you paid for.",
    "it won't gaslight you with 'improvements to overall stability'.",
    "it has never, not once, blamed the user for phantom braking.",
    "it won't replace your stalk with a touchscreen and call it progress.",
    "it doesn't depreciate the moment you drive it off the lot. (It's a website.)",
    "it will never, ever, sell your data to an insurer. We can barely store it.",
  ];
  function rollWhyAnswer(fresh) {
    const el = $("whyAnswer"); if (!el) return;
    const pick = fresh ? rnd(AT_LEAST) : flavorPick("whyAnswer", AT_LEAST);
    el.innerHTML = `It doesn't. <span class="wa-but">But at least <em>${pick}</em></span>`;
  }
  const TAB_TITLES = ["wenFSD — two weeks, probably", "wenFSD · refreshing won't help (you'll refresh anyway)", "wenFSD — wen, exactly?", "wenFSD · soon™", "wenFSD — trust me bro", "wenFSD · coming right after the robotaxis", "wenFSD — your update is in another castle", "wenFSD · still on the same build, huh", "wenFSD — the answer is two weeks", "wenFSD · (Supervised) (heavily)", "wenFSD — manifesting your OTA", "wenFSD · don't refresh. okay, refresh.", "wenFSD — on Elon Time™", "wenFSD · the update is buffering, spiritually", "wenFSD — go check the software menu, we'll wait", "wenFSD · ± two weeks, with feeling", "wenFSD — yes, California has it already", "wenFSD · phantom-brake-free since launch"];
  // Rotating cheeky kicker line under every data-card header — fresh on each page load, so the
  // whole site reads differently every refresh. Pure text (emojis fine); {region} is filled in.
  const KICK = [
    "Brought to you by hope, spite, and the refresh button.",
    "Reading this changes nothing. We respect the dedication anyway.",
    "Scientifically rigorous. Emotionally devastating.",
    "Now with 100% more cope per scroll.",
    "Tesla won't tell you this. We will, badly.",
    "Data so fresh the regulators haven't banned it yet.",
    "If knowledge is power, this section is a mild AA battery. 🔋",
    "Spoiler: it's still two weeks away.",
    "{region}: where updates go to think about it. 🤔",
    "Somewhere, someone in California already has this. Try not to think about them.",
    "Elon has not personally approved this section. Or any section.",
    "We did the maths so you can do the despair.",
    "Accurate to within one geological epoch. 🪨",
    "Free, like the FSD trial you forgot to cancel. (This one's actually free.)",
    "More reliable than Smart Summon, lower bar than you'd think.",
    "No yokes were harmed. No updates were delivered.",
    "This won't make it arrive faster. Nothing will. Carry on.",
    "Peer-reviewed by guys on the forums. 🫡",
    "Built different. Updated… eventually.",
    "Stare all you like — the OTA gods remain unmoved.",
    "Certified RHD-grade disappointment, where applicable. 🚗",
    "Patience not included. Batteries (and patience) sold separately.",
    "As seen on a tracker, reinterpreted with feelings.",
    "{region} edition: same data, more sighing.",
    "We'd say 'coming soon' but we have standards. Low ones, but standards.",
    "Refreshing this won't help. You know that. We know that. Refresh away.",
    "Numbers cold, takes lukewarm, hope rationed responsibly.",
    "Sponsored by nobody. Endorsed by no one. Believed by a few.",
    "Each figure hand-curdled from public trackers and raw cope.",
    "{region}: technically on the roadmap, spiritually on a Post-it. 📝",
    "We checked twice so you'd only have to despair once.",
    "Updates this section more often than Tesla updates your car. Low bar. 🏋️",
    "100% organic, free-range, grass-fed disappointment. 🌾",
    "If this were any more honest it'd need a content warning.",
  ];
  function injectKickers() {
    const region = av() ? av().market : "your region";
    // distinct line per card this page-load (stride coprime with pool size ⇒ no repeats);
    // start index is stable per load but re-rolls on refresh, so the page stays fresh.
    const start = flavorPick("kickStart", KICK.map((_, i) => i));
    // Keep kickers on the playful/engaging cards only; the data & trust cards stay plainly
    // authoritative (firmware, calibration, region rollout, pace, release notes) — per the audit.
    const SKIP_KICK = new Set(["griefCard", "firmwareCard", "calibrationCard", "regionCard", "paceCard", "releaseNotesCard"]);
    const cards = [...document.querySelectorAll("section.fleet-card, section.guess-card")].filter(c => !SKIP_KICK.has(c.id));
    cards.forEach((card, idx) => {
      const hdr = card.querySelector(":scope > .card-h, :scope > .card-h-row");
      if (!hdr) return;
      let k = card.querySelector(":scope > .card-kicker");
      if (!k) { k = document.createElement("p"); k.className = "card-kicker"; hdr.insertAdjacentElement("afterend", k); }
      k.textContent = KICK[(start + idx * 7) % KICK.length].replace(/\{region\}/g, region);
    });
  }
  // Rotating section HEADLINES — every header re-rolls on refresh (stable while you click). Each
  // pool keeps the original plain title as one option, and every variant still clearly says what
  // the card IS (so the page never becomes unnavigable — just funnier).
  const HEADLINES = {
    // four zone headers — now rotate too (they were the last flat thing on the page)
    zh_pred: ["📍 Your prediction", "🔮 The main event", "🎯 Your 'wen', dated", "📅 The whole point", "🚗 Your update, foretold", "🔮 Crystal ball, but make it maths", "📍 What you actually came for", "🕯️ Your hope, with error bars"],
    zh_explore: ["🛰️ Explore the fleet", "🌍 The rest of the herd", "🔭 Fleet-wide snooping", "🌏 Who got it before you", "📊 Everyone else's business", "🛰️ Spying on the whole fleet (politely)", "🌍 Comparison is the thief of joy 🌍", "🔭 Other people's good news"],
    zh_community: ["🫂 Community", "😤 The support group", "🕯️ Group therapy", "🍿 Misery, aggregated", "🤝 You are not alone (you're a little alone)", "🫂 Fellow sufferers", "🕯️ The waiting room", "😩 Pain, but social"],
    zh_trust: ["🔬 How it works &amp; trust", "🧪 The honest bit", "📖 Show your work", "🤓 The maths, exposed", "🔍 No black box, no BS", "🔬 Receipts &amp; reassurance", "🧾 Where we mark our own homework", "🔬 Trust, but verify (please do)"],
    hdr_qs: ["⚡ Get your prediction in 10 seconds", "⚡ Your 'wen', in 10 seconds flat", "⚡ No login, no VIN, no nonsense", "⚡ The quick, painless, no-account way", "⚡ Predict it before the kettle boils ☕", "⚡ Two taps to your two weeks", "⚡ Faster than a Supercharger queue 🔌", "⚡ Quicker than Tesla's 'arriving soon'", "⚡ Skip the forums, get a real date", "⚡ Less effort than a phantom brake 👻"],
    hdr_garage: ["Your garage", "Your fleet (of one)", "The car in question", "Your pride and depreciating joy", "Subject vehicle 🚗", "The patient 🩺", "Your rolling beta test", "Exhibit A 🚗", "Your four-wheeled group chat with Elon", "The defendant 🚗"],
    hdr_curve: ["Rollout S-curve", "The S-curve of yearning", "How the build spreads (slowly)", "Adoption curve, plotted in hope", "The shape of the wait 📈", "Maths cosplaying as hope 📈", "The hopium curve", "Statistically, you're on it somewhere", "Where you sit in Tesla's queue 📈"],
    hdr_when: ["When exactly?", "When, exactly?", "Wen? (the eternal question)", "Put a date on it", "The whole reason you're here", "Your 'two weeks', quantified", "Soon™, with error bars", "An actual date, allegedly", "Wen, mathematically"],
    hdr_shot: ["Call your shot 🎯", "Put your money where your wen is 🎯", "Bet on it, hero 🎯", "Stake your reputation 🎯", "Your turn to say 'trust me bro' 🎯", "Prove the forums wrong 🎯", "Two weeks, but with a paper trail 🎯", "Out-guess the maths 🎯"],
    hdr_grief: ["The Five Stages of wenFSD Grief", "The Five Stages of OTA Grief", "Where are you in the grieving process?", "Five Stages of 'still on the same build'", "Grief, but make it firmware 🕯️", "Kübler-Ross: the firmware edition 🕯️", "The five stages of 'check again' 🕯️", "Bereavement, over-the-air"],
    hdr_fsdreg: ["FSD by region &amp; hardware", "FSD: who's allowed nice things, by region", "The autonomy class system 🌍", "FSD eligibility: region, hardware &amp; sheer luck 🍀", "Where (and whether) FSD shows up", "Geography is destiny (so is your HW) 🌍", "Who got picked for the FSD lottery 🎰", "FSD: a tale of regulators and luck 🍀"],
    hdr_notes: ["Release notes", "What's actually in each build", "The changelog, decoded", "'Minor improvements', allegedly 📝", "What each build really ships", "'Bug fixes and improvements' (translated)", "The patch notes, with subtitles 📝", "What the build menu won't tell you"],
    hdr_osreg: ["OS rollout by region", "Who's behind whom (by region)", "The global lag leaderboard", "OS rollout, ranked by suffering", "How late your continent runs ⏱️", "The geography of waiting ⏱️", "US first, as is tradition 🇺🇸", "Your continent's place in the queue"],
    hdr_pace: ["Rollout pace", "How fast the fleet's moving", "Cars escaping old builds, per day", "Rollout velocity (such as it is)", "The great migration off your build 🐂", "Vehicles fleeing your firmware, hourly", "The exodus, in cars per day", "How fast everyone else is moving on"],
    hdr_fw: ["Fleet firmware tracker", "What the fleet's running right now", "Who's on what, fleet-wide", "The build distribution, live-ish", "Firmware spread across the herd 📊", "Everyone else's version, basically", "The fleet's current wardrobe 📊"],
    hdr_feed: ["Recent rollout activity", "Fresh sightings", "What just moved", "Live-ish rollout sightings 👀", "Cars updating in the wild", "Updates spotted in their natural habitat 👀", "Other people's good fortune, live"],
    hdr_cal: ["Model calibration", "Marking our own homework", "How wrong we've been, measured 📐", "Our receipts", "Proof we're not just vibing", "We graded ourselves (harshly) 📐", "The honesty audit 🧾"],
    hdr_lb: ["wen Leaderboard 🏆", "The smugness leaderboard 🏆", "Who's winning the wait 🏆", "Bragging rights, ranked 🏆", "First-wave royalty vs the rest 👑", "The 'I got it before you' board 🏆", "Smugness, league table 🏆"],
  };
  function rotateHeadlines() {
    for (const id in HEADLINES) { const el = $(id); if (el) el.innerHTML = flavorPick("hdr:" + id, HEADLINES[id]); }
  }
  // top-of-page rotating one-liner, fresh every visit
  const LEDE_KICKERS = [
    "Currently 0% affiliated with Tesla, who would be appalled by our candour. ✌️",
    "The only Tesla timeline with error bars instead of vibes.",
    "Yes, California already has it. No, that doesn't help you. 🏖️",
    "Built by people who check the software menu before they check their texts.",
    "Like a horoscope, except the maths is real and the disappointment is scheduled.",
    "We cannot make your update arrive faster. We have tested this. Repeatedly. Tearfully.",
    "Manifesting your OTA, responsibly. 🔮",
    "Tesla says “soon.” We say a date. One of us is braver.",
    "Phantom-brake-free since launch. (The website. Not the cars.) 👻",
    "Refreshing won't summon the update — but you should absolutely keep trying.",
    "Powered by S-curves, public trackers, and barely-contained envy of the US fleet. 🇺🇸",
    "The forums said “two weeks.” The forums say that every week.",
    "Now with 100% more error bars than that guy on Reddit.",
    "Your update is in another castle. We at least know which castle. 🏰",
  ];
  function renderHumour() {
    for (const id in SUBS) { const el = $(id); if (el) el.textContent = flavorPick("sub:" + id, SUBS[id]); }
    const lk = $("ledeKicker"); if (lk) lk.textContent = flavorPick("ledeKicker", LEDE_KICKERS);
    rotateHeadlines();
    // rotate the joke, but keep a stable keyworded base so bookmarks / crawlers / social unfurls
    // always carry the real product name (never replace the canonical title outright).
    try { document.title = flavorPick("tabTitle", TAB_TITLES) + " · Tesla software & FSD update predictor"; } catch (e) {}
    injectKickers();
    rollWhyAnswer(false);
    const wa = $("whyAnswer");
    if (wa && !wa._wired) {
      wa._wired = true;
      const go = (e) => { e.preventDefault(); rollWhyAnswer(true); };
      wa.addEventListener("click", go);
      wa.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); });
    }
  }

  // LIVE pending-update banner — the car itself told us an update is on the way. Connected cars
  // only; this is OBSERVED truth (from vehicle_state.software_update), not a model estimate.
  function renderUpdateAlert() {
    const el = $("updateAlert"); if (!el) return;
    const v = av(), u = v && v.connected ? v.pendingUpdate : null;
    if (!u || !u.version) { el.hidden = true; return; }
    const ver = esc(u.version), st = (u.status || "").toLowerCase();
    const dl = u.download != null ? u.download : null, ins = u.install != null ? u.install : null;
    let icon = "🔔", cls = "ua-available", head, sub;
    if (st === "installing") {
      icon = "⚙️"; cls = "ua-installing";
      head = `<strong>${ver} is installing${ins != null ? ` — ${ins}%` : ""}.</strong>`;
      sub = rnd(["Do not drive into anything. Let it cook. 🍳", "Hands off. The car is becoming its best self.", "This is the part where you stand in the driveway and stare."]);
    } else if (st === "downloading" || st === "downloading_wifi_wait") {
      icon = "⬇️"; cls = "ua-downloading";
      head = `<strong>${ver} is downloading${dl != null ? ` — ${dl}%` : ""}.</strong>`;
      sub = st === "downloading_wifi_wait" ? rnd(["Waiting for Wi-Fi. Go park near the router and whisper encouragement. 📶", "Needs Wi-Fi. Your car has trust issues with mobile data."])
        : rnd(["So close you can smell the changelog. 👃", "Keep it on Wi-Fi and don't you dare drive off.", "The prophecy is buffering."]);
    } else if (st === "scheduled") {
      icon = "🗓️"; cls = "ua-scheduled";
      head = `<strong>${ver} is scheduled to install.</strong>`;
      sub = rnd(["wenFSD called it. The prophecy fulfils itself. 🔮", "It's basically here. Tonight, probably, while you sleep.", "Set an alarm. Or don't. It'll happen either way."]);
    } else {
      head = `<strong>${ver} is available for your car.</strong>`;
      sub = rnd(["It's RIGHT THERE. Open the Tesla app and hit install. 📲", "Stop refreshing this page and go tap 'Install' already.", "The waiting is over. Go. Be free."]);
    }
    el.hidden = false;
    el.className = "update-alert " + cls;
    el.innerHTML = `<span class="ua-icon">${icon}</span><span class="ua-text">${head} <span class="ua-sub">${esc(sub)}</span></span><span class="ua-badge" title="Read live from your car via Tesla's API">✓ live from your car</span>`;
  }

  const HERO_EYEBROWS = [
    "Your next updates — software & FSD · {car}",
    "The forecast for {car} — software & FSD",
    "{car} · when, exactly (software + FSD)",
    "{car}'s two-week sentence, quantified",
    "What the maths says about {car}",
    "{car} · software & FSD, foretold 🔮",
    "The wen, the whole wen, and nothing but the wen · {car}",
    "{car} — your update, with error bars",
  ];
  function renderHero(pred) {
    $("heroFlavor").innerHTML = heroFlavorLine(pred);
    $("heroEyebrow").textContent = flavorPick("heroEyebrow", HERO_EYEBROWS).replace(/\{car\}/g, av().nickname || "your car");
    $("heroDate").textContent = Predict.fmtDate(pred.medianDate);
    $("osPredVer").textContent = pred.targetLabel ? "· " + pred.targetLabel : "";
    const hw = $("heroWindow");
    hw.textContent = pred.confirmed
      ? `✓ confirmed by your car — ${pred.pendingStatus || "incoming"}`
      : (pred.stale ? "⚠️ low confidence · " : "") + "Most likely " + shortDate(pred.p10Date) + " – " + shortDate(pred.p90Date) + (pred.stale ? "" : " · 80% confidence");
    hw.classList.toggle("hw-stale", !!pred.stale);
    hw.classList.toggle("hw-confirmed", !!pred.confirmed);
    // the software card's "📡 prediction" pill becomes "✓ confirmed" when the car itself reported it
    const osPill = document.querySelector(".hpred-os .pred-pill");
    if (osPill) { osPill.textContent = pred.confirmed ? "✓ confirmed" : "📡 prediction"; osPill.classList.toggle("pill-confirmed", !!pred.confirmed); }
    if ($("osPredQuip")) $("osPredQuip").textContent = pred.confirmed ? "" : osPredQuip();
    let fsd = null; try { fsd = Predict.predictNextFSD(car(), today); } catch (e) { fsd = null; }
    renderOsFsdTag(pred, fsd);
    renderFsdPred(pred, fsd);
    renderFsdSummary(pred, fsd);
    // each detail section is now explicitly grouped under software vs FSD
    if ($("osDetail")) $("osDetail").hidden = false;
    if ($("ringCap")) $("ringCap").hidden = false;
    if ($("fsdDetail")) $("fsdDetail").hidden = !($("fsdSummary").innerHTML || "").trim();

    const ring = $("ringFg"), C = 2 * Math.PI * 78, d = pred.daysToMedian;
    const frac = Math.max(0.04, Math.min(1, 1 - Math.min(d, 120) / 120));
    ring.style.strokeDasharray = C; ring.style.strokeDashoffset = C * (1 - frac);
    $("ringDays").textContent = d <= 0 ? "now" : d;

    const w7 = Math.round(pred.probWithin(7) * 100), w14 = Math.round(pred.probWithin(14) * 100), w30 = Math.round(pred.probWithin(30) * 100);
    $("confRow").innerHTML = [chip("a week", w7), chip("two weeks 🙏", w14), chip("a month", w30)].join("");
    $("heroNote").innerHTML = `${esc(pred.note || "")} <span class="mut-i">Placed by your <strong>${pctLabel(effEarliness(av()))}</strong> rollout position${av().earlyAccess ? " (incl. Early Access)" : ""}.</span>`;
    renderBasis(pred);
    renderTips(pred);
    const sb = $("shareBtn");
    if (sb) { sb.textContent = flavorPick("shareBtn", SHARE_LABELS); sb.onclick = () => shareMyPrediction(pred, sb); }
  }

  // persistent NOW → NEXT context (region-aware) so the progression is always obvious
  function renderYouBar(pred) {
    const el = $("youBar"); if (!el) return;
    const v = av();
    if (!v || !pred || pred.capped || pred.unavailable) { el.hidden = true; return; }
    el.hidden = false;
    // this bar tracks the SOFTWARE build path (NOW build → NEXT build). FSD rides inside, so we
    // flag when that next build also carries a new FSD version.
    const now = v.installedVersion || "—";
    const next = pred.targetLabel || "next";
    const eta = pred.daysToMedian != null ? `~${Math.max(0, pred.daysToMedian)}d` : "";
    const fsdFlag = pred.bringsNewFsd ? ` <span class="yb-fsd" title="This build also bumps your FSD version">🧠 +FSD</span>` : "";
    el.innerHTML =
      `<span class="yb-region">📍 ${esc(v.market)}</span>` +
      `<span class="yb-seg"><span class="yb-lbl">NOW · SOFTWARE</span><strong class="yb-ver" data-goto-version="${esc(now)}" role="button" tabindex="0">${esc(now)}</strong></span>` +
      `<span class="yb-arrow">→</span>` +
      `<span class="yb-seg"><span class="yb-lbl yb-next-lbl">NEXT BUILD</span><strong class="yb-ver yb-next" data-goto-version="${esc(next)}" role="button" tabindex="0">${esc(next)}</strong>${eta ? `<span class="yb-eta">${eta}</span>` : ""}${fsdFlag}</span>`;
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
  // Prediction confidence tier — the reciprocity engine, and the single source of truth for
  // confidence across the hero (confLabel) and the garage meter (renderConfMeter). It climbs as
  // you log REAL updates (Tesla-read or hand-corrected). Model-"estimated" dates do NOT count:
  // they're derived from the model itself, so they can't honestly raise our confidence in it.
  function confidenceTier(v) {
    const real = v ? (v.history || []).filter(h => h.source === "tesla" || h.source === "exact").length : 0;
    if (v && v.connected && v.pendingUpdate && v.pendingUpdate.version)
      return { key: "confirmed", idx: 3, label: "Confirmed", real, need: 0 };
    if (v && v.earlinessSource === "history" && real >= 3) return { key: "high", idx: 2, label: "High", real, need: 0 };
    if (v && v.earlinessSource === "history" && real >= 1) return { key: "med", idx: 1, label: "Medium", real, need: 3 - real };
    return { key: "low", idx: 0, label: "Low", real, need: 3 };
  }
  function confLabel(v) {
    const t = confidenceTier(v);
    return t.key === "confirmed" ? "confirmed — your car reported a pending update"
      : t.key === "high" ? "high — fit from your real update history"
      : t.key === "med" ? `medium — fit from ${t.real} of your real update${t.real > 1 ? "s" : ""}`
      : v.earlyAccess ? "low — typical-owner prior + your Early Access setting" : "low — typical-owner prior";
  }
  // The payoff the user can SEE: a meter that visibly climbs when they contribute real data.
  function renderConfMeter() {
    const el = $("confMeter"); if (!el) return;
    const v = av(); if (!v) { el.innerHTML = ""; return; }
    const t = confidenceTier(v);
    if (t.key === "confirmed") {
      el.innerHTML = `<div class="cm-confirmed"><span class="cm-badge">✓ Confirmed by your car</span>` +
        `<span class="cm-msg">Your Tesla is reporting a pending update — this prediction is the real thing, not a model guess. 🛰️</span></div>`;
      return;
    }
    const segs = ["Low", "Medium", "High"].map((n, i) =>
      `<span class="cm-seg ${i <= t.idx ? "cm-on cm-" + t.key : ""}">${n}</span>`).join("");
    const msg = t.key === "high"
      ? `🎯 <strong>High confidence</strong> — fit from <strong>${t.real}</strong> of your real updates. This is <em>your</em> data, not a guess. Keep logging to keep it sharp.`
      : t.key === "med"
      ? `📈 <strong>Medium</strong> — fit from <strong>${t.real}</strong> real update${t.real > 1 ? "s" : ""}. Log <strong>${t.need} more</strong> to unlock <strong>High</strong> — every real date makes <em>your</em> prediction sharper.`
      : `🔮 <strong>Low</strong> — we're using a <strong>typical-owner prior</strong> (a fair guess, not your data). Log <strong>3 real updates</strong> below and your prediction switches to <em>fit from your own history</em>.`;
    el.innerHTML = `<div class="cm-h">Prediction confidence</div><div class="cm-meter" role="img" aria-label="Prediction confidence: ${t.label}">${segs}</div><div class="cm-msg">${msg}</div>`;
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
    track("connect_clicked");
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
      else { btn.textContent = "📨 Connect → get pinged the second it lands"; btn.onclick = connectTesla; }
    }
    if (hint) hint.innerHTML = connected
      ? `Your Tesla is linked <strong>read-only</strong> — wenFSD watches your version so you don't have to, and <strong>pings you the moment your update lands</strong> (and auto-settles your Call Your Shot bet). ${contributing ? "You're <strong>contributing</strong> anonymised version data to fleet stats." : "You're <strong>not</strong> contributing to fleet stats — tick the box above to help everyone's predictions."}`
      : `<strong>Stop refreshing the software menu at 2am.</strong> Connect read-only and we'll watch your car, then ping you the <strong>second</strong> your update lands — and settle your bet for you. Tesla's official OAuth; we only ever read your <strong>software version</strong>, never your location or trips. Disconnect anytime. <button type="button" class="sec-link js-open-security">🔒 Exactly what we read &amp; ignore →</button>`;
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
    // notify-on-arrival toggle (connected cars only)
    const nRow = $("notifyRow"), nChk = $("notifyToggle");
    if (nRow) nRow.hidden = !connected;
    if (connected && nChk && !nChk._wired) {
      nChk._wired = true;
      fetch("/api/me/notify", { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(r => r.ok ? r.json() : null).then(d => { if (d) nChk.checked = !!d.enabled; }).catch(() => {});
      nChk.onchange = () => {
        if (nChk.checked) track("notify_enabled");
        fetch("/api/me/notify", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ enabled: nChk.checked }) }).catch(() => {});
      };
    }
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
    tc.title = connected ? "Manage your Tesla connection in Your garage" : "Link your Tesla (read-only) — we'll ping you the second your update lands";
    tc.onclick = connected
      ? () => { const g = $("garageCard"); if (g) g.scrollIntoView({ behavior: "smooth", block: "start" }); }
      : connectTesla;
    renderConnectNudge(connected);
  }

  // Rotating nudge shown ONLY when you already have a car but haven't connected Tesla — so it
  // pitches the relevant upgrade (live alerts), not VIN onboarding (you're past that). {car} =
  // the active car's name. flavorPick re-rolls per page load; hideable for the session.
  const NUDGE = [
    "You're tracking {car} by hand. Connect your Tesla read-only and we'll ping you the <em>second</em> your update lands — no more 2am software-menu refreshing. 📨",
    "Want {car} to phone home? Connect read-only and we'll watch the rollout for you, then ping you the moment it arrives. We only ever read your version. 🛰️",
    "Tired of checking? Let us do the refreshing. Connect {car} read-only and we'll alert you the instant your build actually drops. ⚡",
    "Manual mode works — but connect {car} read-only and your prediction settles itself: live alerts, no location, no commands, no drama. 🔓",
    "Bet you've checked the software menu today. Connect {car} read-only and we'll do it for you, then tell you the moment it's real. 🔔",
  ];
  let _nudgeDismissed = false;
  function openAddByVin() {
    const g = $("garageCard"); if (g) g.scrollIntoView({ behavior: "smooth", block: "start" });
    const add = $("addVehicleBtn"), form = $("addForm");
    if (form && form.hidden && add) add.click();           // open the add-vehicle form
    setTimeout(() => { const vin = $("vinInput"); if (vin) vin.focus(); }, 350);
  }
  function renderConnectNudge(connected) {
    const el = $("connectNudge"); if (!el) return;
    // When the garage is empty, the garage card's own two-option CTA owns onboarding — don't
    // also show this banner (avoids the same pitch appearing three times). Show it once the
    // user has a car but hasn't connected.
    const empty = !gstate.vehicles || !gstate.vehicles.length;
    if (connected || _nudgeDismissed || empty) { el.hidden = true; return; }
    el.hidden = false;
    const v = av(), carName = (v && (v.nickname || v.model)) || "your car";
    const line = $("cnLine"); if (line) line.innerHTML = flavorPick("nudge", NUDGE).replace(/\{car\}/g, `<strong>${esc(carName)}</strong>`);
    const em = $("cnEmoji"); if (em) em.textContent = "📨";
    // you already have a car → connect (live alerts) is the primary action; adding another is secondary
    const btn = $("cnConnect");
    if (btn) { btn.textContent = "🔗 Connect → get pinged"; btn.className = "btn cn-btn"; if (!btn._wired) { btn._wired = true; btn.onclick = connectTesla; } }
    const vin = $("cnVin");
    if (vin) { vin.textContent = "+ add another car"; vin.className = "btn-ghost cn-btn2"; if (!vin._wired) { vin._wired = true; vin.onclick = openAddByVin; } }
    const dx = $("cnDismiss"); if (dx && !dx._wired) { dx._wired = true; dx.onclick = () => { _nudgeDismissed = true; el.hidden = true; }; }
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
      // show BOTH tracks the car carries: its software build and its FSD version (the asymmetry)
      const fhw = ((WEN.regions[v.market] || {}).fsd || {})[v.hardware] || null;
      const fsdRaw = (v.fsdVersion && !/^(none|—|-|)$/i.test(String(v.fsdVersion).trim())) ? v.fsdVersion : (fhw ? fhw.current : null);
      const fsdText = (fsdRaw && fsdRaw !== "none") ? "FSD " + esc(fsdRaw) : (fhw && fhw.mode === "capped") ? "FSD capped" : "no FSD";
      const verText = v.installedVersion ? `software ${esc(v.installedVersion)} · ${fsdText}` : "version unknown — waiting for first Tesla read";
      return `<div class="gcar ${isA ? "active" : ""}" data-id="${v.id}" role="button" tabindex="0" aria-pressed="${isA}" aria-label="Select ${esc(v.nickname || v.model)}">` +
        `<div class="gcar-main"><div class="gcar-name">${esc(v.nickname || v.model)}${v.connected ? ' <span class="gcar-link" title="Connected to your Tesla account">🔗 connected</span>' : ''}</div>` +
        `<div class="gcar-sub">${v.year} ${esc(v.model)}${v.generation ? " " + v.generation : ""} · ${v.hardware} · ${esc(v.market)}</div>` +
        `<div class="gcar-ver">${verText}</div></div>` +
        `<button class="gcar-x" data-del="${v.id}" title="Remove this vehicle">×</button>` +
        `</div>`;
    }).join("");

    $("garageList").querySelectorAll(".gcar").forEach(node => {
      const select = (e) => {
        if (e.target.dataset.del) return;
        gstate = Garage.setActive(node.dataset.id);
        ui.guessDays = null; clearGuess();
        renderActiveControls(); render();
      };
      node.onclick = select;
      node.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(e); } };
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

    const fe = $("fsdEntitlementSel");
    if (fe) {
      fe.value = v.fsdEntitlement || "unknown";
      fe.onchange = () => { gstate = Garage.update(v.id, { fsdEntitlement: fe.value }); render(); };
    }

    const es = $("earlySlider");
    es.value = Math.round(v.earliness * 100);
    setEarlyLabel();
    es.oninput = () => {
      gstate = Garage.update(v.id, { earliness: (+es.value) / 100, earlinessSource: "manual" });
      setEarlyLabel(); ui.guessDays = null; clearGuess(); render(); renderConfMeter();
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

    const eb = $("emailSubBtn"), ei = $("emailInput");
    if (eb && !eb._wired) { eb._wired = true; eb.onclick = submitEmail; }
    if (ei && !ei._wired) { ei._wired = true; ei.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submitEmail(); } }); }

    renderHistory();
  }
  // no-login email capture: validate, POST the car context, show double-opt-in status
  function submitEmail() {
    const inp = $("emailInput"), btn = $("emailSubBtn"), status = $("emailSubStatus");
    if (!inp || !status) return;
    const email = inp.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { status.textContent = "Hmm — that doesn't look like an email. 🤔"; status.className = "ec-status ec-err"; inp.focus(); return; }
    const v = av() || {};
    if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
    fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      email, model: v.model, market: v.market, hardware: v.hardware, version: v.installedVersion, fsdEntitlement: v.fsdEntitlement,
    }) }).then(r => r.json().catch(() => ({}))).then(d => {
      if (d && d.ok) {
        track("email_subscribed");
        status.innerHTML = "✓ Almost there — check your inbox for a confirm link (peek in spam too). Already confirmed before? Then you're all set. 🫡";
        status.className = "ec-status ec-ok"; inp.value = "";
      } else { status.textContent = (d && d.error) || "Couldn't sign you up just now — try again in a sec."; status.className = "ec-status ec-err"; }
    }).catch(() => { status.textContent = "Network hiccup — give it another go."; status.className = "ec-status ec-err"; })
      .finally(() => { if (btn) { btn.disabled = false; btn.textContent = "Notify me 🔔"; } });
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
    const label = shifted ? `${pctLabel(eff)} (after settings)` : pctLabel(eff);
    $("earlyVal").textContent = label;
    const sl = $("earlySlider"); if (sl) sl.setAttribute("aria-valuetext", `${pctLabel(base)} — ${base <= 0.33 ? "first wave" : base >= 0.66 ? "last wave" : "middle of the pack"}`);
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
    renderConfMeter();
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
      addVehicleAndRender({
        nickname: $("f_nick").value.trim(), vin, model: $("f_model").value, year: +$("f_year").value,
        gen, hw: $("f_hw").value, market: $("f_market").value, version: $("f_ver").value.trim(),
        entitlement: ($("f_fsd") && $("f_fsd").value) || "unknown",
      });
      $("addForm").hidden = true; $("addVehicleBtn").hidden = false;
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
      track("history_logged");
      populateVersionOptions(); renderHistory();
    };
  }
  function resetForm() {
    $("vinInput").value = ""; $("vinResult").innerHTML = "";
    $("f_nick").value = ""; $("f_model").value = "Model Y"; $("f_year").value = 2026; $("f_hw").value = "AI4"; $("f_ver").value = "";
    if ($("f_fsd")) $("f_fsd").value = "unknown";
  }

  // single place that builds a vehicle from form fields (used by the garage form AND the
  // top-of-page Quick Predict panel) so the two paths can't drift.
  function addVehicleAndRender({ nickname, vin, model, year, gen, hw, market, version, entitlement }) {
    const wasEmpty = Garage.isEmpty();   // first car? → bridge the quick-predict → garage handoff
    const region = WEN.regions[market] || {};
    const fsdInfo = region.fsd ? region.fsd[hw] : null;
    gstate = Garage.add({
      nickname: (nickname || "").trim() || model,
      vin: vin || "",
      model, year: +year || 2026, generation: gen || "",
      hardware: hw, market, drive: region.drive || "RHD",
      installedVersion: (version || "").trim() || (WEN.versions[0] && WEN.versions[0].version) || "2026.14.6",
      fsdVersion: fsdInfo ? fsdInfo.current : "—",
      fsdEntitlement: entitlement || "unknown",
      earliness: 0.5, earlinessSource: "default",
      updateChannel: "standard", earlyAccess: false, optedIn: false, history: [],
    });
    ui.guessDays = null; clearGuess();
    renderGarage(); renderActiveControls(); render();
    maybeOnboard(wasEmpty);
    track("prediction_generated");   // activation: a car was added and a prediction shown
    const hero = $("heroDate"); if (hero && hero.scrollIntoView) hero.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // First car ever added: surface a one-time bridge so the silent quick-predict → garage
  // handoff is obvious (this IS your car; here's why you'd touch the garage). Dismissable + sticky.
  function maybeOnboard(wasEmpty) {
    const note = $("onboardNote"); if (!note) return;
    let seen = false; try { seen = localStorage.getItem("wenfsd.onboarded") === "1"; } catch (e) {}
    if (!wasEmpty || seen) { note.hidden = true; return; }
    note.innerHTML = `<span>✓ <strong>Saved to Your garage</strong> below — this is your live prediction now. ` +
      `Want it sharper? Fix your exact version, log past updates, or connect for live alerts — all in the garage.</span>` +
      `<button type="button" class="on-x" id="onboardX">Got it 👍</button>`;
    note.hidden = false;
    const x = $("onboardX");
    if (x) x.onclick = () => { note.hidden = true; try { localStorage.setItem("wenfsd.onboarded", "1"); } catch (e) {} };
  }

  // crude hardware inference from model + year so the Quick Predict "Hardware (auto)" is right by
  // default (HW4 came in from ~2024; Juniper Model Y + Cybertruck are HW4). User can override.
  function inferHardware(model, year) {
    const y = +year || 2026;
    if (/cybertruck/i.test(model)) return "AI4";
    if (y >= 2024) return "AI4";
    if (y >= 2019) return "AI3";
    return "AI2.5";
  }

  function wireQuickStart() {
    const go = $("qsGo"); if (!go || go._wired) return; go._wired = true;
    // populate year + region selects
    const ySel = $("qs_year");
    if (ySel && !ySel.options.length) {
      const years = []; for (let y = 2027; y >= 2017; y--) years.push(y);
      ySel.innerHTML = years.map(y => `<option ${y === 2026 ? "selected" : ""}>${y}</option>`).join("");
    }
    const mSel = $("qs_market");
    if (mSel && !mSel.options.length) mSel.innerHTML = Object.keys(WEN.regions).map(m => `<option ${m === "Australia" ? "selected" : ""}>${m}</option>`).join("");
    const syncHw = () => { $("qs_hw").value = inferHardware($("qs_model").value, $("qs_year").value); };
    syncHw();
    $("qs_model").onchange = syncHw; $("qs_year").onchange = syncHw;
    const verEl = $("qs_ver"), warn = $("qs_ver_warn");
    go.onclick = () => {
      const version = verEl.value.trim();
      // the version is the single load-bearing input — validate it before predicting on garbage.
      if (version && !WEN.isValidVersion(version)) {
        if (warn) { warn.hidden = false; warn.textContent = "Hmm — that doesn't look like a Tesla version (try e.g. 2026.14.6, found in your car under Controls → Software)."; }
        verEl.focus(); return;
      }
      if (warn) warn.hidden = true;
      addVehicleAndRender({
        model: $("qs_model").value, year: +$("qs_year").value, hw: $("qs_hw").value,
        market: $("qs_market").value, version,
        entitlement: $("qs_fsd").value,
      });
    };
    if (verEl && warn) verEl.addEventListener("input", () => { warn.hidden = true; });
    const c = $("qsConnect"); if (c) c.onclick = connectTesla;
    const vn = $("qsVin"); if (vn) vn.onclick = openAddByVin;
    const dm = $("qsDemo"); if (dm) dm.onclick = () => { track("demo_loaded"); gstate = Garage.loadDemo(); ui.guessDays = null; clearGuess(); renderGarage(); renderActiveControls(); render(); };
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
  const WENPOINTS_BLURB = `🪙 <strong>What are wenPoints?</strong> Pure bragging rights — a score, not a token, not redeemable, definitely not "financial advice." Nail your call and you climb your region's leaderboard. Bold calls pay up to <strong>6×</strong>, safe calls 1×. That's the whole economy: glory.`;
  function guessFormEls() { return [$("nervePick"), $("guessBtn"), $("guessDate") && $("guessDate").closest(".field")].filter(Boolean); }
  function renderGuess(pred) {
    const v = av();
    if (v && v.bet && v.bet.date) { guessFormEls().forEach(el => el.style.display = "none"); renderLockedBet(pred, v.bet); return; }
    guessFormEls().forEach(el => el.style.display = "");
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
  // social share row (pre-filled brag) → TMC, X, Reddit, Facebook, copy
  function shareRow() {
    return `<div class="share-row">` +
      `<button class="btn-sm" id="shCopy" type="button">🔗 Copy</button>` +
      `<a class="btn-sm" id="shTmc" target="_blank" rel="noopener">💬 TMC</a>` +
      `<a class="btn-sm" id="shX" target="_blank" rel="noopener">𝕏</a>` +
      `<a class="btn-sm" id="shReddit" target="_blank" rel="noopener">Reddit</a>` +
      `<a class="btn-sm" id="shFb" target="_blank" rel="noopener">Facebook</a>` +
      `</div>`;
  }
  function wireShare(blurb) {
    const url = "https://wenfsd.info", t = encodeURIComponent(blurb), u = encodeURIComponent(url);
    const set = (id, href) => { const a = $(id); if (a) a.href = href; };
    set("shX", `https://twitter.com/intent/tweet?text=${t}&url=${u}`);
    set("shReddit", `https://www.reddit.com/submit?url=${u}&title=${t}`);
    set("shFb", `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${t}`);
    const tmc = $("shTmc"); if (tmc) { tmc.href = "https://teslamotorsclub.com/tmc/"; tmc.onclick = () => copyText(blurb); }
    const cp = $("shCopy"); if (cp) cp.onclick = () => copyText(blurb, cp);
  }
  // the committed, persistent bet — locked so you can't re-roll endlessly
  function renderLockedBet(pred, bet) {
    const v = av(), risk = RISK[bet.risk] || RISK.bold;
    const dateNice = Predict.fmtDate(bet.date).replace(/^\w+, /, "");
    const blurb = `📲 I called it on wenFSD: my Tesla gets ${bet.target || "its next update"} by ${dateNice} (${risk.label} mode, ${bet.odds}% odds). Screenshot this so you can mock me later 😤 wenfsd.info`;
    $("guessResult").classList.add("show");
    $("guessResult").innerHTML =
      `<div class="shot shot-${risk.tag} shot-locked">` +
        `<div class="shot-mode">🔒 Locked in · ${risk.label}</div>` +
        `<div class="shot-call">You called <strong>${esc(bet.target || "your next update")}</strong> by <strong>${esc(dateNice)}</strong>. No takebacks${v.connected ? " — the leaderboard's watching" : ""}.</div>` +
        `<div class="shot-stats"><div><b>${bet.odds}%</b><span>the house gave you</span></div><div><b>🪙 ${bet.potential}</b><span>wenPoints at stake</span></div></div>` +
        `<div class="shot-stake">${v.connected ? "✅ Staked for real — settles automatically when your car updates. Nail it → leaderboard glory. Whiff it → we'll remember. 👀" : "📸 Locked on this device. Connect your Tesla to settle it for real + bank the wenPoints."}</div>` +
        `<div class="wp-explain">${WENPOINTS_BLURB}</div>` +
        `<div class="share-label">📣 Plant your flag (so everyone sees you were right):</div>` +
        shareRow() +
        `<button class="btn-link" id="resetBet" type="button">↺ Misfire? Change my call (the model judges flip-floppers)</button>` +
      `</div>`;
    Charts.distribution($("distChart"), pred, today, Predict.daysBetween(today, bet.date));
    wireShare(blurb);
    $("resetBet").onclick = () => {
      if (!confirm("Change your locked call? Flip-flopping is a bad look, but okay. 🤨")) return;
      gstate = Garage.update(v.id, { bet: null }); ui.guessDays = null; renderGuess(pred);
    };
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
  // "Lock in" → PERSIST the bet (one locked call per car, no endless re-rolling), and for a
  // connected car stake it server-side so it settles for real when the car updates.
  function lockInGuess(pred) {
    const v = av(), guessStr = $("guessDate").value;
    if (!v) return;
    if (!guessStr || isNaN(new Date(guessStr + "T00:00:00Z"))) { showGuessResult(pred); return; }
    track("bet_placed");
    const risk = RISK[ui.guessRisk] || RISK.bold;
    const g = Predict.daysBetween(today, guessStr);
    const odds = Math.round(Math.max(0, Math.min(1, pred.probWithin(g + risk.window) - pred.probWithin(g - risk.window))) * 100);
    const bet = { date: guessStr, risk: ui.guessRisk, target: pred.targetLabel || null, odds, potential: Math.round(100 * risk.mult), placedAt: today };
    gstate = Garage.update(v.id, { bet });
    if (v.connected && /^https?:$/.test(location.protocol)) {
      fetch("/api/me/guess", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ guessDate: guessStr, windowDays: risk.window, mult: risk.mult, target: pred.targetLabel || null }) }).catch(() => {});
    }
    renderGuess(pred);
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

  // ---- share my prediction (the growth loop): a branded image card + native share ----
  function roundRect(x, X, Y, w, h, r) {
    x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r);
    x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
  }
  // Draw a 1200×630 (OG ratio) card with the user's actual prediction. Returns Promise<Blob|null>.
  function buildShareCard(pred) {
    try {
      const v = av(); if (!v) return Promise.resolve(null);
      const W = 1200, H = 630, c = document.createElement("canvas"); c.width = W; c.height = H;
      const x = c.getContext("2d"); if (!x) return Promise.resolve(null);
      x.fillStyle = "#0a0d12"; x.fillRect(0, 0, W, H);
      x.fillStyle = "#0c1019"; roundRect(x, 48, 48, W - 96, H - 96, 28); x.fill();
      x.strokeStyle = "#27384b"; x.lineWidth = 2; roundRect(x, 48, 48, W - 96, H - 96, 28); x.stroke();
      x.fillStyle = "#e62937"; roundRect(x, 48, 48, 10, H - 96, 6); x.fill(); // brand spine
      x.textBaseline = "alphabetic";
      // wordmark
      x.font = "800 46px " + SANS; x.fillStyle = "#e9eef5"; x.fillText("wen", 100, 138);
      x.fillStyle = "#e62937"; x.fillText("FSD", 100 + x.measureText("wen").width, 138);
      // which car
      x.fillStyle = "#9fb0c3"; x.font = "700 27px " + SANS;
      x.fillText(`${v.year} ${v.model}${v.generation ? " " + v.generation : ""} · ${v.market}`.toUpperCase(), 100, 214);
      // label
      x.fillStyle = "#6b7c91"; x.font = "800 24px " + SANS;
      x.fillText(pred.confirmed ? "NEXT UPDATE — CONFIRMED BY THE CAR" : "NEXT SOFTWARE UPDATE — PREDICTED", 100, 280);
      // the date
      x.fillStyle = pred.confirmed ? "#37d67a" : "#39d4ff"; x.font = "800 98px " + SANS;
      x.fillText(Predict.fmtDate(pred.medianDate), 96, 392);
      // window / honesty
      x.fillStyle = "#9fb0c3"; x.font = "500 31px " + SANS;
      x.fillText(pred.confirmed ? "your car is already downloading it"
        : pred.stale ? "low-confidence estimate · a prediction, not a promise"
        : `80% by ${shortDate(pred.p90Date)} · a prediction, not a promise`, 100, 452);
      // CTA
      x.fillStyle = "#e62937"; x.font = "800 35px " + SANS;
      x.fillText("call your shot 👉 wenfsd.info", 100, 548);
      return new Promise(res => c.toBlob(b => res(b), "image/png"));
    } catch (e) { return Promise.resolve(null); }
  }
  const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  async function shareMyPrediction(pred, btn) {
    const v = av(); if (!v || !pred) return;
    track("shared");
    const model = `${v.year} ${v.model}${v.generation ? " " + v.generation : ""}`;
    const date = Predict.fmtDate(pred.medianDate);
    const text = pred.confirmed
      ? `🚗 My ${model} is getting its next Tesla update (${date}) — confirmed by the car. wenFSD called it. Get your own 👉 https://wenfsd.info`
      : `🚗 wenFSD predicts my ${model} gets its next Tesla update ~${date}${pred.stale ? "" : ` (80% by ${shortDate(pred.p90Date)})`}. Call your shot 👉 https://wenfsd.info`;
    const blob = await buildShareCard(pred);
    const file = blob && typeof File === "function" ? new File([blob], "wenfsd-prediction.png", { type: "image/png" }) : null;
    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text, title: "wenFSD prediction" }); return; }
      if (navigator.share) { await navigator.share({ text, url: "https://wenfsd.info" }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    // no native share: download the card + copy the brag
    if (blob) {
      const u = URL.createObjectURL(blob), a = document.createElement("a");
      a.href = u; a.download = "wenfsd-prediction.png"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
    }
    copyText(text, btn);
  }
  const SHARE_LABELS = ["📣 Share my prediction", "📤 Brag responsibly", "🔗 Share this prediction", "📣 Show the doubters"];

  // ---------------- static panels ----------------
  function pctLabel(p) {
    const pct = Math.round(p * 100);
    const word = p <= 0.2 ? "very early" : p <= 0.4 ? "earlier than most" : p <= 0.6 ? "average" : p <= 0.8 ? "later than most" : "very late";
    return `${word} (~${pct}th pct)`;
  }
  const MODE_LABEL = { rolling: "Rolling out", early: "Early/staged rollout", gated: "Awaiting approval", current: "On newest", capped: "Hardware-capped", promised: "Promised · no timeline" };
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
    const eta = (fp && fp.promised) ? "no timeline"
      : (fp && fp.sameFsd) ? "no change yet"
      : (fp && !fp.capped && !fp.unavailable && fp.medianDate) ? Predict.fmtDate(fp.medianDate).replace(/^\w+, /, "")
      : (f && (f.mode === "capped" || (fp && fp.capped)) ? "capped" : "—");
    // for YOUR region, show the FSD version your car is actually on (not the region's typical)
    const curFsdShown = isYours ? (carCurrentFsd() || (f ? f.current : "—")) : (f ? f.current : "—");
    $("fsdGrid").innerHTML =
      `<div class="fsd-stat"><div class="fsd-num">${f ? (MODE_LABEL[f.mode] || f.mode) : "—"}</div><div class="fsd-lbl">FSD status · ${esc(rname0)} ${esc(hw)}</div></div>` +
      `<div class="fsd-stat"><div class="fsd-num">${esc(curFsdShown)}</div><div class="fsd-lbl">current FSD ${isYours ? "(yours)" : "(typical car)"}</div></div>` +
      `<div class="fsd-stat"><div class="fsd-num">${esc(eta)}</div><div class="fsd-lbl">next FSD — ${isYours ? "your ETA" : "typical-car ETA"}</div></div>`;

    // ---- Explore: a genuine head-to-head vs YOUR region (this is what makes the dropdown useful) ----
    const cmp = $("fsdCompare");
    if (cmp) {
      const home = v ? v.market : "Australia";
      const homeR = WEN.regions[home] || {};
      const homeF = homeR.fsd ? homeR.fsd[hw] : null;
      if (isYours || !v) {
        // viewing your own region (or no car): explain the tool + tease the lead board
        const leader = Object.entries(WEN.regions)
          .filter(([, r]) => r.fsd && r.fsd[hw])
          .sort((a, b) => (a[1].osLagDays || 0) - (b[1].osLagDays || 0))[0];
        const ld = leader ? leader[0] : "the US";
        const ldF = leader && leader[1].fsd[hw] ? leader[1].fsd[hw].current : "—";
        cmp.innerHTML = v
          ? `🧭 <strong>This is your turf (${esc(home)}).</strong> Pick another region above (or tap a row below) to see how many days it runs ahead of — or behind — you. Spoiler: <strong>${esc(ld)}</strong> is usually first to the party, currently on <strong>${esc(ldF)}</strong>.`
          : `🧭 Pick a region above to explore who gets builds first. <strong>${esc(ld)}</strong> typically leads (on <strong>${esc(ldF)}</strong>); the rest of us refresh the app and wait.`;
        cmp.className = "fsd-compare fc-home";
      } else {
        const lag = (region.osLagDays || 0) - (homeR.osLagDays || 0); // +ve ⇒ explored region trails yours
        const ahead = lag < 0, same = lag === 0;
        const days = Math.abs(lag);
        const dir = same ? "neck-and-neck with" : ahead ? `~${days} day${days === 1 ? "" : "s"} AHEAD of` : `~${days} day${days === 1 ? "" : "s"} BEHIND`;
        const homeCur = carCurrentFsd() || (homeF ? homeF.current : null);
        const fsdSame = homeCur && f && homeCur === f.current;
        const fsdLine = !homeCur || !f ? ""
          : fsdSame ? ` Both of you are on <strong>${esc(f.current)}</strong> — same boat.`
          : ` They're on <strong>${esc(f.current)}</strong> vs your <strong>${esc(homeCur)}</strong>.`;
        const quip = rnd(ahead
          ? [`Salt levels: rising. 🧂`, `Yes, they got it first. Again.`, `Try not to refresh the changelog out of spite.`, `The grass really is greener (and more autonomous) over there.`]
          : same ? [`Misery loves company. 🫠`, `At least you're suffering together.`, `Synchronised waiting — very Olympic.`]
          : [`Smug mode: unlocked. 😎`, `For once, you're not last. Savour it.`, `Somewhere, ${esc(rname0)} owners are refreshing in envy.`]);
        cmp.innerHTML = `🆚 <strong>${esc(rname0)}</strong> vs your <strong>${esc(home)}</strong>: OS builds reach there <strong>${dir}</strong> you.${fsdLine} <span class="fc-quip">${quip}</span>`;
        cmp.className = "fsd-compare " + (ahead ? "fc-behind" : same ? "fc-same" : "fc-ahead");
      }
    }

    // region × hardware matrix (highlights the explored region)
    const rows = Object.keys(WEN.regions).map(rname => {
      const r = WEN.regions[rname];
      const cell = (hw) => {
        const x = r.fsd[hw];
        if (!x) return `<td class="mx-na">—</td>`;
        const next = x.mode === "promised" ? `<span class="mx-promised">${esc(x.next)} — no date</span>`
          : x.next ? `<span class="mx-next">→ ${esc(x.next)}</span>` : `<span class="mx-capped">capped</span>`;
        const cur = (x.current === "none" || !x.current) ? `<span class="mx-none">never delivered</span>` : esc(x.current);
        return `<td><div class="mx-cur">${cur}</div><div class="mx-mode mode-${x.mode}">${MODE_LABEL[x.mode] || x.mode}</div>${next}</td>`;
      };
      const isShown = rname === rname0, isCar = v && rname === v.market;
      return `<tr class="${isShown ? "mx-active" : ""} mx-click" data-explore-region="${esc(rname)}" role="button" tabindex="0" aria-label="Explore ${esc(rname)} FSD rollout" title="Explore ${esc(rname)}"><td class="mx-region">${esc(rname)}${isCar ? ' <span class="tag-you">you</span>' : ''}</td>${cell("AI4")}${cell("AI3")}</tr>`;
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
        ? `✓ <strong>Live fleet data</strong>, aggregated from connected cars + public trackers. ${rnd(["Real numbers, no vibes.", "Freshly scraped, ethically sourced. 🌿", "As live as Tesla lets anyone be.", "Aggregated, deduped, fleet-weighted."])} <span class="sb-caveat">Your predicted <em>dates</em> are still modelled estimates — that part's always honest guesswork. 🔮</span>`
        : `Showing <strong>your real car data</strong> plus <em>modelled estimates</em> for the fleet-wide views below — each one clearly badged. Estimates become live figures as real Teslas connect and we aggregate the public trackers. No figure is presented as observed unless it is. (We'd rather be honestly vague than confidently wrong.)`;
    }
  }

  // ---- model calibration / back-test against real tracker history ----
  // Prominent "does the model actually work?" scoreboard (top of the open-model card). Surfaces
  // the SAME back-tested + live numbers the calibration card computes — just front-and-centre.
  function renderScoreboard(cal) {
    const board = $("scoreboard"), tilesEl = $("sbTiles"), noteEl = $("sbNote"), scopeEl = $("sbScope");
    if (!board) return;
    const bt = cal && cal.backtest, acc = cal && cal.accuracy, haveAcc = acc && acc.scored > 0;
    if (!bt && !haveAcc) {
      board.hidden = false; if (scopeEl) scopeEl.textContent = "— building";
      tilesEl.innerHTML = `<div class="sb-tile sb-soon"><div class="sb-num">soon</div><div class="sb-lbl">accuracy appears once there's enough real release history</div></div>`;
      noteEl.innerHTML = `We refuse to print a made-up accuracy number. Every connected car and tracker reading adds a data point; the moment we can measure it honestly, it shows up here. 🧾`;
      return;
    }
    board.hidden = false;
    const sample = !cal || cal.mode === "sample";
    if (scopeEl) scopeEl.textContent = sample ? "— illustrative history" : haveAcc ? "— live, measured" : "— back-tested";
    const tiles = [];
    if (bt) {
      tiles.push([`${bt.coveragePct}%`, `of ${bt.tested} past releases landed inside our 80% window (target ~80%)`, bt.coveragePct >= 70 && bt.coveragePct <= 92]);
      tiles.push([`±${bt.medianAbsErrorDays}d`, `median miss between predicted and actual release date`, true]);
    }
    if (haveAcc) tiles.push([`${acc.hitRate}%`, `live per-car hit-rate (${acc.scored} connected prediction${acc.scored === 1 ? "" : "s"} scored)`, true]);
    if (cal && cal.fittedCount > 0) tiles.push([`${cal.fittedCount}`, `build${cal.fittedCount === 1 ? "" : "s"} with k + t0 learned from real install timing (not hand-set priors)`, true]);
    if (bt && bt.bandFactor) tiles.push([`×${bt.bandFactor}`, `self-calibration: we auto-widen/narrow the window to match real history`, true]);
    tilesEl.innerHTML = tiles.map(([n, l, ok]) => `<div class="sb-tile${ok ? " sb-ok" : ""}"><div class="sb-num">${esc(n)}</div><div class="sb-lbl">${esc(l)}</div></div>`).join("");
    noteEl.innerHTML = sample
      ? `These are <strong>back-tested on illustrative release history</strong> while live tracker data is wiring up — not yet a live per-car record. We'd rather show a modest measured number than a flashy fake one. The live figure replaces it automatically.`
      : `Measured by replaying real release history (walk-forward) and scoring live predictions against what actually happened. No fabricated figures, ever.`;
  }

  function renderCalibration(cal) {
    const el = $("calibrationBody");
    if (!el) return;
    const acc = cal && cal.accuracy;
    const bt = cal && cal.backtest;
    const haveLive = cal && cal.mode === "live";
    const haveAcc = acc && acc.scored > 0;
    const sample = !cal || cal.mode === "sample";
    if (!haveLive && !haveAcc && !bt) {
      const openNote = acc && acc.open ? ` <strong>${acc.open} prediction${acc.open === 1 ? "" : "s"}</strong> currently open, awaiting the next update.` : "";
      el.innerHTML = `<p class="cal-note">Calibration appears once live sources are enabled. It back-tests the engine against real release history. We will <em>not</em> print a made-up accuracy figure to look clever — numbers here are measured, never fabricated. (Radical honesty: it's the whole brand.) 🧾${openNote}</p>`;
      return;
    }
    const c = cal.cadence, v = cal.velocity, cov = cal.coverage, tiles = [];
    // HEADLINE: walk-forward back-test — did the model's 80% window catch the real release date?
    if (bt) {
      const cal2 = bt.bandFactor ? ` · self-calibrated: window ×${bt.bandFactor} to match real history` : "";
      tiles.push(["Back-test: 80% window hit-rate", `${bt.coveragePct}%`,
        `the model's 80% window caught the actual release date in ${bt.coveragePct}% of ${bt.tested} historical branch release${bt.tested === 1 ? "" : "s"} (target ~80%; median miss ±${bt.medianAbsErrorDays}d)${cal2}${sample ? " · illustrative history — live uses real tracker dates" : " · real tracker release history"}`, !haveAcc]);
    }
    if (haveAcc) tiles.push(["Per-car accuracy (live)", `${acc.hitRate}%`, `${acc.scored} connected-car prediction${acc.scored === 1 ? "" : "s"} scored vs what actually happened${acc.medianAbsErrorDays != null ? ` · median miss ±${acc.medianAbsErrorDays}d` : ""}`, true]);
    if (c) tiles.push(["Release cadence", `~${c.medianDays}d`, `median between OS branches · ${c.meanDays}±${c.sdDays}d mean · from ${c.branches} real branches`]);
    if (v) tiles.push(["Rollout velocity", `~${v.medianDaysQ1toQ3}d`, `installs go 25%→75% once a version reaches cars · ${v.sampleVersions} rollouts (TeslaFi daily data)`]);
    if (cov) tiles.push(["Coverage", `${cov.versions} versions`, `${cov.versionsWithShare} with fleet share · ${cov.sourceCount} live sources`]);
    const honesty = cal.honesty || "This back-test scores the model against historical branch-release dates (illustrative in this preview; the live site runs it against real tracker history). Per-car accuracy then validates against connected cars as they update. Nothing here is fabricated.";
    el.innerHTML =
      `<div class="cal-grid">` +
      tiles.map(([h, big, sub, hot]) => `<div class="cal-tile${hot ? " cal-hot" : ""}"><div class="cal-h">${esc(h)}</div><div class="cal-big">${esc(big)}</div><div class="cal-sub">${esc(sub)}</div></div>`).join("") +
      `</div>` +
      (cov && cov.sources && cov.sources.length ? `<div class="cal-src">Validated against real history from: <strong>${cov.sources.map(esc).join(" · ")}</strong></div>` : "") +
      `<div class="cal-honesty">✓ ${esc(honesty)}</div>`;
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
        const safeHref = /^https?:\/\//i.test(String(s.homepage || "")) ? s.homepage : null;  // only http(s); blocks javascript:/data:
        return safeHref ? `<a class="${cls}" href="${esc(safeHref)}" target="_blank" rel="noopener" title="Open ${esc(s.name)}">${inner} ↗</a>` : `<span class="${cls}">${inner}</span>`;
      }).join("") +
      `<span class="ds-note">wenFSD merges these (fleet-weighted) and adds the prediction layer none of them have.</span>`;
  }

  // ---- release notes (fleetctrl-style changelog) ----
  const RN_TAG = { FSD: "rn-fsd", Dashcam: "rn-feat", Charging: "rn-feat", Sentry: "rn-feat", Nav: "rn-feat", Fix: "rn-fix", Safety: "rn-safety", UI: "rn-ui" };
  const isFsdItem = (it) => it.tag === "FSD" || /\bFSD\b|autosteer|autopilot|supervised|robotaxi/i.test(it.text || "");
  function wireRnFilter() {
    const bar = $("rnFilter"); if (!bar || bar._wired) return;
    bar._wired = true;
    bar.querySelectorAll(".rnf-btn").forEach(b => b.onclick = () => {
      ui.rnFilter = b.dataset.rnf;
      bar.querySelectorAll(".rnf-btn").forEach(x => x.classList.toggle("is-on", x === b));
      renderReleaseNotes();
    });
  }
  const NO_OS_NOTES = ["OS changelog not captured for this build yet — Tesla's keeping it mysterious. 🤫", "OS notes pending. Assume “improvements to overall stability”; they always say that.", "No OS changelog scraped yet. The trackers are working on it, allegedly.", "OS notes MIA. The dog ate Tesla's release notes again. 🐕", "Changelog still loading. Spoiler: it'll say 'minor improvements'. It always says 'minor improvements'.", "No notes yet. Could be a new feature, could be that they moved a button again. 🔘", "Release notes TBD. History suggests one bug fix and three new bugs. 🐛"];
  function renderReleaseNotes() {
    wireRnFilter();
    syncTrackRegion();
    const region = trackRegion();
    const showYouTags = !region || (av() && region === av().market);
    const mine = showYouTags && av() ? av().installedVersion : null;
    const filt = ui.rnFilter;
    // Iterate EVERY tracked build for the region (newest-first, capped for readability) — not
    // just ones with scraped notes. Every build carries a KNOWN FSD build (fsdBuild), so we can
    // always show a real FSD line even when the OS changelog scrape came back empty.
    const vers = WEN.versionsForRegion(region).slice(0, 14);
    const li = (it, fsdNote) => `<li class="${fsdNote ? "rn-li-fsd" : ""}"><span class="rn-tag ${RN_TAG[it.tag] || "rn-feat"}">${esc(it.tag)}</span>${esc(it.text)}</li>`;
    const html = vers.map(vobj => {
      const ver = vobj.version;
      const rn = WEN.releaseNotes[ver] || {};
      const items = rn.items || [];
      const os = items.filter(it => !isFsdItem(it));
      let fsd = items.filter(isFsdItem);
      // the FSD version each OS build carries is REAL (from tracker data) — synthesise an FSD
      // note from it so FSD-only is never wrongly "empty" and every build is properly labelled.
      const fsdBuild = (vobj.fsdBuild && vobj.fsdBuild.AI4 && vobj.fsdBuild.AI4 !== "—") ? vobj.fsdBuild.AI4 : (rn.fsd || null);
      if (!fsd.length && fsdBuild) fsd = [{ tag: "FSD", text: `FSD (Supervised) ${fsdBuild} ships bundled inside this build.` }];
      const isMine = ver === mine;
      const fsdBlock = (filt !== "os" && fsd.length)
        ? `<div class="rn-grp rn-grp-fsd"><div class="rn-grp-h">🤖 FSD (Supervised) ${esc(fsdBuild || "")}</div><ul class="rn-items">${fsd.map(it => li(it, true)).join("")}</ul></div>` : "";
      const osBody = os.length ? `<ul class="rn-items">${os.map(it => li(it, false)).join("")}</ul>`
                               : `<ul class="rn-items"><li class="rn-li-muted">${esc(rnd(NO_OS_NOTES))}</li></ul>`;
      const osBlock = (filt !== "fsd") ? `<div class="rn-grp rn-grp-os"><div class="rn-grp-h">⚙️ OS / firmware ${esc(ver)}</div>${osBody}</div>` : "";
      const blocks = fsdBlock + osBlock;
      if (!blocks) return ""; // FSD-only on a build with no known FSD build → genuinely nothing
      const date = rn.date || vobj.firstSeen || "";
      const regions = ((rn.regions && rn.regions.length) ? rn.regions : WEN.marketsFor(vobj)).map(r => `<span class="rn-region">${esc(r)}</span>`).join("");
      return `<details class="rn-item${isMine ? " rn-mine" : ""}" data-ver="${esc(ver)}"${isMine ? " open" : ""}>` +
        `<summary><span class="rn-ver">${esc(ver)}</span>${isMine ? ' <span class="tag-you">you</span>' : ''}` +
        `${date ? `<span class="rn-date">${esc(shortDate(date))}</span>` : ""}<span class="rn-fsdb">FSD ${esc(fsdBuild || "—")}</span>` +
        `<span class="rn-regions">${regions}</span></summary>` +
        blocks +
        `<div class="rn-src">via ${esc(rn.source || "tracker data")}</div></details>`;
    }).join("");
    $("releaseNotes").innerHTML = html || `<p class="hint">No builds to show for this region yet. ${esc(rnd(["The trackers are still waking up. ☕", "Either everything's up to date or the internet broke. Probably the latter."]))}</p>`;
  }

  // ---- The Five Stages of wenFSD Grief (Kübler-Ross, Tesla edition) ----
  const GRIEF = [
    { key: "denial", emoji: "🙈", name: "Denial", line: `"The trackers are wrong. It's basically installing right now. I can feel it in the steering wheel."` },
    { key: "anger", emoji: "😡", name: "Anger", line: `"WHY does the US get everything first?! Same money, same car, a whole continent of disrespect."` },
    { key: "bargaining", emoji: "🙏", name: "Bargaining", line: `"If I reboot the screen, clear the cache, wash the car AND sacrifice a USB stick… maybe?"` },
    { key: "depression", emoji: "😩", name: "Depression", line: `"I will die on this build. FSD is a bedtime story. Why, WHY did I buy right-hand-drive."` },
    { key: "acceptance", emoji: "🧘", name: "Acceptance", line: `"It is what it is. Autopilot is fine. The wait is the feature. I am at peace. (I am not at peace.)"` },
  ];
  const GRIEF_PLACEHOLDERS = [
    "Vent here. The model is listening. The model cares. (The model is a logistic curve.)",
    "How are we today? Spiral freely.",
    "Describe your pain in 180 characters or fewer.",
    "Dear diary, still on the same build…",
    "Let it out. Tesla won't read this. Neither will Elon. But we will. 🫂",
    "Scream into the void. The void has 8 cameras and still won't change lanes.",
    "Tell us where it hurts (it's the software menu, isn't it).",
    "180 characters. Same limit as the platform that promised you this car. 🐦",
  ];
  const griefByKey = (k) => GRIEF.find(g => g.key === k);
  function predictGrief(pred, v) {
    if (isDownUnderHW3(v)) return { key: "acceptance", why: "You've completed all five stages and looped back to a grim, sunburnt acceptance. There is no FSD. There is only Autopilot and the horizon. 🌅" };
    if (pred && pred.capped) return { key: "acceptance", why: "Your hardware tapped out. Acceptance was selected for you, free of charge." };
    const d = pred && pred.daysToMedian != null ? pred.daysToMedian : 30;
    if (d <= 0) return { key: "anger", why: "You're overdue. The rage is righteous and the group chat has heard about it. Repeatedly." };
    if (d <= 4) return { key: "denial", why: "So close you refuse to emotionally prepare for the inevitable last-minute delay." };
    if (d <= 12) return { key: "bargaining", why: "Close enough to start negotiating with the over-the-air gods. They do not take calls." };
    if (d <= 30) return { key: "anger", why: "Close enough to see it, far enough to resent everyone who already has it." };
    if (d <= 70) return { key: "depression", why: "The horizon keeps receding. The changelog mocks you. This is the long dark tea-time of the OTA." };
    return { key: "acceptance", why: "It's so far away you've made peace, taken up a hobby, and stopped checking. (You're checking right now.)" };
  }
  function renderGrief() {
    const el = $("griefBody"); if (!el) return;
    const v = av();
    if ($("griefSub")) $("griefSub").textContent = flavorPick("sub:griefSub", ["a clinical assessment", "denial is stage one", "you are not alone (you are a little alone)", "grief, but make it OTA", "bill us your therapist's invoice"]);
    if (!v) { el.innerHTML = `<p class="grief-empty">Add your car to begin your healing journey. Grief requires an object of loss — right now you have none. Lucky, unburdened you. 🕊️</p>`; return; }
    let pred = null; try { pred = currentPrediction(); } catch (e) {}
    const pg = predictGrief(pred, v);
    const stage = griefByKey(pg.key);
    const hist = (v.grief || []);
    const latest = hist.length ? hist[hist.length - 1] : null;
    const chips = GRIEF.map(g => `<button type="button" class="grief-chip${ui.griefPick === g.key ? " is-on" : ""}" data-grief="${g.key}" title="${esc(g.line)}"><span class="ge">${g.emoji}</span><span>${g.name}</span></button>`).join("");
    el.innerHTML =
      `<div class="grief-pred grief-${stage.key}"><div class="gp-h">🩺 Our diagnosis: <strong>${stage.emoji} ${stage.name}</strong></div><div class="gp-line">${esc(stage.line)}</div><div class="gp-why">${esc(pg.why)}</div></div>` +
      `<div class="grief-ask">Be honest — where are <em>you</em>, actually?</div>` +
      `<div class="grief-chips">${chips}</div>` +
      `<textarea id="griefNote" class="grief-note" maxlength="180" rows="2" placeholder="${esc(rnd(GRIEF_PLACEHOLDERS))}">${latest ? esc(latest.note || "") : ""}</textarea>` +
      `<button class="btn-sm" id="griefLog" type="button">🕯️ Log how I'm feeling</button>` +
      `<span class="grief-savehint" id="griefSaveHint"></span>` +
      `<div id="griefHistory" class="grief-history"></div>` +
      `<div id="griefCommunity" class="grief-community"></div>`;
    el.querySelectorAll(".grief-chip").forEach(b => b.onclick = () => { ui.griefPick = b.dataset.grief; renderGrief(); });
    $("griefLog").onclick = () => logGrief(pg.key);
    renderGriefHistory(v);
    renderGriefCommunity(v);
  }
  function logGrief(predictedKey) {
    const v = av(); if (!v) return;
    const actual = ui.griefPick || predictedKey;
    const note = (($("griefNote") || {}).value || "").slice(0, 180);
    // real wall-clock timestamp so the journey shows true chronology (predictions use pinned `today`)
    const entry = { ts: new Date().toISOString().slice(0, 10), at: Date.now(), predicted: predictedKey, actual, note };
    gstate = Garage.update(v.id, { grief: (v.grief || []).concat([entry]) });
    if (v.connected && v.optedIn && /^https?:$/.test(location.protocol)) {
      fetch("/api/me/grief", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ stage: actual, predicted: predictedKey, note }) }).then(() => renderGriefCommunity(av())).catch(() => {});
    }
    ui.griefPick = null;
    renderGrief();
    renderUpdateAlert();
    const h = $("griefSaveHint"); if (h) { h.textContent = rnd(["Logged. Catharsis achieved. ✓", "Filed under 'feelings'. ✓", "Noted. Be gentle with yourself. ✓", "Your pain is now data. Thank you. ✓"]); }
  }
  function renderGriefHistory(v) {
    const el = $("griefHistory"); if (!el) return;
    const hist = (v.grief || []).slice().reverse();
    if (!hist.length) { el.innerHTML = `<p class="gh-empty">No entries yet. Log your first stage and start a grief diary future-you will cringe at. 📔</p>`; return; }
    const moved = hist.length > 1 && hist[0].actual !== hist[hist.length - 1].actual;
    el.innerHTML = `<div class="gh-h">📈 Your grief journey <span class="mut-i">— ${hist.length} entr${hist.length === 1 ? "y" : "ies"}${moved ? `, ${griefByKey(hist[hist.length - 1].actual).emoji} → ${griefByKey(hist[0].actual).emoji}` : ""}</span></div>` +
      `<ul class="gh-list">` + hist.map(e => {
        const p = griefByKey(e.predicted), a = griefByKey(e.actual);
        const agree = e.predicted === e.actual;
        return `<li><span class="gh-when">${esc(shortDate(e.ts))}</span>` +
          `<span class="gh-stages">we guessed ${p ? p.emoji : "?"} <b>${p ? p.name : "?"}</b> · you felt ${a ? a.emoji : "?"} <b>${a ? a.name : "?"}</b> ${agree ? '<span class="gh-hit">🎯 we read you like a book</span>' : '<span class="gh-miss">😬 we misjudged you</span>'}</span>` +
          (e.note ? `<span class="gh-note">“${esc(e.note)}”</span>` : "") + `</li>`;
      }).join("") + `</ul>`;
  }
  function renderGriefCommunity(v) {
    const el = $("griefCommunity"); if (!el) return;
    const region = v ? v.market : "Australia";
    if (!/^https?:$/.test(location.protocol)) {
      el.innerHTML = `<div class="gc-h">🌏 How everyone else is coping</div><p class="gc-off">Community grief lives on the real site (wenfsd.info). In this offline preview, you grieve alone — as nature, and Tesla, intended. 🕯️</p>`;
      return;
    }
    el.innerHTML = `<div class="gc-h">🌏 How ${esc(region)} is coping…</div><p class="gc-load">${esc(rnd(["Taking the room's emotional temperature…", "Polling the support group…", "Counting the tears, regionally…"]))}</p>`;
    fetch(`/api/grief?region=${encodeURIComponent(region)}`, { headers: { Accept: "application/json" } })
      .then(r => r.json()).then(d => paintGriefCommunity(d, region))
      .catch(() => { const p = el.querySelector(".gc-load"); if (p) p.textContent = "Couldn't reach the support group. They're probably all still in Denial. 🙈"; });
  }
  function paintGriefCommunity(d, region) {
    const el = $("griefCommunity"); if (!el || !d) return;
    const total = (d.counts && Object.values(d.counts).reduce((a, b) => a + b, 0)) || 0;
    if (!total) {
      el.innerHTML = `<div class="gc-h">🌏 How ${esc(region)} is coping…</div><p class="gc-off">Nobody in ${esc(region)} has logged their grief yet. Be the first to overshare — opt into public sharing in your profile and let it all out. 🫂</p>`;
      return;
    }
    const bars = GRIEF.map(g => {
      const n = (d.counts && d.counts[g.key]) || 0;
      const pct = Math.round((n / total) * 100);
      return `<div class="gc-bar" title="${n} ${g.name}"><span class="gc-emoji">${g.emoji}</span><span class="gc-track"><span class="gc-fill grief-${g.key}" style="width:${Math.max(2, pct)}%"></span></span><span class="gc-pct">${pct}%</span></div>`;
    }).join("");
    const notes = (d.notes || []).slice(0, 8).map(n => {
      const g = griefByKey(n.stage);
      return `<li><span class="gcn-stage">${g ? g.emoji : "❔"}</span><span class="gcn-who">${esc(n.handle || "anon")}</span><span class="gcn-note">“${esc(n.note)}”</span></li>`;
    }).join("");
    el.innerHTML = `<div class="gc-h">🌏 How ${esc(region)} is coping <span class="mut-i">— ${total} grieving${d.sample ? " · sample" : ""}</span></div>` +
      `<div class="gc-bars">${bars}</div>` +
      (notes ? `<div class="gc-notes-h">Latest from the support group:</div><ul class="gc-notes">${notes}</ul>` : "") +
      `<p class="gc-foot">${esc(rnd(["Misery, aggregated. You are not alone. 🫂", "A problem shared is a problem still not patched.", "Group therapy, fleet-weighted."]))}</p>`;
  }

  // ---- Rollout pace: estimated vehicles/day on a newer build, grounded vs observed share ----
  const fmtN = (n) => n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "") + "k" : String(Math.round(n));
  function paceSeries(N, horizon) {
    // sum of each rolling build's logistic *pace* (cars/day = N·share·k·CDF·(1−CDF)).
    // mature/legacy builds have t0 in the past, so their pace today is ~0 — they fall out naturally.
    const out = [];
    const vers = (WEN.versions || []).filter(v => v.t0 && v.k && v.fleetPct);
    for (let h = 0; h <= horizon; h++) {
      let cars = 0;
      for (const v of vers) {
        const t0off = Predict.daysBetween(today, v.t0);
        const cdf = 1 / (1 + Math.exp(-v.k * (h - t0off)));
        cars += N * (v.fleetPct / 100) * v.k * cdf * (1 - cdf);
      }
      out.push({ day: h, cars });
    }
    return out;
  }
  function renderRolloutPace() {
    const card = $("paceChart"); if (!card) return;
    const N = (WEN.stats && WEN.stats.carsTracked) || 18000;
    const horizon = 30;
    const series = paceSeries(N, horizon);
    Charts.rolloutPace(card, series, today);

    const sum = (a, b) => series.slice(a, b + 1).reduce((s, x) => s + x.cars, 0);
    const win = ui.paceWindow || "day";
    const winN = win === "day" ? series[0].cars : win === "week" ? sum(0, 6) : sum(0, 29);
    const winLbl = win === "day" ? "today" : win === "week" ? "next 7 days" : "next 30 days";
    // peak day of the coming wave
    let peakI = 0; series.forEach((s, i) => { if (s.cars > series[peakI].cars) peakI = i; });
    const peakDate = peakI === 0 ? "today" : Predict.fmtDate(Predict.addDays(today, peakI)).replace(/^\w+, /, "");
    // observed: real installed base currently on the actively-rolling builds (trackers' fleetPct × N)
    const rollingShare = (WEN.versions || []).filter(v => /rolling|tapering/.test(v.status)).reduce((s, v) => s + (v.fleetPct || 0), 0);
    const observed = Math.min(N, Math.round(N * rollingShare / 100)); // merged tracker %s can sum >100; never claim more than the fleet
    const newest = (WEN.versions || [])[0];

    $("paceStats").innerHTML =
      `<div class="pace-stat pace-est"><div class="pace-num">~${fmtN(winN)}</div><div class="pace-lbl">est. cars updating · <b>${winLbl}</b></div><div class="pace-sub">🔮 modelled</div></div>` +
      `<div class="pace-stat pace-obs"><div class="pace-num">${fmtN(observed)}</div><div class="pace-lbl">cars observed on the current wave</div><div class="pace-sub">✓ real · trackers + connected cars</div></div>` +
      `<div class="pace-stat"><div class="pace-num">~${fmtN(series[peakI].cars)}<span class="pace-day">/day</span></div><div class="pace-lbl">projected peak · <b>${esc(peakDate)}</b></div><div class="pace-sub">🔮 modelled</div></div>`;

    const monthTot = sum(0, 29);
    $("paceFoot").innerHTML = `Across ~${fmtN(N)} tracked cars${newest ? `, the current front-runner is <strong>${esc(newest.version)}</strong> (${newest.fleetPct}% of the fleet)` : ""}. ` +
      `The model expects <strong>~${fmtN(monthTot)}</strong> cars to move onto a newer build over the next month. ${rnd(["Your turn's in there somewhere. 🤞", "Statistically, someone's updating right now and bragging about it.", "Two weeks. For ~" + fmtN(Math.round(winN)) + " of them, maybe literally."])}`;

    // window toggle
    const tog = $("paceToggle");
    if (tog && !tog._wired) {
      tog._wired = true;
      tog.querySelectorAll(".pace-btn").forEach(b => b.onclick = () => {
        ui.paceWindow = b.dataset.pace;
        tog.querySelectorAll(".pace-btn").forEach(x => x.classList.toggle("is-on", x === b));
        renderRolloutPace();
        renderHumour();
        renderGrief();
        renderUpdateAlert();
      });
    }
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
        (d ? stat("Ships to", (() => { const m = WEN.marketsFor(d); return m.length >= WEN.allMarkets.length ? "🌍 all regions" : "📍 " + m.join(", "); })()) : "") +
        (d && d.recentInstalls ? stat("Installs this week", "🔥 " + Number(d.recentInstalls).toLocaleString()) : "") +
      `</div>` +
      (regions.length ? `<div class="vm-regions"><span class="vm-k">Seen in:</span> ${regions.map(r => `<span class="rn-region">${esc(r)}</span>`).join("")}</div>` : "") +
      (d && d.sources && d.sources.length ? `<div class="vm-src">via ${d.sources.map(esc).join(" · ")}</div>` : "") +
      (notesItems ? `<div class="vm-notes-h">Release notes${rn.source ? ` <span class="mut-i">via ${esc(rn.source)}</span>` : ""}</div><ul class="rn-items">${notesItems}</ul>` : `<p class="vm-nonotes">${esc(rnd(["No release notes captured for this build yet. Tesla's keeping this one mysterious. 🤫", "No notes yet — the changelog is still 'two weeks' away. Of course it is.", "Notes pending. The dog ate Tesla's changelog, allegedly.", "No release notes captured. Assume it 'improves stability' — they always say that."]))}</p>`);
    _modalReturnFocus = document.activeElement;          // remember what to restore focus to
    $("verModal").hidden = false;
    document.body.style.overflow = "hidden";
    const cl = $("verModalClose"); if (cl) cl.focus();
  }
  let _modalReturnFocus = null;
  function closeVersionModal() {
    const m = $("verModal"); if (!m || m.hidden) return;
    m.hidden = true; document.body.style.overflow = "";
    if (_modalReturnFocus && _modalReturnFocus.focus) { try { _modalReturnFocus.focus(); } catch (e) {} }  // restore focus to the trigger
    _modalReturnFocus = null;
  }
  // keep Tab focus inside the open dialog (simple focus trap)
  function trapModalFocus(e) {
    const m = $("verModal"); if (!m || m.hidden || e.key !== "Tab") return;
    const f = m.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

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
      return `<div class="rp-row ${isShown ? "rp-active" : ""} rp-click" data-explore-region="${esc(name)}" role="button" tabindex="0" aria-label="Explore ${esc(name)} rollout" title="Explore ${esc(name)}">` +
        `<div class="rp-name">${esc(name)}${isCar ? ' <span class="tag-you">you</span>' : ''} <span class="rp-drive">${r.drive}</span></div>` +
        `<div class="rp-lag" title="${esc(lag === 0 ? "First dibs. The rest of the planet waits on you." : lag <= 3 ? "Barely waiting. Insufferable." : lag <= 10 ? "A polite, civilised wait." : "Certified suffering. Hang in there.")}">${lag === 0 ? "🥇 US baseline" : "+" + lag + "d " + (lag <= 3 ? "😎" : lag <= 10 ? "😬" : "🐌")}</div>` +
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
  // ---- region build-path filter shared across the tracking sections ----
  function trackRegion() { return ui.trackRegion || ""; }   // "" ⇒ all regions
  function syncTrackRegion() {
    document.querySelectorAll(".js-track-region").forEach(sel => {
      if (!sel.dataset.filled) {
        sel.innerHTML = `<option value="">🌍 All regions</option>` +
          WEN.allMarkets.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join("");
        sel.dataset.filled = "1";
        sel.addEventListener("change", () => {
          ui.trackRegion = sel.value;
          renderTable(); renderFeed(); renderReleaseNotes(); renderRolloutPace(); syncTrackRegion();
        });
      }
      sel.value = trackRegion();
    });
  }
  // a little region availability chip for a build (🌍 = everyone, 📍N = limited)
  function mktChip(v) {
    const m = WEN.marketsFor(v), all = WEN.allMarkets.length;
    if (m.length >= all) return `<span class="mkt-chip mkt-all" title="Ships to every tracked market">🌍</span>`;
    return `<span class="mkt-chip mkt-some" title="Only ships to: ${esc(m.join(", "))}">📍${m.length}</span>`;
  }
  function regionNoteFor(list, region) {
    if (!region) return `Showing <strong>all ${list.length}</strong> tracked builds across every region. 🌍 = global build · 📍N = only reaches N markets. ${rnd(["The US &amp; Canada hoard the point releases like the last Tim Bit. 🍩", "Some of these builds will never grace a right-hand-drive driveway. C'est la vie. 🚗", "Yes, North America gets more builds. No, complaining hasn't worked yet."])}`;
    const missing = WEN.versions.filter(v => !WEN.inRegion(v, region)).map(v => v.version);
    const miss = missing.length ? ` <span class="track-miss">Skipped here: ${missing.map(esc).join(", ")}.</span>` : "";
    return `Showing the <strong>${list.length}</strong> build${list.length === 1 ? "" : "s"} that actually reach <strong>${esc(region)}</strong>, with dates shifted to when ${esc(region)} typically sees them.${miss} ${rnd(["This is YOUR build path — not North America's wishlist.", "Fewer builds, more character. 🫡", "What you see is what you (eventually) get."])}`;
  }
  const KNOWN_STATUS = new Set(["rolling", "tapering", "mature", "legacy"]);
  function statusClass(s) { return KNOWN_STATUS.has(String(s)) ? String(s) : "legacy"; }  // allowlist → safe CSS class
  function renderTable() {
    syncTrackRegion();
    const region = trackRegion();
    const list = WEN.versionsForRegion(region);
    const mine = av() ? av().installedVersion : null;
    const nextVer = av() ? (currentPrediction().targetLabel || null) : null;
    const showYouTags = !region || (av() && region === av().market);
    if ($("fwRegionNote")) $("fwRegionNote").innerHTML = regionNoteFor(list, region);
    $("fwBody").innerHTML = list.map(v => {
      const isMine = showYouTags && v.version === mine;
      const isNext = showYouTags && nextVer && v.version === nextVer;
      const seen = region ? WEN.regionFirstSeen(v, region) : v.firstSeen;
      return `<tr class="${isMine ? "mine" : ""}${isNext ? " fw-next" : ""}">` +
        `<td>${mktChip(v)} <strong class="fw-verlink" data-goto-version="${esc(v.version)}" role="button" tabindex="0" title="Details for ${esc(v.version)}">${esc(v.version)}</strong>${isMine ? ' <span class="tag-you">you</span>' : ''}${isNext ? ' <span class="tag-next">next</span>' : ''}</td>` +
        `<td><span class="status status-${esc(statusClass(v.status))}">${esc(v.status)}</span></td>` +
        `<td>${v.fleetPct != null ? `<div class="pctcell"><span class="pctbar" style="width:${Math.min(100, v.fleetPct * 2.2)}%"></span><em>${v.fleetPct}%</em></div>` : `<span class="mut-i">not reported</span>`}</td>` +
        `<td>${v.fleetPct != null ? sparkSVG(v) : "—"}</td>` +
        `<td>${seen ? shortDate(seen) : "—"}</td><td>${esc((v.fsdBuild && v.fsdBuild.AI4) || "—")}</td>` +
        `<td class="notes">${v.recentInstalls ? `<span class="fw-active">🔥 ${Number(v.recentInstalls).toLocaleString()} installs this week</span>` : esc(v.notes || "")}</td></tr>`;
    }).join("");
  }
  function renderStats() {
    if (WEN.dataMode !== "live") {
      $("statsStrip").innerHTML = `<div class="stats-sample">${rnd(["Fleet totals show up here once real cars connect. We refuse to make up numbers — that's Tesla's delivery-date job. 📦", "Big fleet stats appear once cars connect. Until then, this space is as empty as a robotaxi's driver seat. 🚕", "Real numbers land here when cars connect. We don't do vibes-based statistics (unlike some range estimates we could mention). 🔋", "Connect a car and the counters wake up. Like Sentry Mode, but useful."])}</div>`;
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
    syncTrackRegion();
    const region = trackRegion();
    const rows = WEN.versionsForRegion(region)
      .filter(v => v.firstSeen)
      .map(v => ({ v, seen: region ? WEN.regionFirstSeen(v, region) : v.firstSeen }))
      .sort((a, b) => String(b.seen).localeCompare(String(a.seen)))
      .slice(0, 8);
    if (!rows.length) { feed.innerHTML = `<li class="feed-empty">No recent rollout activity yet.</li>`; $("feedSub").textContent = ""; return; }
    const showYouTags = !region || (av() && region === av().market);
    const mine = av() ? av().installedVersion : null;
    const nextVer = av() ? (currentPrediction().targetLabel || null) : null;
    feed.innerHTML = rows.map(({ v, seen }) => {
      const pct = v.fleetPct != null ? `${v.fleetPct}% of fleet` : null;
      const inst = v.recentInstalls ? `🔥 ${Number(v.recentInstalls).toLocaleString()} installs/wk` : null;
      const fsd = (v.fsdBuild && v.fsdBuild.AI4 && v.fsdBuild.AI4 !== "—") ? `FSD ${v.fsdBuild.AI4}` : null;
      const meta = [pct, inst, fsd].filter(Boolean).join(" · ");
      const src = (v.sources && v.sources.length) ? `via ${v.sources.join(", ")}` : "";
      const tag = showYouTags && v.version === mine ? ' <span class="tag-you">you</span>' : (showYouTags && nextVer && v.version === nextVer ? ' <span class="tag-next">next</span>' : "");
      return `<li><span class="feed-when">${shortDate(seen)}</span>` +
        `<span class="feed-main">${mktChip(v)} <strong class="feed-relver" data-goto-version="${esc(v.version)}" role="button" tabindex="0" title="Details for ${esc(v.version)}">${esc(v.version)}</strong>${tag}${meta ? ` <span class="feed-meta">${esc(meta)}</span>` : ""}</span>` +
        `<span class="feed-ver">${esc(src)}</span></li>`;
    }).join("");
    $("feedSub").textContent = region ? `${rows.length} in ${region}` : `${rows.length} recent · all regions`;
  }

  // ---------------- events ----------------
  function wire() {
    // delegated clicks for dynamically-rendered interactive elements (region rows, FSD
    // matrix rows, firmware/feed version links) — bound once, survive re-renders.
    function handleActivate(e) {
      const sec = e.target.closest(".js-open-security");
      if (sec) { e.preventDefault(); const d = $("securityDetails"); if (d) { d.open = true; d.scrollIntoView({ behavior: "smooth", block: "start" }); } return; }
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
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeVersionModal(); else if (e.key === "Tab") trapModalFocus(e); });

    $("guessBtn").onclick = () => lockInGuess(currentPrediction());
    // when the collapsed "fleet data" section opens, re-render the pace chart so it sizes to the
    // now-visible container (charts measured 0 width while the <details> was closed)
    const moreData = $("moreData");
    if (moreData) moreData.addEventListener("toggle", () => { if (moreData.open) { try { renderRolloutPace(); renderRegions(); } catch (e) {} } });
    window.addEventListener("resize", debounce(() => render(), 150));
  }
  function debounce(fn, ms) { let t; return () => { clearTimeout(t); t = setTimeout(fn, ms); }; }
  function shortDate(d) { return new Date(d).toLocaleDateString("en-AU", { day: "numeric", month: "short" }); }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // ---------------- boot ----------------
  // Expose the live-data bridge FIRST, before any render runs — so js/api.js can always
  // call setLinkState/addConnectedVehicles even if a boot render throws.
  window.WENFSD = {
    rerender() { renderFSD(); renderStats(); renderDataMode(); renderFeed(); render(); },
    setSources(list, live) { renderDataSources(list, live); },
    setCalibration(cal) { renderCalibration(cal); renderScoreboard(cal); },
    addConnectedVehicles, setLinkState, addHistory,
    get activeVehicle() { return av(); },
  };

  $("todayLabel").textContent = new Date(today + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  renderGarage();
  renderActiveControls();
  wireAddForm();
  wireQuickStart();
  renderFSD();
  renderStats();
  renderDataMode();
  renderDataSources();
  renderFeed();
  renderCalibration();
  renderScoreboard();
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
          pendingUpdate: v.pending_version ? { version: v.pending_version, status: v.pending_status, download: v.pending_download, install: v.pending_install } : null,
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
          pendingUpdate: v.pending_version ? { version: v.pending_version, status: v.pending_status, download: v.pending_download, install: v.pending_install } : null,
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
      el.innerHTML = `Not linked to a Tesla account on this device. <strong>Connect Tesla account</strong> below to auto-track — or just add your car manually above.`;
    }
  }
})();
