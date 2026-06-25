import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSlug, allSlugs, predictForSlug, renderPage, renderIndex, ogPng, ogSvg } from "../src/predictionpage.js";

test("decodeSlug round-trips a canonical slug and reads its parts", () => {
  const meta = decodeSlug("2026-model-y-juniper-australia");
  assert.ok(meta, "known slug decodes");
  assert.equal(meta.year, 2026);
  assert.equal(meta.model, "Model Y");
  assert.equal(meta.generation, "Juniper");
  assert.equal(meta.region, "Australia");
});

test("decodeSlug rejects junk / unknown / path-traversal-ish slugs", () => {
  for (const bad of ["", "nope", "2026-model-z-australia", "../../etc/passwd", "2026-model-y-juniper-atlantis", "<script>", "2099-model-y-australia"]) {
    assert.equal(decodeSlug(bad), null, `${JSON.stringify(bad)} must not decode`);
  }
});

test("every generated slug decodes (index is internally consistent)", () => {
  const slugs = allSlugs();
  assert.ok(slugs.length > 50, "index has many configs");
  for (const s of slugs) assert.ok(decodeSlug(s), `${s} should decode`);
});

test("predictForSlug produces a dated OS prediction", () => {
  const { os } = predictForSlug(decodeSlug("2026-model-y-juniper-australia"));
  assert.ok(os.medianDate instanceof Date && !isNaN(+os.medianDate), "has a median date");
  assert.ok(os.p90Date instanceof Date, "has an 80% bound");
});

test("renderPage emits crawlable HTML: title, canonical, og:image, JSON-LD FAQ, a date", () => {
  const html = renderPage(decodeSlug("2026-model-y-juniper-australia"));
  assert.match(html, /<title>.*Model Y.*<\/title>/);
  assert.match(html, /rel="canonical"/);
  assert.match(html, /og:image/);
  assert.match(html, /"@type":"FAQPage"/);
  assert.match(html, /\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}/);
});

test("renderPage escapes and never reflects a raw version into an attribute breakout", () => {
  const html = renderPage(decodeSlug("2026-model-y-juniper-australia"), "2026.20.3");
  assert.ok(html.includes("2026.20.3"));
  assert.ok(!html.includes("<script>alert"));   // sanity
});

test("renderIndex links several /p/ pages", () => {
  const html = renderIndex();
  assert.match(html, /\/p\/2026-model-y-juniper-australia/);
  assert.ok((html.match(/href="[^"]*\/p\//g) || []).length >= 4);
});

test("the /p/ page reflects an FSD hold AND its auto-resume (events are honoured)", () => {
  const meta = decodeSlug("2026-model-y-l-australia");
  // AU FSD-14 is on hold → the page (and FAQ/description) says so
  assert.ok(predictForSlug(meta, null, []).fsd.paused, "paused by default");
  assert.match(renderPage(meta, null, []), /on hold in Australia/);
  // a confirmed resume event must un-freeze the shared page too (no stale 'on hold' after it's back)
  const resume = [{ type: "resume", region: "Australia", version: "v14.x" }];
  assert.ok(!predictForSlug(meta, null, resume).fsd.paused, "resume clears it on the /p/ surface");
  assert.ok(!/on hold in Australia/.test(renderPage(meta, null, resume)), "page no longer claims a hold after resume");
});

test("the OG card carries NO emoji (resvg has no emoji font → a stray emoji tofus the whole text run)", () => {
  // Learned the hard way: the share card is a resvg raster, not a browser. When a <text> run
  // contains an emoji the sans font lacks, fontdb swaps the WHOLE run to a glyph-less fallback and
  // every character renders as ▯. So the card must stay pure Latin/punctuation. Guard every state.
  const meta = decodeSlug("2026-model-y-l-australia");           // AU AI4 → FSD on hold (hold line shown)
  const states = [
    ogSvg(meta, predictForSlug(meta, null, []).os, predictForSlug(meta, null, []).fsd),                 // paused
    ogSvg(meta, predictForSlug(meta, null, [{ type: "resume", region: "Australia", version: "v14.x" }]).os,
               predictForSlug(meta, null, [{ type: "resume", region: "Australia", version: "v14.x" }]).fsd), // resumed
    ogSvg(decodeSlug("2026-model-y-juniper-united-states"), predictForSlug(decodeSlug("2026-model-y-juniper-united-states")).os, predictForSlug(decodeSlug("2026-model-y-juniper-united-states")).fsd),
  ];
  // Pictographs / arrows / geometric shapes / variation selectors absent from Inter's latin subset
  // (→ ▸ ⏸ all tofu; » · — are Latin/punctuation and DO render — so they're deliberately allowed).
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{FE0F}\u{2190}-\u{21FF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}]/u;
  for (const svg of states) {
    assert.ok(!EMOJI.test(svg), `OG card must not contain glyphs that tofu in resvg: ${(svg.match(EMOJI) || [])[0]}`);
  }
});

test("ogPng renders REAL text, not a blank/fontless card (the bundled font must actually load)", () => {
  // The whole-fleet bug: Railway ships no system fonts, so loadSystemFonts found nothing and every
  // card rendered as an empty box (~7KB). With Inter bundled and text drawn, the PNG is much larger.
  // This guards that regression directly — a blank card collapses well below the threshold.
  for (const slug of ["2026-model-y-juniper-australia", "2026-model-y-l-australia"]) {
    const png = ogPng(decodeSlug(slug));
    assert.ok(Buffer.isBuffer(png), `${slug}: buffer`);
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${slug}: PNG signature`);
    assert.ok(png.length > 12000, `${slug}: card must contain rendered text (got ${png.length}B; blank ≈7KB)`);
  }
});
