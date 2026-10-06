/* Commute — Golden Gate Transit, Lombard & Fillmore → Montgomery St.
   Data: /api/ggt (Golden Gate's own GTFS + GTFS-Realtime feeds, merged server-side).
   Every time shown is labeled live (bus GPS), estimated, or timetable — never faked. */
(function () {
  "use strict";

  const CONFIG = {
    from: "40033",                 // Lombard St & Fillmore St, southbound
    to: ["42203", "40053"],        // Mission St & 2nd St (101, 120) · Battery St & Pine St (114, 132, 154, 172, 172X)
    work: [37.7894, -122.4021],    // Montgomery St, Financial District
    pollMs: 15000,
  };
  const SHORT = { "40033": "Lombard & Fillmore", "42203": "Mission & 2nd", "40053": "Battery & Pine" };
  const DEFAULTS = { walkTo: 4, walkFrom: { "42203": 6, "40053": 6 }, hidden: [] };

  /* ---------- storage (best effort: private mode etc. may throw) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const settings = Object.assign({}, DEFAULTS, store.get("ggt:settings", {}));
  settings.walkFrom = Object.assign({}, DEFAULTS.walkFrom, settings.walkFrom);

  /* ---------- state ---------- */
  let data = null, receivedAt = 0, skewMs = 0, fetchError = null, selected = null, didFit = false;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nowSec = () => (Date.now() + skewMs) / 1000;
  const clock = (t) => new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).replace(/\s?[AP]M$/, "");
  const ago = (s) => (s < 60 ? `${Math.max(0, Math.round(s))}s` : `${Math.round(s / 60)} min`);
  const short = (d) => SHORT[d.id] || d.name;

  function until(t) {
    const m = Math.floor((t - nowSec()) / 60);
    return m <= 0 ? "now" : `${m} min`;
  }
  function chip(d) {
    if (d.status === "canceled") return ["canceled", "canceled"];
    if (d.status === "skipped") return ["canceled", "skips stop"];
    if (d.delay == null) return ["sched", "timetable"];
    if (Math.abs(d.delay) < 60) return ["ontime", "on time"];
    const m = Math.round(d.delay / 60);
    return m > 0 ? [m >= 5 ? "verylate" : "late", `${m} min late`] : ["early", `${-m} min early`];
  }
  function plan(d) {
    const t = d.pred ?? d.sched;
    const destT = d.dest.pred ?? d.dest.sched;
    return { t, leaveBy: t - settings.walkTo * 60, atWork: destT + (settings.walkFrom[d.dest.id] ?? 6) * 60 };
  }
  function where(d) {
    const v = d.vehicle;
    if (d.status === "canceled") return "Golden Gate has canceled this trip.";
    if (!v) return d.status === "estimated" ? "Golden Gate prediction · bus not reporting GPS yet" : "No live data yet · timetable time";
    if (v.onEarlierTrip) return "Bus is finishing an earlier run · Golden Gate's estimate";
    if (v.stopsAway === 0) return v.status === "stopped" ? "Bus is at your stop." : "Bus is approaching your stop.";
    const near = v.near ? `next stop ${esc(v.near)}` : "en route";
    return v.stopsAway != null ? `${v.stopsAway} stop${v.stopsAway === 1 ? "" : "s"} away · ${near}` : near;
  }
  const visible = () => (data?.departures || []).filter((d) => !settings.hidden.includes(d.route));
  const badge = (d) => `<span class="badge" style="background:${esc(d.color)};color:${esc(d.textColor || "#fff")}">${esc(d.route)}</span>`;

  /* ---------- rendering ---------- */
  function pickBest(list) {
    const now = nowSec();
    let best = null;
    for (const d of list) {
      if (d.status === "canceled" || d.status === "skipped") continue;
      const p = plan(d);
      if (p.leaveBy < now - 60) continue; // can't make it on foot
      if (!best || p.atWork < best.p.atWork || (p.atWork === best.p.atWork && p.t < best.p.t)) best = { d, p };
    }
    return best;
  }

  function renderHero(list, best) {
    const hero = $("hero");
    if (!data) { hero.innerHTML = `<div class="hero-empty">${fetchError ? "Can't reach the bus feed. Retrying…" : "Loading departures…"}</div>`; return; }
    if (!best) {
      hero.innerHTML = `<div class="hero-empty">No Golden Gate buses from Lombard &amp; Fillmore in the next two hours.</div>`;
      return;
    }
    const { d, p } = best;
    const now = nowSec();
    const mins = Math.floor((p.leaveBy - now) / 60);
    const [cls, txt] = chip(d);
    const sched = d.pred && Math.abs(d.pred - d.sched) >= 60 ? `scheduled ${clock(d.sched)} · ` : "";
    const alt = list.filter((x) => x !== d && x.status !== "canceled" && plan(x).leaveBy >= now - 60)
                    .sort((a, b) => plan(a).atWork - plan(b).atWork)[0];
    hero.innerHTML = `
      <div class="lead">${mins <= 0 ? "Leave" : "Leave in"}</div>
      <div class="leave ${mins <= 0 ? "now" : ""}">
        <span class="big">${mins <= 0 ? "now" : mins}</span>${mins > 0 ? `<span class="unit">min</span>` : ""}
      </div>
      <div class="leave-by">Leave by <b class="num">${clock(p.leaveBy)}</b> · ${settings.walkTo} min walk to the stop</div>
      <div class="bus">
        ${badge(d)}
        <div class="times">
          <div class="dep">Departs <span class="num">${clock(p.t)}</span> <span class="chip ${cls}">${txt}</span></div>
          <div class="sub">${sched}${esc(short(d.dest))} <span class="num">${clock(d.dest.pred ?? d.dest.sched)}</span> · at work ~<span class="num">${clock(p.atWork)}</span></div>
        </div>
      </div>
      <div class="where"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg><span>${where(d)}</span></div>
      ${alt ? `<div class="alt">Backup: <b>${esc(alt.route)}</b> at <span class="num">${clock(plan(alt).t)}</span> → at work ~<span class="num">${clock(plan(alt).atWork)}</span> (${chip(alt)[1]})</div>` : ""}`;
  }

  function renderRows(list, best) {
    const rows = $("rows");
    if (!data) { rows.innerHTML = ""; return; }
    if (!list.length) { rows.innerHTML = `<li class="empty">Nothing scheduled in the next two hours.</li>`; return; }
    const now = nowSec();
    rows.innerHTML = list.map((d) => {
      const p = plan(d);
      const [cls, txt] = chip(d);
      const gone = p.leaveBy < now - 60 && d.status !== "canceled";
      const sched = d.pred && Math.abs(d.pred - d.sched) >= 60 ? `sched ${clock(d.sched)} · ` : "";
      const kind = d.status === "live" ? "live" : d.status === "estimated" ? "estimated" : "";
      return `<li class="row ${best && best.d === d ? "best" : ""} ${gone ? "gone" : ""} ${d.status === "canceled" ? "canceled" : ""} ${selected === d.trip ? "sel" : ""}" data-trip="${esc(d.trip)}">
        ${badge(d)}
        <div class="main">
          <div class="line1"><span class="t">${clock(p.t)}</span><span class="in">${gone ? "too late to walk" : "in " + until(p.t)}</span>${best && best.d === d ? `<span class="tag">take this</span>` : ""}</div>
          <div class="line2">${sched}→ ${esc(short(d.dest))} ${clock(d.dest.pred ?? d.dest.sched)} · work ~${clock(p.atWork)}</div>
          <div class="line3">${kind ? `<i class="dot ${kind === "live" ? "live" : "est"}"></i>` : `<i class="dot sched"></i>`}${where(d)}</div>
        </div>
        <span class="chip ${cls}">${txt}</span>
      </li>`;
    }).join("");
  }

  function renderFeed() {
    const el = $("feed"), txt = $("feedText");
    el.className = "feed";
    if (!data) { if (fetchError) el.classList.add("bad"); txt.textContent = fetchError ? "offline — retrying" : "connecting to Golden Gate's live feed…"; return; }
    const now = nowSec();
    const fetchedAgo = (Date.now() - receivedAt) / 1000;
    if (fetchError && fetchedAgo > 45) {
      el.classList.add("bad");
      txt.textContent = `can't reach feed — showing data from ${ago(fetchedAgo)} ago`;
    } else if (!data.feed.ok) {
      el.classList.add("warn");
      txt.textContent = data.feed.ts ? "live feed partly down — some times are timetable only" : "live feed down — timetable times only";
    } else {
      const age = now - data.feed.ts;
      if (age > 150) { el.classList.add("warn"); txt.textContent = `live feed is ${ago(age)} old`; }
      else { el.classList.add("ok"); txt.textContent = `live · Golden Gate feed ${ago(age)} old`; }
    }
  }

  function renderFoot() {
    if (!data) return;
    const vu = data.schedule?.validUntil;
    const until = vu ? new Date(+vu.slice(0, 4), +vu.slice(4, 6) - 1, +vu.slice(6, 8)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
    $("foot").innerHTML = `Live positions and predictions come straight from Golden Gate Transit's public real-time feed, refreshed every 15 s.
      "At work" adds your walk from the stop. Timetable ${until ? `valid through ${until}` : "from Golden Gate"} — it refreshes on its own when GGT publishes a new one.`;
  }

  function render() {
    const list = visible();
    const best = pickBest(list);
    renderFeed();
    renderHero(list, best);
    renderRows(list, best);
    renderMarkers(list, best);
  }

  /* ---------- map ---------- */
  let map = null, busLayer = null;
  const markers = new Map();
  const pin = (kind) => L.divIcon({ className: "pin-host", iconSize: [16, 16], iconAnchor: [8, 8], html: `<div class="stop-pin ${kind}"></div>` });
  function initMap() {
    if (!window.L) return;
    map = L.map("map", { zoomControl: false, attributionControl: true, tap: true }).setView([37.7985, -122.425], 13);
    // OpenStreetMap's own tiles (no key needed), darkened in CSS to match the page.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    busLayer = L.layerGroup().addTo(map);
    const work = L.marker(CONFIG.work, { icon: pin("work"), keyboard: false }).addTo(map);
    work.bindTooltip("Office", { className: "lbl", direction: "top", offset: [0, -8] });
    loadMapLayer();
  }

  async function loadMapLayer() {
    let layer = store.get("ggt:map", null);
    try {
      const r = await apiFetch(true);
      if (r.ok) { layer = (await r.json()).map; store.set("ggt:map", layer); }
    } catch {}
    if (!layer || !map) return;
    for (const line of layer.lines) {
      L.polyline(line.points, { color: line.color, weight: 3, opacity: 0.45, interactive: false }).addTo(map).bringToBack();
    }
    for (const s of layer.stops) {
      const origin = s.id === CONFIG.from;
      L.marker([s.lat, s.lon], { icon: pin(origin ? "" : "dest"), keyboard: false, zIndexOffset: origin ? 500 : 0 })
        .addTo(map).bindTooltip(origin ? "Your stop" : SHORT[s.id] || s.name, { className: "lbl", direction: "top", offset: [0, -8], permanent: origin });
    }
  }

  function ringColor(d) {
    const c = chip(d)[0];
    return { ontime: "#6FBF93", late: "#E8B04B", verylate: "#F07A5A", early: "#86B8FF", canceled: "#F07A5A" }[c] || "#9DB0A4";
  }

  function renderMarkers(list, best) {
    if (!map) return;
    const seen = new Set();
    for (const d of list) {
      const v = d.vehicle;
      if (!v) continue;
      seen.add(d.trip);
      const cls = "bus-pin" + (v.onEarlierTrip ? " dim" : "") + (selected === d.trip ? " sel" : "");
      const icon = L.divIcon({
        className: "pin-host", iconSize: [40, 24], iconAnchor: [20, 12],
        html: `<div class="${cls}" style="background:${esc(d.color)};--ring:${ringColor(d)}">${esc(d.route)}</div>`,
      });
      let m = markers.get(d.trip);
      if (!m) {
        m = L.marker([v.lat, v.lon], { icon, keyboard: false }).addTo(busLayer);
        m.on("click", () => select(d.trip, false));
        markers.set(d.trip, m);
      } else {
        m.setLatLng([v.lat, v.lon]);
        m.setIcon(icon);
      }
      m.setZIndexOffset(best && best.d === d ? 800 : selected === d.trip ? 900 : 0);
      m.bindTooltip(`${esc(d.route)} · ${clock(plan(d).t)} · ${chip(d)[1]}`, { className: "lbl", direction: "top", offset: [0, -14] });
    }
    for (const [trip, m] of markers) if (!seen.has(trip)) { busLayer.removeLayer(m); markers.delete(trip); }
    if (!didFit && data) { fit(); didFit = true; }
  }

  function fit() {
    if (!map || !data) return;
    const origin = data.origin ? [data.origin.lat, data.origin.lon] : [37.7998, -122.4358];
    const pts = [origin, CONFIG.work];
    for (const d of visible().slice(0, 5)) {
      const v = d.vehicle;
      if (v && Math.abs(v.lat - origin[0]) < 0.3 && Math.abs(v.lon - origin[1]) < 0.3) pts.push([v.lat, v.lon]);
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 15 });
  }

  function select(trip, pan = true) {
    selected = selected === trip ? null : trip;
    render();
    const d = visible().find((x) => x.trip === trip);
    if (selected && pan && d?.vehicle && map) map.panTo([d.vehicle.lat, d.vehicle.lon]);
    if (selected && !pan) document.querySelector(`.row[data-trip="${CSS.escape(trip)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /* ---------- data ---------- */
  // vercel.json sets trailingSlash; fall back to the bare path if the slashed one 404s.
  let apiBase = "/api/ggt/";
  async function apiFetch(withMap, init) {
    let r = await fetch(api(withMap), init);
    if (r.status === 404 && apiBase.endsWith("/")) { apiBase = "/api/ggt"; r = await fetch(api(withMap), init); }
    return r;
  }
  function api(withMap) {
    return `${apiBase}?from=${CONFIG.from}&to=${CONFIG.to.join(",")}${withMap ? "&map=1" : ""}`;
  }

  let inflight = false;
  async function refresh() {
    if (inflight) return;
    inflight = true;
    try {
      const r = await apiFetch(false, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "HTTP " + r.status);
      data = body; receivedAt = Date.now(); fetchError = null;
      skewMs = Math.abs(body.now * 1000 - Date.now()) > 90000 ? body.now * 1000 - Date.now() : 0;
      store.set("ggt:last", { data, receivedAt });
      renderFoot();
      rememberRoutes();
    } catch (e) {
      fetchError = e;
    } finally {
      inflight = false;
      render();
    }
  }

  /* ---------- settings ---------- */
  const byRoute = (a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b);
  function rememberRoutes() {
    const all = new Set(store.get("ggt:routes", []).concat((data?.departures || []).map((d) => d.route)));
    store.set("ggt:routes", [...all].sort(byRoute));
  }
  function buildChips() {
    const all = [...new Set(store.get("ggt:routes", []).concat(settings.hidden, (data?.departures || []).map((d) => d.route)))].sort(byRoute);
    $("routeChips").innerHTML = all.map((r) => `<label><input type="checkbox" value="${esc(r)}" ${settings.hidden.includes(r) ? "" : "checked"}> ${esc(r)}</label>`).join("");
  }
  function openSettings() {
    $("walkTo").value = settings.walkTo;
    $("walkMission").value = settings.walkFrom["42203"];
    $("walkBattery").value = settings.walkFrom["40053"];
    buildChips();
    $("settings").showModal();
  }
  function saveSettings() {
    const n = (id, d) => { const v = parseInt($(id).value, 10); return Number.isFinite(v) && v >= 0 && v <= 60 ? v : d; };
    settings.walkTo = n("walkTo", DEFAULTS.walkTo);
    settings.walkFrom["42203"] = n("walkMission", DEFAULTS.walkFrom["42203"]);
    settings.walkFrom["40053"] = n("walkBattery", DEFAULTS.walkFrom["40053"]);
    settings.hidden = [...$("routeChips").querySelectorAll("input")].filter((i) => !i.checked).map((i) => i.value);
    store.set("ggt:settings", settings);
    render();
  }

  /* ---------- boot ---------- */
  const cached = store.get("ggt:last", null);
  if (cached && Date.now() - cached.receivedAt < 10 * 60 * 1000) { data = cached.data; receivedAt = cached.receivedAt; }
  initMap();
  render();
  renderFoot();
  refresh();

  setInterval(() => document.visibilityState === "visible" && refresh(), CONFIG.pollMs);
  setInterval(() => document.visibilityState === "visible" && render(), 5000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
  addEventListener("pageshow", (e) => { if (e.persisted) refresh(); });

  $("rows").addEventListener("click", (e) => { const li = e.target.closest(".row"); if (li) select(li.dataset.trip); });
  $("fit").addEventListener("click", fit);
  $("openSettings").addEventListener("click", openSettings);
  $("settings").addEventListener("close", () => { if ($("settings").returnValue === "save") saveSettings(); });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
