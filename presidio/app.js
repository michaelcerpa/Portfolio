/* Shuttle — Presidio GO's Downtown route between Lombard Gate and 50 Beale St, both ways.
   Data: /api/pgo (Presidio GO's own GTFS + GTFS-Realtime feeds, merged server-side).
   Times follow presidio/timing.js: never later than the timetable unless the shuttle is on that run.
   Same app as /bus/, adapted: one route, Presidio GO Pass runs, and a loop that turns around at 50 Beale. */
(function () {
  "use strict";

  // Boarding (`from`) and alighting (`to`) stops for each direction. The Downtown route is one loop:
  // Presidio Transit Center → Lombard Gate → downtown drop-offs → 50 Beale (turnaround) → pick-ups → Letterman → back.
  const DIRS = {
    work: { label: "To work", title: "Lombard Gate <span class=\"arrow\">→</span> 50 Beale",
            from: ["31933"],                   // Lombard Gate
            to: ["8894813"] },                 // Beale & Mission ("50 Beale Street" on the timetable)
    home: { label: "To home",                  // from: the pick-up she chose (HOME_STOPS), see cfg()
            to: ["31980"] },                   // Letterman Digital Arts Center (the way back skips Lombard Gate)
  };
  // Two downtown pick-ups on the way home, on the same run: 50 Beale (where the loop turns around)
  // and Drumm & California (Embarcadero BART), 2 minutes later.
  const HOME_STOPS = [{ id: "8894813" }, { id: "839326" }];
  const OFFICE = [37.7914, -122.3979];        // the office, a block from 50 Beale
  const POLL_MS = 15000;
  const SHORT = { "31933": "Lombard Gate", "8894813": "50 Beale", "839326": "Drumm & California", "31980": "Letterman" };
  const DEFAULTS = { homeStop: "8894813" };

  /* ---------- storage (best effort: private mode etc. may throw) ---------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const saved = store.get("pgo:settings", {});
  const settings = { homeStop: HOME_STOPS.some((h) => h.id === saved.homeStop) ? saved.homeStop : DEFAULTS.homeStop };

  // Direction: mornings default to work, afternoons/evenings to home; a tap overrides for 4 hours.
  const laHour = () => +new Date().toLocaleString("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Los_Angeles" });
  const autoDir = () => (laHour() >= 4 && laHour() < 12 ? "work" : "home");
  const pinned = store.get("pgo:dir", null);
  let dir = pinned && Date.now() < pinned.until ? pinned.dir : autoDir();
  const cfg = () => (dir === "home"
    ? { ...DIRS.home, from: [settings.homeStop], title: `${esc(SHORT[settings.homeStop])} <span class="arrow">→</span> Letterman` }
    : DIRS.work);
  // What's on screen: the direction, plus the pick-up stop on the way home (cached data and map are per view).
  const view = () => (dir === "home" ? "home-" + settings.homeStop : dir);

  /* ---------- state ---------- */
  let data = null, receivedAt = 0, skewMs = 0, fetchError = null, selected = null, didFit = false;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const nowSec = () => Math.floor((Date.now() + skewMs) / 1000);  // whole seconds: every countdown on screen agrees
  const clock = (t) => new Date(t * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).replace(/\s?[AP]M$/, "");
  const ago = (s) => (s < 60 ? `${Math.max(0, Math.round(s))}s` : `${Math.round(s / 60)} min`);
  // Feed names carry notes in parentheses ("Van Ness & Union (Drop Off)"); show just the name.
  const bare = (name) => String(name ?? "").replace(/\s*\(.*\)\s*$/, "");
  const short = (d) => SHORT[d?.id] || bare(d?.name);

  function until(t) {
    const m = Math.floor((t - nowSec()) / 60);
    return m <= 0 ? "now" : `${m} min`;
  }
  // Times and labels follow presidio/timing.js: never later than the timetable until the shuttle is on the run.
  const { departs, arrives, label } = window.Timing;
  const chipHtml = (d) => { const l = label(d); return l ? `<span class="chip ${l[0]}">${l[1]}</span>` : ""; };
  function milesTo(lat, lon, o) {
    const r = Math.PI / 180, a = Math.sin(((o.lat - lat) * r) / 2) ** 2 +
      Math.cos(lat * r) * Math.cos(o.lat * r) * Math.sin(((o.lon - lon) * r) / 2) ** 2;
    return 7917.5 * Math.asin(Math.sqrt(a));
  }
  // Where the shuttle is, only once its GPS is on this run.
  function where(d) {
    const v = d.vehicle;
    if (!v || v.onEarlierTrip || !window.Timing.onRun(d)) return "";
    const o = d.origin?.lat != null ? d.origin : data?.origin;
    const mi = o ? milesTo(v.lat, v.lon, o) : null;
    // This feed doesn't say "stopped", so judge by distance (it waits a few minutes at 50 Beale).
    if (v.stopsAway === 0) return v.status === "stopped" || (mi != null && mi < 0.04) ? "Shuttle is at your stop." : "Shuttle is approaching your stop.";
    // Stops are far apart (Van Ness to downtown is 2 miles), so say the distance when it's a mile or more.
    if (mi != null && mi >= 1) return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi away`;
    return v.stopsAway != null ? `${v.stopsAway} stop${v.stopsAway === 1 ? "" : "s"} away` : "";
  }
  const visible = () => [...(data?.departures || [])].sort((a, b) => departs(a) - departs(b));
  // One route ("Presidio GO Downtown"), so the badge just says GO.
  const badge = (d) => `<span class="badge" style="background:${esc(d.color)};color:${esc(d.textColor || "#fff")}">GO</span>`;

  /* ---------- rendering ---------- */
  function pickBest(list) {
    const d = list.find((x) => x.status !== "canceled" && x.status !== "skipped");
    return d ? { d } : null;
  }

  function renderHero(list, best) {
    const hero = $("hero");
    if (!data) { hero.innerHTML = `<div class="hero-empty">${fetchError ? "Can't reach the shuttle feed. Retrying…" : "Loading departures…"}</div>`; return; }
    if (!best) {
      const l = data.later;
      const when = l ? (() => {
        const opt = { timeZone: "America/Los_Angeles" };
        const day = (t) => new Date(t * 1000).toLocaleDateString("en-US", { ...opt, weekday: "long" });
        const d = day(l.sched) === day(nowSec()) ? "today" : day(l.sched) === day(nowSec() + 86400) ? "tomorrow" : day(l.sched);
        return `${new Date(l.sched * 1000).toLocaleTimeString("en-US", { ...opt, hour: "numeric", minute: "2-digit" })} ${d}`;
      })() : "";
      hero.innerHTML = `<div class="hero-empty">No shuttles in the next two hours.</div>
        ${l ? `<div class="bus">${badge(l)}<div class="times"><div class="dep">Next: ${esc(when)}</div>
          <div class="sub">from ${esc(short(l.origin))}</div></div></div>` : ""}`;
      return;
    }
    const { d } = best;
    const now = nowSec(), t = departs(d);
    const mins = Math.floor((t - now) / 60);
    const loc = where(d);
    const alt = list.find((x) => x !== d && x.status !== "canceled" && x.status !== "skipped");
    hero.innerHTML = `
      <div class="lead">${mins <= 0 ? "Departs" : "Departs in"}</div>
      <div class="leave ${mins <= 0 ? "now" : ""}">
        <span class="big">${mins <= 0 ? "now" : mins}</span>${mins > 0 ? `<span class="unit">min</span>` : ""}
      </div>
      <div class="leave-by">from ${esc(short(d.origin) || "your stop")}</div>
      <div class="bus">
        ${badge(d)}
        <div class="times">
          <div class="dep">Departs <span class="num">${clock(t)}</span> ${chipHtml(d)}</div>
          <div class="sub">Arrives ${esc(short(d.dest))} <span class="num">${clock(arrives(d))}</span></div>
        </div>
      </div>
      ${!loc ? "" : `<div class="where"><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z"/></svg><span>${loc}</span></div>`}
      ${alt ? `<div class="alt">Then <b class="num">${clock(departs(alt))}</b></div>` : ""}
      <button class="ride-btn" data-ride="${esc(d.trip)}">I'm on this shuttle <span aria-hidden="true">→</span></button>`;
  }

  function renderRows(list, best) {
    const rows = $("rows");
    if (!data) { rows.innerHTML = ""; return; }
    if (!list.length) { rows.innerHTML = `<li class="empty">Nothing in the next two hours.</li>`; return; }
    rows.innerHTML = list.map((d) => {
      const t = departs(d);
      return `<li class="row ${best && best.d === d ? "best" : ""} ${d.status === "canceled" ? "canceled" : ""} ${selected === d.trip ? "sel" : ""}" data-trip="${esc(d.trip)}">
        ${badge(d)}
        <div class="main">
          <div class="line1"><span class="t">${clock(t)}</span><span class="in">${until(t) === "now" ? "due now" : "in " + until(t)}</span></div>
          <div class="line2">→ ${esc(short(d.dest))} ${clock(arrives(d))}</div>
          ${selected === d.trip && d.status !== "canceled" ? `<button class="ride-btn small" data-ride="${esc(d.trip)}">I'm on this shuttle <span aria-hidden="true">→</span></button>` : ""}
        </div>
        ${chipHtml(d)}
      </li>`;
    }).join("");
  }

  // Shuttles that already left your stop — so you can start ride mode after boarding. Folded by default.
  let recentOpen = false;
  function renderRecent() {
    const el = $("recent");
    const list = data?.recent || [];
    el.hidden = !list.length;
    if (!list.length) return;
    el.innerHTML = `<details ${recentOpen ? "open" : ""}><summary><span>Already on the shuttle?</span>
        <span class="recent-n">${list.length} just left your stop</span></summary>
      <div class="recent-list">${list.map((d) => `<button class="recent-item" data-ride="${esc(d.trip)}">
        ${badge(d)}<span>left ${clock(d.pred ?? d.sched)} · → ${esc(short(d.dest))} ${clock(d.dest.pred ?? d.dest.sched)}</span><b>Track</b></button>`).join("")}</div></details>`;
  }

  // Only shown when something is wrong with the live data.
  function renderFeed() {
    const el = $("feed"), txt = $("feedText");
    const say = (cls, text) => { el.hidden = false; el.className = "feed " + cls; txt.textContent = text; };
    el.hidden = true;
    if (!data) { if (fetchError) say("bad", "Offline — retrying"); return; }
    const fetchedAgo = (Date.now() - receivedAt) / 1000;
    if (fetchError && fetchedAgo > 45) say("bad", `Offline — times from ${ago(fetchedAgo)} ago`);
    else if (!data.feed.ok) say("warn", "Live data is down — times may be off");
    else if (nowSec() - data.feed.ts > 150) say("warn", `Live data is ${ago(nowSec() - data.feed.ts)} old`);
  }

  // A federal holiday swaps in the weekend timetable (the API says which holiday).
  function renderNote() {
    const el = $("note");
    el.hidden = !data?.holiday;
    if (data?.holiday) el.textContent = `${data.holiday}: weekend schedule today.`;
  }

  function render() {
    const list = visible();
    const best = pickBest(list);
    renderFeed();
    renderNote();
    renderHero(list, best);
    renderRecent();
    renderRows(list, best);
    renderMarkers(list, best);
  }

  /* ---------- map ---------- */
  let map = null, busLayer = null, routeLayer = null;
  const markers = new Map();
  const pin = (kind) => L.divIcon({ className: "pin-host", iconSize: [16, 16], iconAnchor: [8, 8], html: `<div class="stop-pin ${kind}"></div>` });
  function initMap() {
    if (!window.L) return;
    map = L.map("map", { zoomControl: false, attributionControl: true, tap: true }).setView([37.7965, -122.422], 13);
    // OpenStreetMap's own tiles (no key needed), darkened in CSS to match the page.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    routeLayer = L.layerGroup().addTo(map);
    busLayer = L.layerGroup().addTo(map);
    const work = L.marker(OFFICE, { icon: pin("work"), keyboard: false }).addTo(map);
    work.bindTooltip("Office", { className: "lbl", direction: "top", offset: [0, -8] });
    loadMapLayer();
  }

  async function loadMapLayer() {
    const forView = view(), key = "pgo:map:" + forView;
    const draw = (layer) => {
      if (!layer || !map || forView !== view()) return;
      routeLayer.clearLayers();
      for (const line of layer.lines) {
        L.polyline(line.points, { color: line.color, weight: 3, opacity: 0.45, interactive: false }).addTo(routeLayer);
      }
      const labeled = new Set();
      for (const s of layer.stops) {
        const origin = cfg().from.includes(s.id), name = SHORT[s.id] || bare(s.name);
        const label = origin && !labeled.has(name);
        labeled.add(name);
        L.marker([s.lat, s.lon], { icon: pin(origin ? "" : "dest"), keyboard: false, zIndexOffset: origin ? 500 : 0 }).addTo(routeLayer)
          .bindTooltip(dir === "work" && origin ? "Your stop" : name, { className: "lbl", direction: "top", offset: [0, -8], permanent: label });
      }
    };
    draw(store.get(key, null));
    try {
      const r = await apiFetch(true);
      if (r.ok) { const layer = (await r.json()).map; store.set(key, layer); draw(layer); }
    } catch {}
  }

  function ringColor(d) {
    const c = (label(d) || ["sched"])[0];
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
        html: `<div class="${cls}" style="background:${esc(d.color)};--ring:${ringColor(d)}">GO</div>`,
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
      m.bindTooltip(`${clock(departs(d))}${label(d) ? " · " + label(d)[1] : ""}`, { className: "lbl", direction: "top", offset: [0, -14] });
    }
    for (const [trip, m] of markers) if (!seen.has(trip)) { busLayer.removeLayer(m); markers.delete(trip); }
    if (!didFit && data) { fit(); didFit = true; }
  }

  function fit() {
    if (!map || !data) return;
    const origins = (data.origins || [data.origin]).filter(Boolean).map((o) => [o.lat, o.lon]);
    const origin = origins[0] || [37.7998, -122.4358];
    const pts = [...origins, OFFICE];
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
  let apiBase = "/api/pgo/";
  async function apiFetch(withMap, init) {
    let r = await fetch(api(withMap), init);
    if (r.status === 404 && apiBase.endsWith("/")) { apiBase = "/api/pgo"; r = await fetch(api(withMap), init); }
    return r;
  }
  function api(withMap) {
    return `${apiBase}?from=${cfg().from.join(",")}&to=${cfg().to.join(",")}${withMap ? "&map=1" : ""}`;
  }

  let inflight = false, again = false;
  async function refresh() {
    if (inflight) { again = true; return; }  // e.g. switched stop mid-request: fetch the new view right after
    inflight = true;
    const forView = view();
    try {
      const r = await apiFetch(false, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "HTTP " + r.status);
      if (forView !== view()) return;  // switched direction or stop while this was in flight
      data = body; receivedAt = Date.now(); fetchError = null;
      skewMs = Math.abs(body.now * 1000 - Date.now()) > 90000 ? body.now * 1000 - Date.now() : 0;
      store.set("pgo:last:" + forView, { data, receivedAt });
    } catch (e) {
      fetchError = e;
    } finally {
      inflight = false;
      render();
      if (again) { again = false; refresh(); }
    }
  }

  /* ---------- ride mode: stop by stop, alert before your stop ---------- */
  let ride = store.get("pgo:ride", null);
  let rideData = null, rideGeo = null, ridePhone = null, gpsError = null, rideErr = null;
  let watchId = null, wakeLock = null, audio = null, rideTimer = null, lastNextIdx = null;
  const RIDE_POLL_MS = 10000;

  function startRide(d) {
    ride = { trip: d.trip, date: d.date, from: d.origin?.id ?? cfg().from[0], to: d.dest.id, dest: short(d.dest), dir, route: d.route, color: d.color,
             textColor: d.textColor, startedAt: Date.now(), minD: null, alerted: {} };
    store.set("pgo:ride", ride);
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
    try { localStorage.removeItem("pgo:ride"); } catch {}
    $("ride").hidden = true;
    document.body.classList.remove("riding");
    refresh();
  }

  async function keepAwake() {
    try { if (navigator.wakeLock && document.visibilityState === "visible") wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  }

  // Sound needs a tap to unlock on phones; "I'm on this shuttle" is that tap (or any tap after reopening).
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
    const forRide = ride;
    try {
      const url = `${apiBase}?ride=${encodeURIComponent(ride.trip)}&date=${ride.date}&from=${encodeURIComponent(ride.from || DIRS.work.from[0])}&to=${encodeURIComponent(ride.to)}`;
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      const body = await r.json();
      if (ride !== forRide) return;  // ended, or another ride started, while this was in flight
      if (r.status === 404) { rideErr = "Presidio GO no longer lists this trip."; renderRide(); return; }
      if (!r.ok) throw new Error(body.error || "HTTP " + r.status);
      rideData = body; rideErr = null;
      rideGeo = RideCore.geometry(body.line, body.stops);
    } catch (e) {
      if (ride !== forRide) return;
      rideErr = rideData ? null : "Can't reach the shuttle feed yet — retrying…";
    }
    renderRide();
  }

  function renderRide() {
    if (!ride) return;
    const hero = $("rideHero"), list = $("rideStops");
    if (!rideData || !rideGeo) {
      hero.className = "ride-hero";
      hero.innerHTML = `<div class="ride-lead">${esc(rideErr || "Loading your trip…")}</div>`;
      list.innerHTML = "";
      return;
    }
    const stops = rideData.stops, last = stops.length - 1, now = nowSec();
    const p = RideCore.progress(rideGeo, stops, { phone: ridePhone, vehicle: rideData.vehicle, feed: rideData.feed, now, minD: ride.minD });
    if (p.d !== null && (ride.minD == null || p.d > ride.minD)) { ride.minD = p.d; store.set("pgo:ride", ride); }

    // Alerts fire once each.
    const alert = (key, times) => { if (!ride.alerted[key]) { ride.alerted[key] = Date.now(); store.set("pgo:ride", ride); chime(times); } };
    if (p.state === "riding" && p.stopsLeft === 2) alert("two", 1);
    if (p.state === "next") alert("next", 4);
    if (p.state === "arrived") alert("arrived", 2);

    const dest = stops[last];
    // The ride's own shuttle GPS is on this run, or not yet: same rule as the main screen (timing.js).
    const run = { status: rideData.trip.canceled ? "canceled" : rideData.vehicle ? "live" : "estimated" };
    const destRun = { ...run, pred: dest.pred, sched: dest.sched };
    const destT = departs(destRun);
    const timeAt = (s) => departs({ ...run, pred: s.pred, sched: s.sched });

    hero.className = "ride-hero " + p.state;
    if (rideData.trip.canceled) {
      hero.innerHTML = `<div class="ride-lead">Presidio GO canceled this trip.</div><div class="ride-sub">Go back and pick another shuttle.</div>`;
    } else if (p.state === "waiting") {
      const t0 = timeAt(stops[0]);
      hero.innerHTML = `<div class="ride-lead">Waiting for the shuttle</div>
        <div class="ride-big"><span class="num">${Math.max(0, Math.floor((t0 - now) / 60))}</span><span class="unit">min</span></div>
        <div class="ride-sub">at ${esc(SHORT[stops[0].id] || bare(stops[0].name))} · <span class="num">${clock(t0)}</span></div>`;
    } else if (p.state === "next") {
      hero.innerHTML = `<div class="ride-lead">Your stop is next</div>
        <div class="ride-alert-text">Get ready to get off</div>
        <div class="ride-sub">Get off at <b>${esc(bare(dest.name))}</b></div>`;
    } else if (p.state === "arrived") {
      hero.innerHTML = `<div class="ride-lead">You're at ${esc(ride.dest)}</div>
        <button class="ride-btn" id="rideDone">Done</button>`;
    } else {
      hero.innerHTML = `<div class="ride-big"><span class="num">${p.stopsLeft}</span><span class="unit">stops left</span></div>
        <div class="ride-sub">Get off at <b>${esc(bare(dest.name))}</b> · <span class="num">${clock(destT)}</span></div>
        <div class="ride-sub2">We'll alert you one stop before</div>`;
    }

    // Stop-by-stop list with a "you are here" marker.
    const here = p.state === "waiting" ? -1 : p.atIdx >= 0 ? p.atIdx : p.nextIdx - 0.5;
    let html = "";
    stops.forEach((s, i) => {
      if (here === i - 0.5 && p.state !== "arrived") html += `<li class="stop marker" id="rideHere"><span class="tl"></span><span class="nm">${p.source === "phone" ? "You are here" : "Shuttle is here"}</span></li>`;
      const passed = p.state !== "waiting" && (i < p.nextIdx && i !== p.atIdx);
      const cls = ["stop", passed ? "passed" : "", i === p.atIdx ? "at" : "", i === p.nextIdx && p.state !== "waiting" ? "next" : "",
                   i === last ? "dest" : "", s.skipped ? "skipped" : ""].join(" ");
      const t = timeAt(s);
      const tag = i === last ? `<span class="tag">get off</span>` : i === p.nextIdx && p.state !== "waiting" ? `<span class="tag soft">next</span>` : i === p.atIdx ? `<span class="tag soft">here</span>` : "";
      html += `<li class="${cls}" ${i === p.atIdx ? 'id="rideHere"' : ""}><span class="tl"></span>
        <span class="nm">${esc(bare(s.name))} ${tag}</span><span class="tm num">${passed ? "✓" : clock(t)}</span></li>`;
    });
    list.innerHTML = html;
    if (p.nextIdx !== lastNextIdx) {
      lastNextIdx = p.nextIdx;
      // Keep "you are here" just below the pinned header, with a couple of passed stops above it.
      const el = document.getElementById("rideHere"), box = $("ride");
      if (el) box.scrollTo({ top: Math.max(0, $("rideStops").offsetTop + el.offsetTop - $("rideHead").offsetHeight - 90), behavior: "smooth" });
    }
  }

  /* ---------- direction switch ---------- */
  function renderDir() {
    $("title").innerHTML = cfg().title;
    for (const b of document.querySelectorAll(".dirs button")) b.setAttribute("aria-selected", String(b.dataset.dir === dir));
    renderPickup();
  }
  // On the way home: which downtown stop to catch the shuttle at. Same run either way.
  function renderPickup() {
    const el = $("pickup");
    el.hidden = dir !== "home";
    if (el.hidden) return;
    el.innerHTML = `<span class="pickup-label" id="pickupLabel">Pick up at</span>` + HOME_STOPS.map((h) =>
      `<button type="button" role="radio" aria-checked="${h.id === settings.homeStop}" data-stop="${h.id}">
        <b>${esc(SHORT[h.id])}</b></button>`).join("");
  }
  function setHomeStop(id) {
    if (id === settings.homeStop || !HOME_STOPS.some((h) => h.id === id)) return;
    settings.homeStop = id;
    store.set("pgo:settings", settings);
    switchView();
  }
  function setDir(next, byTap) {
    if (byTap) store.set("pgo:dir", { dir: next, until: Date.now() + 4 * 3600 * 1000 });
    if (next === dir) return;
    dir = next;
    switchView();
  }
  // Show the new view right away (its cached copy if recent), then fetch it.
  function switchView() {
    const c = store.get("pgo:last:" + view(), null);
    data = c && Date.now() - c.receivedAt < 10 * 60 * 1000 ? c.data : null;
    receivedAt = c?.receivedAt || 0;
    selected = null; didFit = false; recentOpen = false;
    for (const m of markers.values()) busLayer?.removeLayer(m);
    markers.clear();
    renderDir();
    loadMapLayer();
    render();
    refresh();
  }

  /* ---------- boot ---------- */
  const cached = store.get("pgo:last:" + view(), null);
  if (cached && Date.now() - cached.receivedAt < 10 * 60 * 1000) { data = cached.data; receivedAt = cached.receivedAt; }
  renderDir();
  initMap();
  render();
  refresh();

  setInterval(() => document.visibilityState === "visible" && !ride && refresh(), POLL_MS);
  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (ride) return renderRide();
    // Left open past noon (or into the next morning): follow the time of day unless a tap pinned it.
    const p = store.get("pgo:dir", null);
    if (!(p && Date.now() < p.until) && autoDir() !== dir) setDir(autoDir(), false);
    render();
  }, 5000);
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
  document.querySelector(".dirs").addEventListener("click", (e) => { const b = e.target.closest("[data-dir]"); if (b) setDir(b.dataset.dir, true); });
  $("pickup").addEventListener("click", (e) => { const b = e.target.closest("[data-stop]"); if (b) setHomeStop(b.dataset.stop); });

  // Reopened mid-ride: pick up where we left off (rides older than 3 hours are stale).
  if (ride && Date.now() - ride.startedAt < 3 * 3600 * 1000) enterRide();
  else if (ride) { ride = null; try { localStorage.removeItem("pgo:ride"); } catch {} }

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
})();
