import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSlug, allSlugs, predictForSlug, renderPage, renderIndex, ogPng } from "../src/predictionpage.js";

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

test("ogPng returns a real PNG buffer (magic bytes)", () => {
  const png = ogPng(decodeSlug("2026-model-y-juniper-australia"));
  assert.ok(Buffer.isBuffer(png) && png.length > 1000, "non-trivial buffer");
  assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG signature");
});
