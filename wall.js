/* wall.js — the globe of TVs behind the home page.
   Builds 51 screens on the front of a sphere and plays one short silent clip on each.
   Every screen shows a different clip. The globe never moves.

   Kept light on purpose:
   - a screen plays only while it is inside the window and not hidden behind an open page
   - phones load smaller copies of the clips and play at most 25 at once
   - if the device drops frames, the outer screens fall back to still pictures
   - visitors who ask for reduced motion get still pictures only                                */
(function () {
  var root = document.documentElement, wall = document.getElementById('wall');

  // WHAT PLAYS WHERE. The wall is the front of a sphere: nine rows of screens, top to bottom.
  // The middle rows hold seven screens; rows nearer the poles hold fewer, as on any globe.
  // On a laptop you look at the middle of it (the first and last rows are off the top and bottom).
  // On a phone you see the whole globe.
  //
  // Hung like a wall of pictures, not filled in a list:
  //   - the orange-jacket climber is the centre screen
  //   - no two neighbours share a colour or a sport: snow beside forest, a ride beside a climb
  //   - the warm frames (sunset, red lamp, alpenglow) sit far apart, as accents
  //   - the night clips are spread around, so no side of the globe looks switched off
  //   - the nine screens round the centre run cool on top (blue dawn, gold hills, white snow), strong in the
  //     middle (green forest, the climber, the orange sun), and people along the bottom (friends, the rope team, riders in the fog)
  //   - second cuts of a scene go near the poles, where they are small and far from the first
  var ROWS = [
    /*  4 */ ['night-blue', 'overlook', 'bridge-fog-2'],
    /*  3 */ ['night-walk', 'dawn-skis', 'road-far', 'red-lamp-2', 'lift-ride'],
    /*  2 */ ['night-snow', 'chairlift-far', 'swell', 'city-sky', 'night-poles', 'ski-pov', 'cirrus'],
    /*  1 */ ['night-rest', 'red-lamp', 'dawn-climber', 'golden-hills', 'summit-skis', 'road-descent', 'sutro'],
    /*  0 */ ['bridge-fog', 'ski-turns', 'redwoods', 'scree-descent', 'ocean-sunset', 'chairlift', 'night-run'],
    /* -1 */ ['sierra-view', 'sunrise-lake', 'hilltop-stop', 'ridge-line', 'bridge-riders', 'night-climb', 'dawn-line'],
    /* -2 */ ['lift-sun', 'night-faces', 'ski-spray', 'redwoods-3', 'road-climb', 'alpenglow', 'headlamp'],
    /* -3 */ ['ocean-sunset-2', 'night-run-2', 'ridge-line-2', 'sunrise-lake-2', 'scree-2'],
    /* -4 */ ['night-ridge', 'shadow', 'ski-far']
  ];
  var STEP_LAT = 11.8, STEP_LON = 13.9;            // degrees between rows, and between screens along the equator
  var cells = [];
  ROWS.forEach(function (row, r) {
    var lat = (4 - r) * STEP_LAT, step = STEP_LON / Math.cos(lat * Math.PI / 180);      // screens spread out toward the poles so they never overlap
    row.forEach(function (clip, c) {
      var lon = (c - (row.length - 1) / 2) * step;
      var away = Math.acos(Math.cos(lat * Math.PI / 180) * Math.cos(lon * Math.PI / 180)) * 180 / Math.PI;   // degrees from the centre screen
      cells.push({ clip: clip, lat: lat, lon: lon, away: away });
    });
  });
  cells.sort(function (p, q) { return q.away - p.away; });      // far screens first, so near ones are painted on top

  // Phones get lighter copies of the clips (240x184 at 15 frames a second), in assets/tv/s/.
  var SMALL = Math.min(innerWidth, innerHeight) < 600 || (navigator.maxTouchPoints > 1 && Math.min(screen.width, screen.height) < 600);
  // The still frame of every clip is packed into one picture (tools/make-posters.mjs in the mock-up folder),
  // tiles in alphabetical order, nine across. One request shows the whole globe before any video arrives.
  var ORDER = cells.map(function (c) { return c.clip; }).sort(), COLS = 9, PROWS = Math.ceil(ORDER.length / COLS);
  root.style.setProperty('--posters', 'url(assets/tv/posters' + (innerWidth < 760 ? '-s' : '') + '.jpg)');
  var html = '';
  cells.forEach(function (c, i) {
    var n = ORDER.indexOf(c.clip), px = (n % COLS) / (COLS - 1) * 100, py = Math.floor(n / COLS) / (PROWS - 1) * 100;
    var ring = c.away < 21 ? 1 : c.away < 36 ? 2 : 3;
    // --a / --b: where the set sits on the globe.  --z / --k: a trace of unevenness, like sets stacked by hand.
    html += '<div class="tv" style="--a:' + c.lon.toFixed(2) + 'deg;--b:' + c.lat.toFixed(1) + 'deg;--z:' + ((((i * 37) % 9) - 4) * 0.12).toFixed(2) + 'deg;--k:' + (0.958 + ((i * 53) % 4) * 0.004).toFixed(3) + '">' +
      '<div class="set"><span class="tube" style="background-position:' + px.toFixed(2) + '% ' + py.toFixed(2) + '%">' +
      '<video muted loop playsinline preload="none" data-src="assets/tv/' + (SMALL ? 's/' : '') + c.clip + '.mp4" data-ring="' + ring + '" data-d="' + c.away.toFixed(1) + '"></video></span>' +
      '<span class="deck"><b></b><i></i><i></i><i></i><i class="led"></i></span></div></div>';
  });
  wall.innerHTML = html;

  // How big to draw the globe. Seen from the front it is 1440 units across.
  //   laptop: a little wider than the window, so you are looking into the middle of it
  //   phone:  the whole globe, floating between the name and the music player. It runs a little past the
  //           sides of the screen so it feels close, while its top and bottom curve away in full view
  function fit() {
    var s = innerWidth < 760 ? Math.min(innerWidth * 1.24, (innerHeight - 150) * 1.02) / 1440 : Math.max(innerWidth / 1500, innerHeight / 1060);
    root.style.setProperty('--s', s.toFixed(4));
    root.style.setProperty('--gr', (s * 672).toFixed(1) + 'px');      // the globe's radius on screen, for the glow and shading on phones
  }
  fit();

  // ---- playback ----
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var vids = Array.prototype.slice.call(wall.querySelectorAll('video'));
  vids.sort(function (a, b) { return a.dataset.d - b.dataset.d; });          // nearest the middle first
  var panel = document.getElementById('panel');
  var maxRing = 3;            // 3 = every screen, 2 = the outer ring shows stills, 1 = only the middle nine play
  var refused = false;        // the browser said no to auto-play (Low Power Mode, strict settings)
  var ramp = 9;               // how many clips may be fetched so far: the middle nine first, then outward a few at a time

  function tune() {
    if (still) return;
    // On a phone at most 25 screens play at once, and the ones showing the most picture go first.
    // That is the middle of the globe; the thin screens around its edge stay as still pictures.
    var cap = SMALL ? 25 : 99, shown = [];
    var pr = document.body.classList.contains('has-panel') && !panel.hidden ? panel.getBoundingClientRect() : null;
    vids.forEach(function (v) {
      var r = v.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var area = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
      var on = r.width > 8 && r.height > 8 && area > 0;
      if (on && pr && cx > pr.left && cx < pr.right && cy > pr.top && cy < pr.bottom) on = false;      // behind the open page
      if (on && (+v.dataset.ring > maxRing || document.hidden)) on = false;
      if (on) shown.push([v, area]); else if (!v.paused) v.pause();
    });
    if (shown.length > cap) {
      shown.sort(function (a, b) { return b[1] - a[1]; });
      shown.splice(cap).forEach(function (x) { if (!x[0].paused) x[0].pause(); });
    }
    var fetched = vids.filter(function (v) { return v.getAttribute('src'); }).length;
    shown.sort(function (a, b) { return a[0].dataset.d - b[0].dataset.d; });      // nearest the middle first
    shown.forEach(function (x) {
      var v = x[0];
      if (refused) return;
      if (!v.getAttribute('src')) { if (fetched >= ramp) return; fetched++; v.setAttribute('src', v.dataset.src); }
      v.muted = true;
      if (v.paused) {
        var p = v.play();
        if (p && p.catch) p.catch(function (e) { if (e && e.name === 'NotAllowedError') refused = true; });
      }
    });
  }
  // If auto-play was refused, the screens show their still frames, and the first tap, click or key press starts them.
  ['pointerdown', 'keydown'].forEach(function (ev) { addEventListener(ev, function () { if (refused) { refused = false; tune(); } }, { passive: true }); });
  var rt; addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { fit(); tune(); }, 120); });
  addEventListener('pageshow', tune);
  document.addEventListener('visibilitychange', tune);
  document.addEventListener('sheet:change', function () { setTimeout(tune, 30); });
  tune();
  var rampTimer = setInterval(function () { ramp += 8; tune(); if (ramp > 60) clearInterval(rampTimer); }, 260);

  // Watchdog: for the first few seconds, watch for dropped video frames and slow screen updates.
  // If the device is struggling, drop the outer ring of screens to stills, then the next ring.
  window.TVWALL = { videos: vids, health: null };
  function watch(round) {
    if (still || document.hidden || maxRing <= 1 || round > 3) return;
    var n = 0, slow = 0, t0 = 0, last = 0, q0 = quality();
    function quality() { var d = 0, t = 0; vids.forEach(function (v) { if (!v.paused && v.getVideoPlaybackQuality) { var q = v.getVideoPlaybackQuality(); d += q.droppedVideoFrames; t += q.totalVideoFrames; } }); return [d, t]; }
    requestAnimationFrame(function step(t) {
      if (!t0) t0 = last = t; else { if (t - last > 50) slow++; n++; last = t; }
      if (t - t0 < 3500) return requestAnimationFrame(step);
      var q1 = quality(), frames = q1[1] - q0[1], dropped = q1[0] - q0[0];
      var bad = (n > 30 && slow / n > 0.3) || (frames > 100 && dropped / frames > 0.12);   // under about 20 screen updates a second, or 1 video frame in 8 dropped
      window.TVWALL.health = { round: round, slowShare: +(slow / Math.max(1, n)).toFixed(2), droppedShare: +(dropped / Math.max(1, frames)).toFixed(2), maxRing: maxRing };
      if (bad) { maxRing--; tune(); setTimeout(function () { watch(round + 1); }, 1200); }
    });
  }
  setTimeout(function () { watch(1); }, 2500);

  // Opening or closing a page: one short flash of TV snow over the wall. The snow is drawn once, here.
  (function () {
    var c = document.createElement('canvas'); c.width = c.height = 110;
    var x = c.getContext('2d'), d = x.createImageData(110, 110);
    for (var i = 0; i < d.data.length; i += 4) { var v = Math.random() < 0.5 ? 20 + Math.random() * 60 : 150 + Math.random() * 105; d.data[i] = d.data[i + 1] = v; d.data[i + 2] = v + 12; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0);
    root.style.setProperty('--noise', 'url(' + c.toDataURL() + ')');
    var flick = document.getElementById('flick'), t, first = true;
    document.addEventListener('sheet:change', function () {
      if (first) { first = false; return; }            // not on page load
      if (still || SMALL || innerWidth < 760 || navigator.maxTouchPoints > 0) return;      // laptops only: on iPhones it stuck on screen as a sheet of static
      flick.classList.add('on'); clearTimeout(t);
      t = setTimeout(function () { flick.classList.remove('on'); }, 140);
    });
  })();
})();
