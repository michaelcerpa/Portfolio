/* =====================================================================
   content.js   ←   THIS IS THE FILE YOU EDIT.
   It's just data — no code. Change text, add a project, add a photo,
   and the page rebuilds itself. Look for ✏️ TODO for the bits only
   you can fill in (real copy, photos, links).
   ===================================================================== */

/* ---- 1. Identity + hero --------------------------------------------- */
const SITE = {
  name:    "Michael Cerpa",
  eyebrow: "AI Product Manager · Ships 0-to-1",
  // Wrap one word in <em>…</em> to give it the green accent.
  headline: "I take <em>messy</em> problems from clients and ship something real in <em>regulated</em> environments",
  sub:      "Army Intelligence → UC Berkeley → JPMorgan → Wells Fargo",

  linkedinUrl: "https://www.linkedin.com/in/michaelanthonycerpa/",
  email:       "michael.cerp@gmail.com",
};

/* ---- 2. Sections (order + headings + nav labels) -------------------- */
/* render: "projects" = card grid | "prose" = paragraphs | "photos" = flip cards */
const SECTIONS = [
  { id:"passion", num:"01", nav:"Side Projects",
    title:"Solutions for my friends and me.",
    lead:"",
    render:"projects" },

  { id:"professional", num:"02", nav:"Professional",
    title:"Enterprise AI, sanitized.",
    lead:"Real product work - shipped solutions and case studies, rebuilt as clickable architectures and concepts.",
    render:"projects" },

  { id:"about", num:"03", nav:"About",
    title:"The short version.",
    render:"prose",
    body:[
      "I started as an Army all-source intelligence analyst out of high school, then Berkeley, then five years shipping AI inside large, regulated banks. The throughline: drop into an ambiguous, high-stakes problem and get something live. Now I lead AI for a corporate banking platform at Wells Fargo."
    ] },

  { id:"education", num:"04", nav:"Education",
    title:"UC Berkeley.",
    render:"prose",
    body:[ "University of California, Berkeley - Political Economy and Finance (Haas BASE Program), 2021." ] },

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
    blurb:"Sierra backcountry planner: natural-language search, condition-tuned packing lists, and exportable GPX for Garmin and Strava.",
    demo:{ type:"iframe", url:"https://cairn-weld.vercel.app", label:"cairn-weld.vercel.app" },
  },
  {
    section:"passion",
    title:"Playlist, but only yours",
    cats:"Spotify API · NL · Personal",
    status:{ label:"Building", kind:"soon" },
    blurb:"Build playlists from natural language - pulling <em>only</em> from songs already in your library. The thing Spotify's own prompt feature won't.",
    demo:{ type:"preview", query:"“upbeat indie for a long climb — only my saved songs”",
           pills:["Phoebe Bridgers","Big Thief","Hovvdy"],
           note:"Illustrative · demo swaps in once the build exists." },
  },
  {
    section:"professional",
    title:"Granite",
    cats:"Architecture · Governance · Regulated Finance",
    status:{ label:"Live", kind:"live" },
    blurb:"An interactive white paper on building AI a bank can trust: trace a request through intent → entitlements → orchestration → grounded response → LLM-as-judge → audit, and watch it refuse rather than guess.",
    demo:{ type:"iframe", url:"https://granite-gilt-zeta.vercel.app", label:"granite-gilt-zeta.vercel.app" },
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
