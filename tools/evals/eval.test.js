// The deterministic eval as a test: it must pass on the current logic, and must FAIL on the logic from before the
// missed-shuttle fix (proof that it can see that class of bug at all).
//   node --test tools/evals/eval.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const run = (...args) => {
  const report = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "eval-")), "report.json");
  const r = spawnSync(process.execPath, [path.join(__dirname, "shuttle-eval.js"), ...args, "--report", report], { encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr, report: JSON.parse(fs.readFileSync(report, "utf8")) };
};

test("every recorded moment passes: never a time after the shuttle left, never dropped at the curb", () => {
  const r = run();
  assert.equal(r.status, 0, r.out);
  assert.ok(r.report.totals.checks > 5000, "the recordings actually exercise the checks");
  for (const rec of r.report.recordings) for (const st of rec.stops) assert.ok(st.departures > 0, `${rec.file}: ${st.stop} has GPS departures to check against`);
});

test("canary: the pre-fix logic fails the same eval", () => {
  const r = run("--naive");
  assert.equal(r.status, 1, "the old logic must fail");
  const kinds = new Set(r.report.failures.map((f) => `${f.check} @ ${f.stop}`));
  assert.ok(kinds.has("SAFE @ Lombard Gate"), "old: told a time after the shuttle left Lombard Gate (the 6:34 bug)");
  assert.ok(kinds.has("SAFE @ Drumm & California"), "old: Drumm predictions minutes after it left");
  assert.ok(kinds.has("LISTED @ Lombard Gate") && kinds.has("LISTED @ 50 Beale"), "old: dropped while still at the stop");
});
