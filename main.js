/* =====================================================================
   main.js — the engine. Reads content.js and builds the page, then
   wires up the menu, click-to-expand demos, and photo flips.
   You normally don't edit this — edit content.js instead.
   ===================================================================== */
(function () {
  const $   = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));
  // turn an HTML string into a single element
  const el  = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  /* ---------- NAV ---------- */
  const navRow = $("#navRow");
  navRow.appendChild(el(`<a href="#top" class="brand">${esc(SITE.name)}</a>`));
  const links = el(`<div class="nav-links"></div>`);
  SECTIONS.forEach(s => links.appendChild(el(`<a href="#${s.id}">${esc(s.nav)}</a>`)));
  links.appendChild(el(`<a href="${esc(SITE.resumeUrl)}" class="resume">Résumé ↗</a>`));
  navRow.appendChild(links);
  navRow.appendChild(el(`<button class="burger" id="burger" aria-label="Menu"><span></span><span></span><span></span></button>`));

  /* ---------- OVERLAY (mobile menu) ---------- */
  const overlay = $("#overlay");
  overlay.appendChild(el(`<button class="x" id="closeMenu" aria-label="Close">×</button>`));
  SECTIONS.forEach(s => overlay.appendChild(el(`<a href="#${s.id}">${esc(s.nav)}</a>`)));
  overlay.appendChild(el(`<a href="${esc(SITE.linkedinUrl)}">LinkedIn ↗</a>`));
  overlay.appendChild(el(`<a href="${esc(SITE.resumeUrl)}">Résumé ↗</a>`));

  /* ---------- HERO ---------- */
  $("#hero").innerHTML = `
    <div class="eyebrow">${esc(SITE.eyebrow)}</div>
    <h1>${SITE.headline}</h1>
    <p class="sub">${esc(SITE.sub)}</p>
    <a class="scrollcue" href="#${SECTIONS[0].id}" aria-label="Scroll"></a>`;

  /* ---------- SECTIONS ---------- */
  const main = $("#sections");
  SECTIONS.forEach(s => {
    const sec = el(`<section class="block wrap" id="${s.id}">
        <div class="kicker">${esc(s.num)} · ${esc(s.nav)}</div>
        <h2>${esc(s.title)}</h2>
        ${s.lead ? `<p class="lead">${esc(s.lead)}</p>` : ""}
      </section>`);
    if (s.render === "projects")   sec.appendChild(renderProjects(s.id));
    else if (s.render === "photos") sec.appendChild(renderPhotos());
    else if (s.render === "prose")  sec.appendChild(renderProse(s.body));
    main.appendChild(sec);
  });

  function renderProjects(sectionId) {
    const grid = el(`<div class="grid"></div>`);
    PROJECTS.filter(p => p.section === sectionId).forEach(p => grid.appendChild(renderCard(p)));
    return grid;
  }

  function renderCard(p) {
    const kind = p.status.kind === "live" ? "live" : "soon";
    const dot  = p.status.kind === "live" ? `<span class="dot"></span>` : "";
    const card = el(`<article class="card">
        <div class="top"><h3>${esc(p.title)}</h3><span class="tag ${kind}">${dot}${esc(p.status.label)}</span></div>
        ${p.cats ? `<div class="cats">${esc(p.cats)}</div>` : ""}
        <p>${p.blurb}</p>
      </article>`);
    if (p.demo) {
      card.appendChild(el(`<div class="more"><span class="plus">+</span><span class="more-label">View demo</span></div>`));
      const demo = el(`<div class="demo"></div>`);
      demo.appendChild(renderDemo(p.demo));
      card.appendChild(demo);
    }
    return card;
  }

  function renderDemo(d) {
    if (d.type === "iframe") {
      // data-src (not src) so the iframe only loads when the card is opened
      return el(`<div class="frame">
          <div class="bar"><i></i><i></i><i></i><span>${esc(d.label || d.url)}</span>
            <button class="expand" data-url="${esc(d.url)}" title="Open full">Open full ⤢</button></div>
          <iframe data-src="${esc(d.url)}" title="embedded app" loading="lazy"></iframe>
        </div>`);
    }
    const pills = (d.pills || []).map(x => `<span class="pill">${esc(x)}</span>`).join("");
    return el(`<div class="preview">
        ${d.query ? `<div class="q">${esc(d.query)}</div>` : ""}
        ${pills}
        ${d.note ? `<div class="note">${esc(d.note)}</div>` : ""}
      </div>`);
  }

  function renderProse(paras) {
    const wrap = el(`<div class="prose"></div>`);
    (paras || ["<em>Add text in content.js.</em>"]).forEach(t => wrap.appendChild(el(`<p>${t}</p>`)));
    return wrap;
  }

  function renderPhotos() {
    const grid = el(`<div class="photos"></div>`);
    PHOTOS.forEach(ph => {
      const front = ph.img
        ? `background-image:url('${esc(ph.img)}');background-size:cover;background-position:center`
        : `background:${ph.gradient || "#234"}`;
      grid.appendChild(el(`<div class="flip">
          <div class="flip-inner">
            <div class="face front" style="${front}">
              <span class="hint">⟲ flip</span><span class="cap">${esc(ph.title)}</span>
            </div>
            <div class="face back">
              <div class="mrow"><span>Location</span><b>${esc(ph.location)}</b></div>
              <div class="mrow"><span>Date</span><b>${esc(ph.date)}</b></div>
              <div class="mrow"><span>Coordinates</span><b>${esc(ph.coords)}</b></div>
              <div class="mrow"><span>Elevation</span><b>${esc(ph.elevation)}</b></div>
            </div>
          </div>
        </div>`));
    });
    return grid;
  }

  /* ---------- FOOTER ---------- */
  $("#footer").innerHTML = `
    <span class="fl">© ${new Date().getFullYear()} ${esc(SITE.name)} · Built with vanilla HTML/CSS/JS</span>
    <span>
      <a href="${esc(SITE.resumeUrl)}">Résumé</a>
      <a href="${esc(SITE.linkedinUrl)}">LinkedIn</a>
      <a href="mailto:${esc(SITE.email)}">Email</a>
    </span>`;

  /* ---------- INTERACTIONS ---------- */
  const nav = $("#nav");
  addEventListener("scroll", () => nav.classList.toggle("scrolled", scrollY > 20));

  $("#burger").onclick     = () => overlay.classList.add("open");
  $("#closeMenu").onclick   = () => overlay.classList.remove("open");
  overlay.querySelectorAll("a").forEach(a => a.onclick = () => overlay.classList.remove("open"));

  // click-to-expand demos (lazy-load the iframe on first open)
  document.querySelectorAll(".card .more").forEach(btn => {
    btn.addEventListener("click", () => {
      const card = btn.closest(".card");
      const open = !card.classList.contains("open");
      card.classList.toggle("open", open);
      btn.querySelector(".plus").textContent       = open ? "–" : "+";
      btn.querySelector(".more-label").textContent = open ? "Hide demo" : "View demo";
      if (open) {
        const f = card.querySelector("iframe[data-src]");
        if (f && !f.src) f.src = f.dataset.src;
      }
    });
  });

  // photo flip
  document.querySelectorAll(".flip").forEach(f => f.addEventListener("click", () => f.classList.toggle("flipped")));

  /* ---------- FULLSCREEN LIGHTBOX (open an embedded app full-size — still no new tab) ---------- */
  const lb = el(`<div class="lightbox" id="lightbox" aria-hidden="true">
      <div class="lb-bar"><span class="lb-url"></span><button class="lb-close" aria-label="Close">×</button></div>
      <iframe class="lb-frame" title="app — full screen"></iframe>
    </div>`);
  document.body.appendChild(lb);
  const lbFrame = lb.querySelector(".lb-frame");
  const lbUrl   = lb.querySelector(".lb-url");
  const openLB  = (url) => { lbFrame.src = url; lbUrl.textContent = url; lb.classList.add("open"); document.body.style.overflow = "hidden"; };
  const closeLB = () => { lb.classList.remove("open"); lbFrame.src = "about:blank"; document.body.style.overflow = ""; };
  lb.querySelector(".lb-close").onclick = closeLB;
  lb.addEventListener("click", e => { if (e.target === lb) closeLB(); });
  addEventListener("keydown", e => { if (e.key === "Escape") closeLB(); });
  document.querySelectorAll(".expand").forEach(b =>
    b.addEventListener("click", e => { e.stopPropagation(); openLB(b.dataset.url); }));
})();
