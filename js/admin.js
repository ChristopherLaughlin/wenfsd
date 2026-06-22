/* wenFSD — creator-only dashboard. Token-gated; talks to /api/admin/stats. No third parties. */
(function () {
  const $ = (id) => document.getElementById(id);
  const app = $("adminApp");
  const KEY = "wenfsd_admin_token";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function gate() {
    const saved = sessionStorage.getItem(KEY) || "";
    app.innerHTML =
      `<div class="card" style="max-width:460px">` +
      `<label class="field"><span>Admin token</span>` +
      `<input type="password" id="adminTok" placeholder="paste your ADMIN_TOKEN" value="${esc(saved)}" autocomplete="off"/></label>` +
      `<button class="btn" id="adminGo" style="margin-top:10px">Show me the numbers 📊</button>` +
      `<p class="hint" id="adminErr" style="color:var(--acc2);margin-top:10px"></p>` +
      `</div>`;
    $("adminGo").onclick = load;
    $("adminTok").onkeydown = (e) => { if (e.key === "Enter") load(); };
  }

  function load() {
    const tok = ($("adminTok") ? $("adminTok").value : sessionStorage.getItem(KEY) || "").trim();
    if (!tok) return;
    sessionStorage.setItem(KEY, tok);
    app.innerHTML = `<p class="hint">Counting your adoring public… 🫶</p>`;
    fetch("/api/admin/stats", { headers: { "x-admin-token": tok, Accept: "application/json" } })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j.error || ("HTTP " + r.status))))
      .then(render)
      .catch(err => { gate(); const e = $("adminErr"); if (e) e.textContent = "✗ " + (typeof err === "string" ? err : "couldn't load") + ". Wrong token, or ADMIN_TOKEN isn't set on the server."; });
  }

  function tile(big, label, sub) {
    return `<div class="cal-tile"><div class="cal-big">${esc(big)}</div><div class="cal-h" style="margin-top:4px">${esc(label)}</div>${sub ? `<div class="cal-sub">${esc(sub)}</div>` : ""}</div>`;
  }
  function barRows(rows, labelKey, valKeys) {
    if (!rows || !rows.length) return `<p class="hint">No data yet. The internet hasn't found you. Post the link. 📣</p>`;
    const max = Math.max(1, ...rows.map(r => Math.max(...valKeys.map(k => +r[k] || 0))));
    return `<div class="region-panel">` + rows.map(r => {
      const lbl = esc(r[labelKey]);
      const segs = valKeys.map(k => {
        const v = +r[k] || 0;
        return `<span class="rp-eta">${esc(k)}: <strong>${v.toLocaleString()}</strong></span><div class="rp-bar"><span style="width:${Math.max(2, (v / max) * 100)}%"></span></div>`;
      }).join("");
      return `<div class="rp-row"><div class="rp-name">${lbl}</div>${segs}</div>`;
    }).join("") + `</div>`;
  }

  function render(d) {
    const sample = d.mode === "sample";
    const totViews = (d.visitsByDay || []).reduce((a, b) => a + (+b.views || 0), 0);
    const totUniques = (d.visitsByDay || []).reduce((a, b) => a + (+b.uniques || 0), 0);
    app.innerHTML =
      (sample ? `<div class="sample-banner" style="margin:0 0 14px">⚠️ <strong>Sample numbers</strong> — the server is in mock mode or has no database. These are fake so you can see the layout. Real figures appear once the live DB is connected.</div>` : "") +
      `<div class="cal-grid">` +
        tile((d.signups || 0).toLocaleString(), "signups (Tesla accounts linked)", `${(d.usersWithEmail || 0)} shared an email`) +
        tile((d.vehicles || 0).toLocaleString(), "cars linked", `${(d.optedIn || 0)} opted into sharing`) +
        tile(totUniques.toLocaleString(), "unique visitors (last 30d)", `${totViews.toLocaleString()} page views`) +
        tile((d.guesses || 0).toLocaleString(), "shots called", `${(d.guessesSettled || 0)} settled · ${(d.griefLogs || 0)} grief logs`) +
      `</div>` +
      `<h2 class="card-h" style="margin:22px 0 10px">Signups by region <span class="card-sub">where your people are</span></h2>` +
      `<div class="card">${barRows(d.byRegion, "market", ["n"])}</div>` +
      `<h2 class="card-h" style="margin:22px 0 10px">Traffic <span class="card-sub">views &amp; rough uniques, by day</span></h2>` +
      `<div class="card">${dayTable(d.visitsByDay, ["views", "uniques"])}</div>` +
      `<h2 class="card-h" style="margin:22px 0 10px">New signups <span class="card-sub">by day</span></h2>` +
      `<div class="card">${dayTable(d.signupsByDay, ["n"])}</div>` +
      `<p class="hint" style="margin-top:18px">🔒 Visit counts are cookieless: a salted daily hash of IP+user-agent (not the IP itself), pruned after 90 days. Refresh to update. <a href="/" style="color:var(--cyan)">← back to the site</a></p>` +
      `<button class="btn-sm" id="adminLogout" style="margin-top:8px">Forget my token (this device)</button>`;
    $("adminLogout").onclick = () => { sessionStorage.removeItem(KEY); gate(); };
  }
  function dayTable(rows, valKeys) {
    if (!rows || !rows.length) return `<p class="hint">Nothing logged yet. Either nobody's visited or the counter just woke up. ☕</p>`;
    const max = Math.max(1, ...rows.map(r => +r[valKeys[0]] || 0));
    return `<div class="region-panel">` + rows.map(r => {
      const v = +r[valKeys[0]] || 0;
      const extra = valKeys.slice(1).map(k => `${esc(k)} ${(+r[k] || 0).toLocaleString()}`).join(" · ");
      return `<div class="rp-row"><div class="rp-name" style="font-family:var(--mono)">${esc(r.day)}</div>` +
        `<div class="rp-bar"><span style="width:${Math.max(2, (v / max) * 100)}%"></span></div>` +
        `<div class="rp-eta"><strong>${v.toLocaleString()}</strong>${extra ? " · " + esc(extra) : ""}</div></div>`;
    }).join("") + `</div>`;
  }

  // auto-load if a token is already remembered this session
  if (sessionStorage.getItem(KEY)) load(); else gate();
})();
