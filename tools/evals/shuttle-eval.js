#!/usr/bin/env node
// Deterministic eval for /presidio/: replay recorded Presidio GO feeds through the real engine + display rule and
// check, at every recorded moment and each of her stops, against when the shuttle actually left (its GPS):
//
//   SAFE      never shows a departure time after the shuttle actually left (the missed-6:34 class of bug)
//   LISTED    a tracked run is on the list from 30 min before until it actually leaves (not dropped at the curb)
//   NO_GUESS  a run whose shuttle isn't on it yet is never shown later than the timetable
//   HONEST    "N min late" only when the shuttle's GPS is on that run
//   WARNED    a shuttle that leaves 2.5+ min late reads late from a minute past its timetable time until it comes
//             (the Oct 7 4:02 from Drumm said "1 min early", came ~4 min late, and never said so)
//
//   node tools/evals/shuttle-eval.js [recording.jsonl[.gz] ...] [--report out.json] [--naive]
// Default: every recording in tools/evals/recordings/. Exits 1 on any failure.
// --naive replays the logic from before the fix (expected to FAIL; the canary that proves the eval can see the bug).
"use strict";
const fs = require("fs");
const path = require("path");
const L = require("./lib");

const args = process.argv.slice(2);
const naive = args.includes("--naive");
const Timing = naive ? L.NaiveTiming : require("../../presidio/timing");
const reportAt = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;
const files = L.recordingFiles(args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--report"));

const report = { recordings: [], failures: [], totals: { moments: 0, checks: 0, failures: 0 } };
for (const file of files) {
  const samples = L.loadRecording(file);
  if (samples.length < 2) continue;
  const gtfs = fs.existsSync(file.replace(/\.jsonl(\.gz)?$/, ".gtfs.zip")) ? file.replace(/\.jsonl(\.gz)?$/, ".gtfs.zip")
                                                                           : path.join(path.dirname(file), "gtfs.zip");
  const model = L.loadModel(gtfs);
  const rec = { file: path.basename(file), from: L.hm(samples[0].t), to: L.hm(samples.at(-1).t), samples: samples.length, stops: [] };
  for (const stop of L.STOPS) {
    const actual = L.actualDepartures(model, samples, stop.from, L.loadLabels(file));
    const st = { stop: stop.name, departures: Object.keys(actual).length, checks: 0, failures: 0, margins: [] };
    const fail = (check, smp, trip, detail) => {
      st.failures++;
      report.failures.push({ recording: rec.file, stop: stop.name, check, at: L.hm(smp.t), trip, ...detail });
    };
    for (const smp of samples) {
      const list = L.departuresAt(model, smp, stop, naive);
      report.totals.moments++;
      for (const d of list) {
        const shown = Timing.departs(d);
        // NO_GUESS / HONEST: the display rule itself.
        st.checks += 2;
        if (!Timing.onRun(d) && shown > d.sched + (naive ? 59 : 0)) fail("NO_GUESS", smp, d.trip, { shown: L.hm(shown), sched: L.hm(d.sched), status: d.status });
        if (/min late$/.test(Timing.status(d)[1]) && !Timing.onRun(d)) fail("HONEST", smp, d.trip, { label: Timing.status(d)[1], status: d.status });
        // SAFE: against what actually happened.
        const a = actual[d.trip];
        if (!a || smp.t >= a.left) continue;
        st.checks++;
        if (shown > a.left + L.SAMPLE_SLACK_S) fail("SAFE", smp, d.trip, { shown: L.hm(shown), left: L.hm(a.left), status: d.status, late_by_s: shown - a.left });
        if (Timing.onRun(d)) st.margins.push(a.left - shown);
      }
      // LISTED: every run that later leaves is on the list from 30 min before its timetable time until it goes.
      // WARNED: one that leaves 2.5+ min late says "late" from a minute past its time until it gets there.
      for (const [trip, a] of Object.entries(actual)) {
        if (smp.t < Math.min(a.sched, a.left) - 30 * 60 || smp.t > a.left - 15) continue;
        st.checks++;
        const d = list.find((x) => x.trip === trip);
        if (!d) { fail("LISTED", smp, trip, { left: L.hm(a.left), sched: L.hm(a.sched) }); continue; }
        if (a.left - a.sched < 150 || smp.t < a.sched + 60 || smp.t > a.left - 30 || d.atStop) continue;
        st.checks++;
        const label = (Timing.label ? Timing.label(d) : Timing.status(d))?.[1] || "";
        if (!/late/.test(label)) fail("WARNED", smp, trip, { label: label || "(none)", shown: L.hm(Timing.departs(d)), left: L.hm(a.left), sched: L.hm(a.sched), status: d.status });
      }
    }
    const m = st.margins.sort((x, y) => x - y);
    st.live_margin_s = m.length ? { min: m[0], median: m[m.length >> 1], within_2min_pct: Math.round((100 * m.filter((x) => x <= 120).length) / m.length) } : null;
    delete st.margins;
    report.totals.checks += st.checks;
    report.totals.failures += st.failures;
    rec.stops.push(st);
  }
  report.recordings.push(rec);
}

for (const rec of report.recordings) {
  console.log(`\n${rec.file}  (${rec.from} → ${rec.to}, ${rec.samples} samples)`);
  for (const st of rec.stops) {
    const lm = st.live_margin_s;
    console.log(`  ${st.stop.padEnd(20)} ${String(st.departures).padStart(2)} departures  ${String(st.checks).padStart(6)} checks  ` +
      `${st.failures ? `FAIL ${st.failures}` : "pass"}` + (lm ? `   live: shown ≥ ${lm.min}s before it left (median ${lm.median}s, ${lm.within_2min_pct}% within 2 min)` : ""));
  }
}
const byCheck = {};
for (const f of report.failures) (byCheck[f.check] ||= []).push(f);
for (const [check, fs_] of Object.entries(byCheck)) {
  console.log(`\n${check}: ${fs_.length} failure(s)`);
  for (const f of fs_.slice(0, 12)) console.log("   ", JSON.stringify(f));
}
console.log(`\n${report.totals.failures ? "FAILED" : "PASSED"}: ${report.totals.checks} checks over ${report.totals.moments} moments, ${report.totals.failures} failure(s)`);
if (reportAt) fs.writeFileSync(reportAt, JSON.stringify(report, null, 2));
process.exit(report.totals.failures || !report.recordings.length ? 1 : 0);
