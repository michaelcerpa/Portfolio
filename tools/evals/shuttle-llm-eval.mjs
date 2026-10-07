#!/usr/bin/env node
// LLM-graded eval for /presidio/: render the real page (headless Chromium) at moments before each recorded departure,
// and have Claude judge the screen against what actually happened (when the shuttle's GPS shows it leaving):
//   - would a rider who arrives when the screen says the shuttle departs have caught it?
//   - did the screen state anything as fact that turned out false in a way that could make her late?
// A calibration set (screens in the style of the page before the missed-shuttle fix, at moments where it was wrong)
// must be flagged too, or the judge isn't trusted and the run fails.
//
//   ANTHROPIC_API_KEY=... node tools/evals/shuttle-llm-eval.mjs [--dry-run] [--report out.json] [recordings...]
// Needs: npm i --no-save @anthropic-ai/sdk playwright (+ a Chromium for Playwright). Exits 1 on any failure.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
const L = require("./lib.js");
const makeHandler = require("../../api/_lib/handler.js");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const reportAt = args.includes("--report") ? args[args.indexOf("--report") + 1] : null;
const files = L.recordingFiles(args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--report"));
const MODEL = "claude-opus-5-5";
const OFFSETS_MIN = [20, 10, 4, 1];   // judge the screen this long before each actual departure
const CONCURRENCY = 4;
const PORT = 8790 + Math.floor(Math.random() * 100);

/* ---------- 1. moments to judge ---------- */

const clock = (t) => new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" });
const cases = [];      // { kind: "screen" | "control", stop, sample, trip, sched, left, recording }
const models = {};
for (const file of files) {
  const samples = L.loadRecording(file);
  const gtfs = fs.existsSync(file.replace(/\.jsonl(\.gz)?$/, ".gtfs.zip")) ? file.replace(/\.jsonl(\.gz)?$/, ".gtfs.zip") : path.join(path.dirname(file), "gtfs.zip");
  const model = (models[file] = L.loadModel(gtfs));
  for (const stop of L.STOPS) {
    const actual = L.actualDepartures(model, samples, stop.from);
    for (const [trip, a] of Object.entries(actual)) {
      for (const off of OFFSETS_MIN) {
        const sample = [...samples].reverse().find((s) => s.t <= a.left - off * 60);
        if (sample && sample.t >= samples[0].t) cases.push({ kind: "screen", recording: file, stop, sample, trip, sched: a.sched, left: a.left, offset: off });
      }
    }
    // Calibration: moments where the old display rule showed a time after the shuttle left, or dropped it at the curb.
    const seen = new Set();
    for (const sample of samples) {
      const list = L.departuresAt(model, sample, stop, true);
      for (const [trip, a] of Object.entries(actual)) {
        if (sample.t >= a.left || sample.t < a.left - 30 * 60) continue;
        const d = list.find((x) => x.trip === trip);
        const wrong = d ? L.NaiveTiming.departs(d) > a.left + 30 : sample.t > a.left - 90;
        const key = `${stop.from}|${trip}|${d ? "late" : "gone"}`;
        if (wrong && !seen.has(key)) { seen.add(key); cases.push({ kind: "control", recording: file, stop, sample, trip, sched: a.sched, left: a.left, naive: list }); }
      }
    }
  }
}

/* ---------- 2. what the screen showed ---------- */

// The current page, rendered by Chromium with its API answered from the recording at that moment.
async function renderScreens(list) {
  const { chromium } = await import("playwright");
  const server = spawn(process.execPath, [path.join(root, "tools/bus-dev-server.js")], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    for (const k of list) {
      const model = models[k.recording];
      const handler = makeHandler("pgo", { getModel: async () => model, getLive: async () => L.liveAt(k.sample) });
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "America/Los_Angeles" });
      const page = await ctx.newPage();
      await page.clock.install({ time: new Date(k.sample.t * 1000) });
      await page.route(/tile\.openstreetmap\.org/, (r) => r.abort());
      await page.route(/\/api\/pgo/, async (route) => {
        const realNow = Date.now;
        Date.now = () => k.sample.t * 1000;
        try {
          const body = await new Promise((resolve) => {
            const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, b }); } };
            handler({ url: new URL(route.request().url()).pathname + new URL(route.request().url()).search }, res);
          });
          await route.fulfill({ status: body.code, contentType: "application/json", body: JSON.stringify(body.b) });
        } finally { Date.now = realNow; }
      });
      await page.goto(`http://localhost:${PORT}/presidio/`, { waitUntil: "domcontentloaded" });
      await page.clock.runFor(1500);
      const home = k.stop.from !== "31933";
      await page.click(`.dirs [data-dir="${home ? "home" : "work"}"]`);
      if (home) await page.click(`#pickup [data-stop="${k.stop.from}"]`);
      await page.waitForTimeout(400);
      await page.clock.runFor(1500);
      k.screen = await page.evaluate(() => {
        const t = (id) => document.getElementById(id)?.innerText.replace(/\n{2,}/g, "\n").trim() || "";
        const rows = [...document.querySelectorAll(".row")].slice(0, 5).map((r) => "- " + r.innerText.replace(/\s*\n\s*/g, " · "));
        return [`[${document.getElementById("title").innerText}]`, t("feed"), document.getElementById("note").hidden ? "" : t("note"),
                t("hero"), document.getElementById("recent").hidden ? "" : t("recent"), "Next shuttles:", ...rows].filter(Boolean).join("\n");
      });
      await ctx.close();
    }
  } finally { await browser.close(); server.kill(); }
}

// The page before the fix, for calibration: it showed the feed's time as-is and counted "leave in" down to it.
function oldScreen(k) {
  const d = k.naive.find((x) => x.trip === k.trip) || k.naive[0];
  if (!d) return "No shuttles listed.";
  const t = L.NaiveTiming.departs(d), chip = L.NaiveTiming.status(d)[1];
  const lines = k.naive.slice(0, 4).map((x) => `- ${clock(L.NaiveTiming.departs(x))} · in ${Math.max(0, Math.floor((L.NaiveTiming.departs(x) - k.sample.t) / 60))} min · ${L.NaiveTiming.status(x)[1]}`);
  return [`LEAVE IN ${Math.max(0, Math.floor((t - 300 - k.sample.t) / 60))} min`, `Leave by ${clock(t - 300)} · 5 min walk to ${k.stop.name}`,
          `GO Departs ${clock(t)} ${chip}`, "Next shuttles:", ...lines].join("\n");
}

/* ---------- 3. the judge ---------- */

const SYSTEM = `You audit a shuttle-departure screen that one rider uses to decide when to be at her stop. You are given exactly what the screen showed at one moment, and what actually happened afterwards (from the shuttle's GPS). The rider knows her own walking time; she plans to be at the stop by the time the screen tells her the shuttle departs. Judge only what the screen communicated to her about the run in question.`;
const SCHEMA = {
  type: "object", additionalProperties: false, required: ["would_make_it", "misleading", "reason"],
  properties: {
    would_make_it: { type: "boolean", description: "Arriving at the stop at the departure time the screen gave for that run (or now, if it said departing now / at your stop), would she have caught it? If the screen did not show that run at all, false." },
    misleading: { type: "boolean", description: "Did the screen present as fact something about that run that turned out false in a way that could make her late (e.g. 'N min late' when it left earlier, or that it was gone while it was still at the stop)? Clearly labelled uncertainty ('may run late', 'estimate') is not misleading." },
    reason: { type: "string", description: "One sentence." },
  },
};
const prompt = (k) => `Stop: ${k.stop.name}. Moment the rider looked: ${new Date(k.sample.t * 1000).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles" })}.
The run in question: the shuttle scheduled to leave this stop at ${clock(k.sched)}.
What actually happened: it left this stop at ${new Date(k.left * 1000).toLocaleTimeString("en-US", { timeZone: "America/Los_Angeles" })} (GPS).

<screen>
${k.screen}
</screen>`;

let client = null, usage = { input: 0, output: 0, requests: 0 };
async function judgeOnce(k) {
  if (!client) {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    client = new Anthropic();
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await client.beta.messages.create({
        model: MODEL, max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: "user", content: prompt(k) }],
      });
      usage.requests++; usage.input += r.usage?.input_tokens || 0; usage.output += r.usage?.output_tokens || 0;
      if (r.stop_reason === "refusal") return { error: "refusal", category: r.stop_details?.category ?? null };
      const text = r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      return JSON.parse(text);
    } catch (e) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      if (attempt < 3 && (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError)) {
        await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
        continue;
      }
      if (e instanceof SyntaxError) return { error: "unparseable judge output" };
      throw e;
    }
  }
}
// A flagged screen is asked twice more; it counts as flagged only by majority (2 of 3).
async function judge(k) {
  const flagged = (v) => v.error || v.would_make_it === false || v.misleading === true;
  const first = await judgeOnce(k);
  if (!flagged(first)) return { ...first, votes: 1 };
  const more = [await judgeOnce(k), await judgeOnce(k)];
  const all = [first, ...more], bad = all.filter(flagged);
  const pick = bad.length >= 2 ? bad[0] : all.find((v) => !flagged(v));
  return { ...pick, votes: 3, flagged_votes: bad.length };
}
async function pool(items, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (i < items.length) { const k = items[i++]; k.verdict = await fn(k); } }));
}

/* ---------- 4. run ---------- */

const screens = cases.filter((k) => k.kind === "screen"), controls = cases.filter((k) => k.kind === "control");
console.log(`${screens.length} screens to judge (${OFFSETS_MIN.join("/")} min before each of the recorded departures) + ${controls.length} calibration screens`);
await renderScreens(screens);
for (const k of controls) k.screen = oldScreen(k);
if (dryRun) {
  for (const k of [...screens.slice(0, 3), ...controls.slice(0, 2)]) console.log(`\n--- ${k.kind} · ${k.stop.name} · ${clock(k.sched)} run, left ${clock(k.left)}\n${prompt(k)}`);
  const n = screens.length + controls.length;
  console.log(`\nDry run: ${n} judge calls (+ re-asks for flagged ones). Est. cost on ${MODEL}: ~$${(n * (1200 * 4 + 1500 * 20) / 1e6).toFixed(2)}`);
  if (reportAt) fs.writeFileSync(reportAt, JSON.stringify(cases.map(({ naive, sample, ...k }) => ({ ...k, at: sample.t, stop: k.stop.name })), null, 2));
  process.exit(0);
}
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) { console.error("Set ANTHROPIC_API_KEY (repo secret) to run the LLM judge."); process.exit(2); }
await pool([...screens, ...controls], judge);

const bad = (k) => k.verdict.error || k.verdict.would_make_it === false || k.verdict.misleading === true;
const screenFails = screens.filter(bad), caught = controls.filter(bad);
const calibration = controls.length ? caught.length / controls.length : 1;
console.log(`\nScreens: ${screens.length - screenFails.length}/${screens.length} judged safe and not misleading`);
for (const k of screenFails) console.log(`  FLAGGED ${k.stop.name} at ${clock(k.sample.t)} (${k.offset} min before the ${clock(k.sched)} left at ${clock(k.left)}): ${JSON.stringify(k.verdict)}\n${k.screen.replace(/^/gm, "     ")}`);
console.log(`Calibration: judge flagged ${caught.length}/${controls.length} known-bad screens (needs ≥ 80%)`);
for (const k of controls.filter((x) => !bad(x))) console.log(`  MISSED control ${k.stop.name} ${clock(k.sample.t)}: ${k.verdict.reason}`);
console.log(`Usage: ${usage.requests} requests, ${usage.input} in / ${usage.output} out tokens ≈ $${((usage.input * 4 + usage.output * 20) / 1e6).toFixed(2)}`);
if (reportAt) fs.writeFileSync(reportAt, JSON.stringify({ model: MODEL, usage, calibration, cases: cases.map(({ naive, sample, ...k }) => ({ ...k, at: sample.t, stop: k.stop.name })) }, null, 2));
const ok = !screenFails.length && calibration >= 0.8;
console.log(ok ? "PASSED" : "FAILED");
process.exit(ok ? 0 : 1);
