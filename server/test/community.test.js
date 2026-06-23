import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPost, scoreCorroboration } from "../src/community.js";

test("classifyPost extracts a pause with version + region from a real-sounding report", () => {
  const c = classifyPost("Got an email — Tesla paused the 2026.20.3 rollout in Australia due to unforeseen issues");
  assert.ok(c);
  assert.equal(c.type, "pause");
  assert.equal(c.version, "2026.20.3");
  assert.equal(c.region, "Australia");
  assert.ok(c.confidence >= 0.8);
});

test("classifyPost detects resume / halt and prefers them over the word 'pause'", () => {
  assert.equal(classifyPost("the AU software rollout is rolling again after the pause").type, "resume");
  assert.equal(classifyPost("they pulled the 2026.20 firmware rollout entirely").type, "halt");
});

test("classifyPost ignores off-topic text (no rollout context)", () => {
  assert.equal(classifyPost("I paused my podcast to drive the car"), null);
  assert.equal(classifyPost("just a normal day, no news"), null);
});

test("classifyPost needs a state cue — pure version mention isn't an event", () => {
  assert.equal(classifyPost("anyone else on 2026.20.3 firmware?"), null);
});

test("lower confidence when version/region are absent", () => {
  const c = classifyPost("heard the FSD rollout got paused somewhere");
  assert.ok(c && c.type === "pause");
  assert.ok(c.confidence < 0.8, "no version/region ⇒ weaker");
});

test("scoreCorroboration lifts confidence with independent sources but caps below certainty", () => {
  const scored = scoreCorroboration([
    { type: "pause", version: "2026.20.3", region: "Australia", confidence: 0.6, source: "community-report" },
    { type: "pause", version: "2026.20.3", region: "Australia", confidence: 0.6, source: "reddit" },
    { type: "pause", version: "2026.20.3", region: "Australia", confidence: 0.6, source: "observed-plateau" },
  ]);
  assert.equal(scored.length, 1);
  assert.equal(scored[0].count, 3);
  assert.equal(scored[0].distinctSources, 3);
  assert.ok(scored[0].confidence > 0.6 && scored[0].confidence <= 0.97);
});
