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
  function milesTo(lat, lon, o) {
    const r = Math.PI / 180, a = Math.sin(((o.lat - lat) * r) / 2) ** 2 +
      Math.cos(lat * r) * Math.cos(o.lat * r) * Math.sin(((o.lon - lon) * r) / 2) ** 2;
    return 7917.5 * Math.asin(Math.sqrt(a));
  }
  function where(d) {
    const v = d.vehicle;
    if (d.status === "canceled") return "Golden Gate has canceled this trip.";
    if (!v) return d.status === "estimated" ? "Golden Gate prediction · bus not reporting GPS yet" : "No live data yet · timetable time";
    if (v.onEarlierTrip) return "Bus is finishing an earlier run · Golden Gate's estimate";
    if (v.stopsAway === 0) return v.status === "stopped" ? "Bus is at your stop." : "Bus is approaching your stop.";
    const near = v.near ? `next stop ${esc(v.near)}` : "en route";
    // Express runs skip southern Marin, so "2 stops away" can mean 20 miles; say the distance instead.
    const mi = data?.origin ? milesTo(v.lat, v.lon, data.origin) : null;
    if (mi != null && mi >= 1) return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi away · ${near}`;
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
      ${alt ? `<div class="alt">Backup: <b>${esc(alt.route)}</b> at <span class="num">${clock(plan(alt).t)}</span> → at work ~<span class="num">${clock(plan(alt).atWork)}</span> (${chip(alt)[1]})</div>` : ""}
      <button class="ride-btn" data-ride="${esc(d.trip)}">I'm on this bus <span aria-hidden="true">→</span></button>`;
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
          ${selected === d.trip && d.status !== "canceled" ? `<button class="ride-btn small" data-ride="${esc(d.trip)}">I'm on this ${esc(d.route)} <span aria-hidden="true">→</span></button>` : ""}
        </div>
        <span class="chip ${cls}">${txt}</span>
      </li>`;
    }).join("");
  }

  // Buses that already left your stop — so you can start ride mode after boarding. Folded by default.
  let recentOpen = false;
  function renderRecent() {
    const el = $("recent");
    const list = (data?.recent || []).filter((d) => !settings.hidden.includes(d.route));
    el.hidden = !list.length;
    if (!list.length) return;
    el.innerHTML = `<details ${recentOpen ? "open" : ""}><summary><span>Already on a bus?</span>
        <span class="recent-n">${list.length} just left your stop</span></summary>
      <div class="recent-list">${list.map((d) => `<button class="recent-item" data-ride="${esc(d.trip)}">
        ${badge(d)}<span>left ${clock(d.pred ?? d.sched)} · → ${esc(short(d.dest))} ${clock(d.dest.pred ?? d.dest.sched)}</span><b>Track</b></button>`).join("")}</div></details>`;
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
    renderRecent();
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

  /* ---------- ride mode: stop by stop, alert before your stop ---------- */
  let ride = store.get("ggt:ride", null);
  let rideData = null, rideGeo = null, ridePhone = null, gpsError = null, rideErr = null;
  let watchId = null, wakeLock = null, audio = null, rideTimer = null, lastNextIdx = null;
  const RIDE_POLL_MS = 10000;

  function startRide(d) {
    ride = { trip: d.trip, date: d.date, to: d.dest.id, dest: short(d.dest), route: d.route, color: d.color,
             textColor: d.textColor, startedAt: Date.now(), minD: null, alerted: {} };
    store.set("ggt:ride", ride);
    unlockAudio();
    enterRide();
  }

  function enterRide() {
    rideData = null; rideGeo = null; rideErr = null; lastNextIdx = null;
    document.body.classList.add("riding");
    $("ride").hidden = false;
    $("ride").scrollTop = 0;
    $("rideTitle").innerHTML = `${badge(ride)}<div><div class="eyebrow">Riding to</div><div class="ride-dest">${esc(ride.dest)}</div></div>`;
    if ("geolocation" in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => { ridePhone = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy, ts: nowSec() }; gpsError = null; renderRide(); },
        (err) => { gpsError = err.code === 1 ? "denied" : "unavailable"; renderRide(); },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    } else gpsError = "unavailable";
    keepAwake();
    refreshRide();
    clearInterval(rideTimer);
    rideTimer = setInterval(() => { if (document.visibilityState === "visible") refreshRide(); }, RIDE_POLL_MS);
    renderRide();
  }

  function endRide() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; ridePhone = null;
    clearInterval(rideTimer);
    try { wakeLock?.release(); } catch {}
    wakeLock = null;
    ride = null;
    try { localStorage.removeItem("ggt:ride"); } catch {}
    $("ride").hidden = true;
    document.body.classList.remove("riding");
    refresh();
  }

  async function keepAwake() {
    try { if (navigator.wakeLock && document.visibilityState === "visible") wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  }

  // Sound needs a tap to unlock on phones; "I'm on this bus" is that tap (or any tap after reopening).
  function unlockAudio() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      audio.resume();
      const src = audio.createBufferSource();
      src.buffer = audio.createBuffer(1, 1, 22050);
      src.connect(audio.destination);
      src.start(0);
    } catch {}
  }
  function chime(times) {
    try { navigator.vibrate?.(Array.from({ length: times * 2 - 1 }, (_, i) => (i % 2 ? 120 : 300))); } catch {}
    if (!audio) return;
    const t0 = audio.currentTime + 0.05;
    for (let i = 0; i < times; i++) {
      const o = audio.createOscillator(), g = audio.createGain(), t = t0 + i * 0.32;
      o.type = "sine";
      o.frequency.value = i % 2 ? 1318 : 988;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t + 0.3);
    }
  }

  async function refreshRide() {
    if (!ride) return;
    try {
      const url = `${apiBase}?ride=${encodeURIComponent(ride.trip)}&date=${ride.date}&from=${CONFIG.from}&to=${encodeURIComponent(ride.to)}`;
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      const body = await r.json();
      if (r.status === 404) { rideErr = "Golden Gate no longer lists this trip."; renderRide(); return; }
      if (!r.ok) throw new Error(body.error || "HTTP " + r.status);
      rideData = body; rideErr = null;
      rideGeo = RideCore.geometry(body.line, body.stops);
    } catch (e) {
      rideErr = rideData ? null : "Can't reach the bus feed yet — retrying…";
    }
    renderRide();
  }

  function renderRide() {
    if (!ride) return;
    const hero = $("rideHero"), list = $("rideStops"), src = $("rideSrc");
    if (!rideData || !rideGeo) {
      hero.className = "ride-hero";
      hero.innerHTML = `<div class="ride-lead">${esc(rideErr || "Loading your trip…")}</div>`;
      list.innerHTML = "";
      return;
    }
    const stops = rideData.stops, last = stops.length - 1, now = nowSec();
    const p = RideCore.progress(rideGeo, stops, { phone: ridePhone, vehicle: rideData.vehicle, feed: rideData.feed, now, minD: ride.minD });
    if (p.d !== null && (ride.minD == null || p.d > ride.minD)) { ride.minD = p.d; store.set("ggt:ride", ride); }

    // Alerts fire once each.
    const alert = (key, times) => { if (!ride.alerted[key]) { ride.alerted[key] = Date.now(); store.set("ggt:ride", ride); chime(times); } };
    if (p.state === "riding" && p.stopsLeft === 2) alert("two", 1);
    if (p.state === "next") alert("next", 4);
    if (p.state === "arrived") alert("arrived", 2);

    const dest = stops[last];
    const destT = dest.pred ?? dest.sched;
    const destDelay = dest.pred ? dest.pred - dest.sched : null;
    const [dcls, dtxt] = chip({ status: rideData.trip.canceled ? "canceled" : "", delay: destDelay });
    const atWork = destT + (settings.walkFrom[dest.id] ?? 6) * 60;
    const miles = p.metersLeft != null ? (p.metersLeft / 1609.34) : null;

    src.innerHTML = (() => {
      if (p.source === "phone") return `<i class="dot live"></i>tracking with your phone's GPS`;
      if (p.source === "bus") return `<i class="dot live"></i>tracking with the bus's GPS${gpsError === "denied" ? " · location is off for this site" : ""}`;
      if (p.source === "feed") return `<i class="dot est"></i>tracking with Golden Gate's predictions${gpsError ? "" : " · waiting for GPS"}`;
      return `<i class="dot sched"></i>no live data — following the timetable`;
    })();

    hero.className = "ride-hero " + p.state;
    if (rideData.trip.canceled) {
      hero.innerHTML = `<div class="ride-lead">Golden Gate canceled this trip.</div><div class="ride-sub">Go back and pick another bus.</div>`;
    } else if (p.state === "waiting") {
      const t0 = stops[0].pred ?? stops[0].sched;
      hero.innerHTML = `<div class="ride-lead">Waiting for the ${esc(ride.route)}</div>
        <div class="ride-big"><span class="num">${Math.max(0, Math.round((t0 - now) / 60))}</span><span class="unit">min</span></div>
        <div class="ride-sub">at ${esc(SHORT[stops[0].id] || stops[0].name)} ~<span class="num">${clock(t0)}</span> · then ${last} stops to ${esc(ride.dest)}</div>`;
    } else if (p.state === "next") {
      hero.innerHTML = `<div class="ride-lead">Your stop is next</div>
        <div class="ride-alert-text">Pull the cord now</div>
        <div class="ride-sub">Get off at <b>${esc(dest.name)}</b> · ~<span class="num">${clock(destT)}</span>${miles != null ? ` · ${miles < 0.1 ? Math.round(p.metersLeft * 3.281) + " ft" : miles.toFixed(1) + " mi"}` : ""}</div>`;
    } else if (p.state === "arrived") {
      hero.innerHTML = `<div class="ride-lead">You're at ${esc(ride.dest)}</div>
        <div class="ride-sub">~${settings.walkFrom[dest.id] ?? 6} min walk · at work ~<span class="num">${clock(now + (settings.walkFrom[dest.id] ?? 6) * 60)}</span></div>
        <button class="ride-btn" id="rideDone">Done</button>`;
    } else {
      hero.innerHTML = `<div class="ride-big"><span class="num">${p.stopsLeft}</span><span class="unit">stops left</span></div>
        <div class="ride-sub">Get off at <b>${esc(dest.name)}</b> · ~<span class="num">${clock(destT)}</span> · in ${until(destT)} <span class="chip ${dcls}">${dtxt}</span></div>
        <div class="ride-sub2">${miles != null ? `${miles.toFixed(1)} mi to go · ` : ""}at work ~<span class="num">${clock(atWork)}</span> · we'll alert you one stop before</div>`;
    }

    // Stop-by-stop list with a "you are here" marker.
    const here = p.state === "waiting" ? -1 : p.atIdx >= 0 ? p.atIdx : p.nextIdx - 0.5;
    let html = "";
    stops.forEach((s, i) => {
      if (here === i - 0.5 && p.state !== "arrived") html += `<li class="stop marker" id="rideHere"><span class="tl"></span><span class="nm">${p.source === "phone" ? "You are here" : "Bus is here"}</span></li>`;
      const passed = p.state !== "waiting" && (i < p.nextIdx && i !== p.atIdx);
      const cls = ["stop", passed ? "passed" : "", i === p.atIdx ? "at" : "", i === p.nextIdx && p.state !== "waiting" ? "next" : "",
                   i === last ? "dest" : "", s.skipped ? "skipped" : ""].join(" ");
      const t = s.pred ?? s.sched;
      const tag = i === last ? `<span class="tag">get off</span>` : i === p.nextIdx && p.state !== "waiting" ? `<span class="tag soft">next</span>` : i === p.atIdx ? `<span class="tag soft">here</span>` : "";
      html += `<li class="${cls}" ${i === p.atIdx ? 'id="rideHere"' : ""}><span class="tl"></span>
        <span class="nm">${esc(s.name)} ${tag}</span><span class="tm num">${passed ? "✓" : clock(t)}</span></li>`;
    });
    list.innerHTML = html;
    if (p.nextIdx !== lastNextIdx) {
      lastNextIdx = p.nextIdx;
      // Keep "you are here" just below the pinned header, with a couple of passed stops above it.
      const el = document.getElementById("rideHere"), box = $("ride");
      if (el) box.scrollTo({ top: Math.max(0, $("rideStops").offsetTop + el.offsetTop - $("rideHead").offsetHeight - 90), behavior: "smooth" });
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

  setInterval(() => document.visibilityState === "visible" && !ride && refresh(), CONFIG.pollMs);
  setInterval(() => document.visibilityState === "visible" && (ride ? renderRide() : render()), 5000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (ride) { keepAwake(); refreshRide(); } else refresh();
  });
  addEventListener("pageshow", (e) => { if (e.persisted) refresh(); });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ride]");
    if (!btn) return;
    e.stopPropagation();
    const d = [...(data?.departures || []), ...(data?.recent || [])].find((x) => x.trip === btn.dataset.ride);
    if (d) startRide(d);
  }, true);
  $("rows").addEventListener("click", (e) => { const li = e.target.closest(".row"); if (li) select(li.dataset.trip); });
  $("recent").addEventListener("toggle", (e) => { recentOpen = e.target.open; }, true);
  $("endRide").addEventListener("click", endRide);
  $("ride").addEventListener("click", (e) => { unlockAudio(); if (e.target.id === "rideDone") endRide(); });
  $("fit").addEventListener("click", fit);
  $("openSettings").addEventListener("click", openSettings);
  $("settings").addEventListener("close", () => { if ($("settings").returnValue === "save") saveSettings(); });

  // Reopened mid-ride: pick up where we left off (rides older than 3 hours are stale).
  if (ride && Date.now() - ride.startedAt < 3 * 3600 * 1000) enterRide();
  else if (ride) { ride = null; try { localStorage.removeItem("ggt:ride"); } catch {} }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
