/* =====================================================================
   content.js   ←   THIS IS THE FILE YOU EDIT.
   It's just data — no code. Change text, add a project, add a photo,
   and the page rebuilds itself. Look for ✏️ TODO for the bits only
   you can fill in (real copy, photos, links).
   ===================================================================== */

/* ---- 1. Identity + hero --------------------------------------------- */
const SITE = {
  name:    "Michael Cerpa",
  eyebrow: "AI Product Manager · First conversation → live system",
  // Wrap one word in <em>…</em> to give it the green accent.
  headline: "I take <em>messy</em> problems and ship something <em>real</em>",
  sub:      "Army Intelligence → UC Berkeley → JPMorgan → Wells Fargo",
  // One mono proof line under the sub — structural facts only, no business metrics
  // (public surfaces mirror LinkedIn's disclosure level).
  receipt:  "No budget, no remit → the bank's first client-facing GenAI deployment · cleared model risk, governance & compliance",

  linkedinUrl: "https://www.linkedin.com/in/michaelanthonycerpa/",
  email:       "michael.cerp@gmail.com",
};

/* ---- 2. Sections (order + headings + nav labels) -------------------- */
/* render: "projects" = card grid | "prose" = paragraphs | "photos" = flip cards */
const SECTIONS = [
  { id:"professional", num:"01", nav:"Professional",
    title:"Enterprise AI, sanitized.",
    lead:"AI for companies that can't build it themselves - a bank under model-risk review, an installer scheduling jobs out of spreadsheets. The job is matching the system to the constraint, not maximizing the complexity. At Wells Fargo I was the first AI product manager in the corporate & investment bank, with no budget and no formal remit. I recruited an architect and an engineer by shopping the idea around, ran 40+ hours of working sessions with investment clients, and shipped the bank's first client-facing GenAI deployment - cleared through model risk, governance, and compliance. Other teams now build on it.",
    render:"projects" },

  { id:"passion", num:"02", nav:"Side Projects",
    title:"Built for my friends and me.",
    lead:"",
    render:"projects" },

  { id:"about", num:"03", nav:"About",
    title:"The short version.",
    render:"prose",
    body:[
      "I started as an Army all-source intelligence analyst out of high school, then Berkeley, then five years shipping AI inside large, regulated banks. The throughline: drop into an ambiguous, high-stakes problem and get something live. Now I lead AI for a corporate banking platform at Wells Fargo.",
      "Before that, at JPMorgan: the bank's first self-serve onboarding platform for startups - shipped in two months during the SVB collapse - and a financial modeling tool for founders that now lives on the digital bank's homepage.",
      "UC Berkeley - Political Economy and Finance (Haas BASE Program), 2021."
    ] },

  { id:"personal", num:"04", nav:"Personal",
    title:"Off the clock, usually at altitude.",
    lead:"Photography from the Sierra and beyond. Click a photo to flip it.",
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
    title:"Cairn",
    cats:"Trip Planning · NL Search · GPX",
    status:{ label:"Live", kind:"live" },
    blurb:"Sierra backcountry planner: natural-language search, condition-tuned packing lists, and exportable GPX for Garmin and Strava. Built and deployed solo, on live NOAA and Recreation.gov data.",
    demo:{ type:"iframe", url:"https://cairn-weld.vercel.app", label:"cairn-weld.vercel.app" },
  },
  {
    section:"professional",
    title:"Granite",
    cats:"Architecture · Governance · Regulated Finance",
    status:{ label:"Live", kind:"live" },
    blurb:"An interactive architecture for building AI a bank can trust: trace a request through intent → entitlements → orchestration → grounded response → LLM-as-judge → audit, and watch it refuse rather than guess. The thinking behind the platform work above, sanitized.",
    demo:{ type:"iframe", url:"https://granite-gilt-zeta.vercel.app", label:"granite-gilt-zeta.vercel.app" },
  },
  {
    section:"professional",
    title:"Strata",
    cats:"Extraction · Human-in-the-loop · Ops",
    status:{ label:"Live", kind:"live" },
    blurb:"A Forward Deployed scenario built on real ground truth: two operators with 35+ years inside a national installer, plus three summers I spent working in its branches. Their two messiest paperwork problems, rebuilt as one engine that reads the mess, writes the structured record, and asks a human only when it isn't sure.",
    demo:{ type:"iframe", url:"https://strata-phi-ochre.vercel.app", label:"strata-phi-ochre.vercel.app" },
  },
];

/* ---- 4. Photos (Personal section) ----------------------------------- */
/* img: "photos/whitney.jpg" to use a real image; leave "" to show the gradient.
   ✏️ TODO: drop photos in a /photos folder, set img, fill the metadata. */
const PHOTOS = [
  { title:"Mt. Shasta", img:"photos/shasta.jpg", gradient:"linear-gradient(160deg,#3a5a72,#7b94a3)",
    location:"Mt. Shasta, CA", date:"2024-05-11", coords:"41.4092° N, 122.1949° W", elevation:"14,179 ft" },
  { title:"Mt. Whitney", img:"photos/whitney.jpg", gradient:"linear-gradient(160deg,#4a6b4e,#8aa57a)",
    location:"Mt. Whitney, CA", date:"2024-10-04", coords:"36.5785° N, 118.2923° W", elevation:"14,505 ft" },
  { title:"Pico de Orizaba", img:"photos/pico.jpg", gradient:"linear-gradient(160deg,#6a5a3a,#a3937b)",
    location:"Pico de Orizaba, Mexico", date:"2025-02-16", coords:"19.0303° N, 97.2683° W", elevation:"18,491 ft" },
  { title:"Palisades Tahoe", img:"photos/palisades.jpg", gradient:"linear-gradient(160deg,#4a6b72,#8aa5b5)",
    location:"Palisades Tahoe, CA", date:"2026-04-03", coords:"39.1981° N, 120.2873° W", elevation:"9,006 ft" },
];
