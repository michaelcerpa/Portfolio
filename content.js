/* =====================================================================
   content.js   ←   THIS IS THE FILE YOU EDIT.
   It's just data — no code. Change text, add a project, add a photo,
   and the page rebuilds itself. Look for ✏️ TODO for the bits only
   you can fill in (real copy, photos, links).
   ===================================================================== */

/* ---- 1. Identity + hero --------------------------------------------- */
const SITE = {
  name:    "Michael Cerpa",
  eyebrow: "Operator · AI in regulated environments",
  // Wrap one word in <em>…</em> to give it the green accent.
  headline: "I ship <em>AI</em> that survives the bank.",   // ✏️ TODO: reword, keep it professional
  sub:      "Army intelligence → UC Berkeley → JPMorgan → Wells Fargo.",

  resumeUrl:   "#",                 // ✏️ TODO: link to your résumé PDF
  linkedinUrl: "#",                 // ✏️ TODO: your LinkedIn URL
  email:       "you@example.com",   // ✏️ TODO: your email
};

/* ---- 2. Sections (order + headings + nav labels) -------------------- */
/* render: "projects" = card grid | "prose" = paragraphs | "photos" = flip cards */
const SECTIONS = [
  { id:"passion", num:"01", nav:"Passion",
    title:"Things I built because I wanted them to exist.",
    lead:"Each opens inline — never a new tab. Click a card to expand the live demo.",
    render:"projects" },

  { id:"professional", num:"02", nav:"Professional",
    title:"Enterprise AI, sanitized to patterns.",
    lead:"Real product work, stripped of anything proprietary — architecture you can click through.",
    render:"projects" },

  { id:"about", num:"03", nav:"About",
    title:"The short version.",
    render:"prose",
    body:[   // ✏️ TODO: your story — first thing a hiring manager reads
      "<em>Placeholder.</em> A few sentences on who you are and what you do — Army intelligence to Berkeley to JPMorgan to Wells Fargo, shipping AI in regulated environments.",
      "A second paragraph if you want one."
    ] },

  { id:"education", num:"04", nav:"Education",
    title:"UC Berkeley.",
    render:"prose",
    body:[ "<em>Placeholder.</em> Degree, focus, and any relevant coursework or honors." ] },  // ✏️ TODO

  { id:"personal", num:"05", nav:"Personal",
    title:"Off the clock, usually at altitude.",
    lead:"Photography from the Sierra. Click a photo to flip it.",
    render:"photos" },
];

/* ---- 3. Projects ---------------------------------------------------- */
/* section: "passion" | "professional"
   status.kind: "live" (green dot) | "soon" (outline)
   demo:  { type:"iframe",  url, label }                  ← embeds the real live app
       or { type:"preview", query, pills:[...], note }    ← placeholder until it's built
       or null                                            ← no demo button                */
const PROJECTS = [
  {
    section:"passion",
    title:"Cairn AI",
    cats:"Trip Planning · NL Search · GPX",
    status:{ label:"Live", kind:"live" },
    blurb:"Sierra backcountry trip-planner: natural-language search, current-conditions beta, condition-tuned packing lists.",
    demo:{ type:"iframe", url:"https://cairn-weld.vercel.app", label:"cairn-weld.vercel.app" },
  },
  {
    section:"passion",
    title:"Playlist, but only yours",
    cats:"Spotify API · NL · Personal",
    status:{ label:"Building", kind:"soon" },
    blurb:"Build playlists from natural language — pulling <em>only</em> from songs already in your library. The thing Spotify's prompt feature won't do.",
    demo:{ type:"preview", query:"“upbeat indie for a long climb — only my saved songs”",
           pills:["Phoebe Bridgers","Big Thief","Hovvdy"],
           note:"Illustrative · demo swaps in once the build exists." },
  },
  {
    section:"professional",
    title:"Vantage",
    cats:"Architecture · Governance · Banking",
    status:{ label:"In progress", kind:"soon" },
    blurb:"An interactive white paper: intent → orchestration → retrieval → grounded response → audit → escalation. Click through the whole flow.",
    demo:{ type:"preview", query:"Interactive architecture walkthrough",
           pills:["Intent","Orchestrate","Retrieve","Audit"],
           note:"Illustrative concept · sanitized patterns only." },
  },
  {
    section:"professional",
    title:"IBP Case Studies",
    cats:"Concept · Interactive",
    status:{ label:"Coming", kind:"soon" },
    blurb:"Existing case studies, rebuilt as clickable concepts instead of static slides.",
    demo:{ type:"preview", note:"Coming — concept stage." },
  },
];

/* ---- 4. Photos (Personal section) ----------------------------------- */
/* img: "photos/whitney.jpg" to use a real image; leave "" to show the gradient.
   ✏️ TODO: drop photos in a /photos folder, set img, fill the metadata. */
const PHOTOS = [
  { title:"Mt. Whitney",  img:"", gradient:"linear-gradient(160deg,#3a5a72,#7b94a3)",
    location:"Mt. Whitney, CA", date:"2025-09-14", coords:"36.5785° N, 118.2923° W", elevation:"14,505 ft" },
  { title:"Sabrina Basin", img:"", gradient:"linear-gradient(160deg,#4a6b4e,#8aa57a)",
    location:"Bishop, CA", date:"2025-07-22", coords:"37.1758° N, 118.6112° W", elevation:"10,300 ft" },
  { title:"Alabama Hills", img:"", gradient:"linear-gradient(160deg,#6a5a3a,#a3937b)",
    location:"Lone Pine, CA", date:"2026-03-08", coords:"36.6061° N, 118.1192° W", elevation:"4,800 ft" },
];
