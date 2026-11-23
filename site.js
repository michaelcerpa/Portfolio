/* site.js — the three pages (About, Projects, Articles) and the music player.
   The words themselves are in index.html. This file only opens and closes things. */
(function () {
  // ---------- pages ----------
  // A menu word opens its page as a sheet of paper over the wall. Each page has its own address
  // (mcerpa.com/#about, #projects, #articles), so links and the back button work.
  var panel = document.getElementById('panel'), scroller = panel.querySelector('.panel__scroll');
  var sections = Array.prototype.slice.call(panel.querySelectorAll('[data-panel]'));
  var ids = sections.map(function (s) { return s.dataset.panel; });
  // The sections carry ids so the menu works as plain links without JavaScript. With it, drop them:
  // otherwise the browser tries to scroll the page to the section and nudges the sheet out of place.
  sections.forEach(function (s) { s.removeAttribute('id'); });
  var OLD = { work: 'projects' };                       // addresses from the previous site
  var last = null;

  function current() {
    var id = decodeURIComponent(location.hash.slice(1));
    id = OLD[id] || id;
    return ids.indexOf(id) >= 0 ? id : null;
  }
  function render() {
    var id = current();
    document.querySelectorAll('[data-go]').forEach(function (a) { if (a.dataset.go === id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    document.body.classList.toggle('has-panel', !!id);
    document.body.dataset.open = id || '';
    panel.hidden = !id;
    if (id) { sections.forEach(function (s) { s.hidden = s.dataset.panel !== id; }); scroller.scrollTop = 0; panel.scrollTop = 0; }
    else if (last && document.contains(last)) last.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('sheet:change', { detail: { id: id } }));
  }
  function shut() { if (current()) { history.pushState(null, '', location.pathname + location.search); render(); } }

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-go]');
    if (a) { e.preventDefault(); last = a; if (current() === a.dataset.go) shut(); else location.hash = a.dataset.go; return; }   // the same word again closes it
    if (e.target.closest('[data-home]')) { e.preventDefault(); return shut(); }                                                   // so does the name
    if (e.target.closest('.panel__close')) return shut();
    if (current() && !e.target.closest('#panel, .hud, .player')) shut();                                                          // and a click on the wall
  });
  addEventListener('hashchange', render);
  addEventListener('keydown', function (e) { if (e.key === 'Escape') shut(); });
  render();

  // ---------- music ----------
  // One song. It never starts by itself: browsers only allow sound after a press, and it would be rude anyway.
  // Where the sound comes from, in order:
  //   1. a song file at assets/audio/track.mp3 (or track.m4a), if one has been added
  //   2. otherwise Spotify's own player, kept out of sight and driven by the ink buttons. A visitor who is
  //      logged in to Spotify hears the whole song; anyone else hears Spotify's 26-second preview.
  //      Nothing is requested from Spotify until the pointer reaches the player or the screen is touched.
  // If neither works, the player stays hidden.
  var TRACK = { files: ['assets/audio/track.mp3', 'assets/audio/track.m4a'], spotify: '4jXl6VtkFFKIt3ycUQc5LT' };   // Circles, Mac Miller
  (function () {
    var box = document.getElementById('player'), pp = document.getElementById('pp'), stop = document.getElementById('stop'), time = document.getElementById('time');
    if (!box) return;
    var fmt = function (s) { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); };
    var pos = 0, dur = 0, playing = false, src = null, kind = 'none';
    function paint() { time.textContent = fmt(pos) + ' / ' + (dur ? fmt(dur) : '-:--'); box.classList.toggle('is-playing', playing); pp.setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
    function ready(source, name) { src = source; kind = name; box.hidden = false; paint(); }

    // 1. the file
    var au = new Audio(), fi = 0;
    au.preload = 'metadata'; au.loop = true; au.volume = 0.7;
    au.addEventListener('loadedmetadata', function () {
      dur = isFinite(au.duration) ? au.duration : 0;
      ready({ play: function () { var p = au.play(); if (p && p.catch) p.catch(function () {}); }, pause: function () { au.pause(); },
              stop: function () { au.pause(); try { au.currentTime = 0; } catch (e) {} pos = 0; paint(); } }, 'file');
    });
    au.addEventListener('play', function () { playing = true; paint(); });
    au.addEventListener('pause', function () { playing = false; paint(); });
    au.addEventListener('timeupdate', function () { pos = au.currentTime; paint(); });
    au.addEventListener('error', function () { if (++fi < TRACK.files.length) au.src = TRACK.files[fi]; else if (TRACK.spotify) spotify(); });
    au.src = TRACK.files[0];

    // 2. Spotify
    function spotify() {
      var ctl = null, wanted = false, loading = false, begun = false;
      box.insertAdjacentHTML('beforeend', '<a class="player__via" href="https://open.spotify.com/track/' + TRACK.spotify + '" target="_blank" rel="noopener">on Spotify</a>');
      function load() {
        if (loading) return; loading = true;
        var holder = document.createElement('div'); holder.className = 'player__embed'; holder.setAttribute('aria-hidden', 'true');
        holder.appendChild(document.createElement('div')); document.body.appendChild(holder);
        window.onSpotifyIframeApiReady = function (API) {
          API.createController(holder.firstChild, { uri: 'spotify:track:' + TRACK.spotify, width: 320, height: 152 }, function (c) {
            c.addListener('ready', function () { ctl = c; if (wanted) { begun = true; c.play(); } });
            c.addListener('playback_update', function (e) {
              var d = e.data || {}; dur = (d.duration || 0) / 1000; if (wanted) pos = (d.position || 0) / 1000; playing = !d.isPaused && wanted; paint();
            });
          });
        };
        var s = document.createElement('script'); s.src = 'https://open.spotify.com/embed/iframe-api/v1'; s.async = true;
        s.onerror = function () { box.hidden = true; };          // Spotify unreachable: no player
        document.head.appendChild(s);
      }
      // get Spotify's player ready just before it is needed, so the first press starts the song
      box.addEventListener('pointerenter', load);
      addEventListener('touchstart', load, { once: true, passive: true });
      pp.addEventListener('focus', load);
      ready({ play: function () { wanted = true; if (!ctl) return load(); if (begun) ctl.resume(); else { begun = true; ctl.play(); } },   // resume carries on from where it was paused
              pause: function () { wanted = false; if (ctl) ctl.pause(); },
              stop: function () { wanted = false; begun = false; if (ctl) ctl.pause(); pos = 0; playing = false; paint(); } }, 'spotify');
    }

    pp.addEventListener('click', function () { if (!src) return; if (playing) src.pause(); else src.play(); });
    stop.addEventListener('click', function () { if (src) src.stop(); });
    window.TVMUSIC = { state: function () { return { playing: playing, pos: +pos.toFixed(1), dur: +dur.toFixed(1), source: kind, shown: !box.hidden }; } };
  })();
})();
