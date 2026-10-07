#!/usr/bin/env node
// Deterministic CV normaliser. Reads data/cv.json (LinkedIn export or sample), ADDS derived
// fields beside the raw ones (raw fields are never modified) and rewrites the file in place.
// Idempotent: derived fields are always recomputed from raw. All text heuristics live here;
// templates only present the result. Never prints CV contents.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_OVERRIDES = {
  companyNames: { Champagne_Moments: "Champagne Moments", "LEGO Group": "the LEGO Group" },
  sideRoles: null,
  summary: null,
  onepage: { detailedRoles: 2, maxRoles: 8, maxHighlights: 3, skills: 12, projects: 3, highlights: {} },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DATE_RE = new RegExp(`^(?:(${MONTHS.join("|")})\\w*\\.?\\s+)?(?:\\d{1,2},\\s+)?(\\d{4})$`, "i");
const RANGE_SEP = " – ";
const FACT_RE = /^(Stack|Tech stack|Technologies|Tools|Internal title)\s*:\s*/;
const MARKER_RE = /^[•\-*–—]\s+/;
const LIST_MODE_RE = / {2,}[–—]\s/;
const DASH_SPLIT_RE = /\s+[–—]\s+(?=[\p{Lu}\d])/u;
const SENTENCE_RE = /(?<=[.!?])\s+(?=[\p{Lu}"“‘(])/u;
const ABBREV_RE = /(?:^|\s)(?:e\.g\.|i\.e\.|vs\.|etc\.|approx\.|no\.|St\.|Mr\.|Ms\.|Dr\.)$/i;

// ---------- text helpers ----------

/** Typography on derived strings only. Never adds or removes words or full stops. */
function typo(s) {
  return String(s ?? "")
    .replace(/(?<=\p{L})'(?=\p{L})/gu, "’")
    .replace(/(?<=s)'(?=\s|$)/g, "’")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function splitSentences(text) {
  const pieces = String(text ?? "").trim().split(SENTENCE_RE);
  const out = [];
  for (const piece of pieces) {
    if (out.length && ABBREV_RE.test(out[out.length - 1])) out[out.length - 1] += " " + piece;
    else out.push(piece);
  }
  return out.filter(Boolean);
}

/** Turn LinkedIn-flattened (or real newline) text into semantic blocks plus fact lines. */
export function toBlocks(text) {
  if (text == null || String(text).trim() === "") return { blocks: [], facts: [] };
  const raw = String(text).replace(/\r\n?/g, "\n").replace(/ /g, " ");
  const hasNewline = raw.includes("\n");
  const listMode = hasNewline || LIST_MODE_RE.test(raw);
  const lines = (hasNewline ? raw.split(/\n+/) : raw.split(/ {2,}/)).map((l) => l.trim()).filter(Boolean);

  const facts = [];
  const items = []; // {list:boolean, text}
  for (const line of lines) {
    const fm = FACT_RE.exec(line);
    if (fm) {
      const value = typo(line.slice(fm[0].length).replace(/\.\s*$/, ""));
      if (value) facts.push({ label: fm[1], text: value });
      continue;
    }
    if (MARKER_RE.test(line)) {
      const body = line.replace(MARKER_RE, "");
      const parts = listMode ? body.split(DASH_SPLIT_RE) : [body];
      for (const p of parts) {
        const t = typo(p);
        if (t) items.push({ list: true, text: t });
      }
    } else {
      const t = typo(line);
      if (t) items.push({ list: false, text: t });
    }
  }

  const blocks = [];
  for (const it of items) {
    if (it.list) {
      const last = blocks[blocks.length - 1];
      if (last && last.type === "ul") last.items.push(it.text);
      else blocks.push({ type: "ul", items: [it.text] });
    } else {
      blocks.push({ type: "p", text: it.text });
    }
  }
  return { blocks, facts };
}

function leadOf(blocks) {
  const p = blocks.find((b) => b.type === "p");
  return p ? splitSentences(p.text)[0] ?? "" : "";
}

function slugify(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---------- dates ----------

function parseDate(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  const m = DATE_RE.exec(s);
  if (!m) return { label: s, iso: null, year: null };
  const year = m[2];
  if (m[1]) {
    const idx = MONTHS.findIndex((x) => x.toLowerCase() === m[1].slice(0, 3).toLowerCase());
    return { label: `${MONTHS[idx]} ${year}`, iso: `${year}-${String(idx + 1).padStart(2, "0")}`, year };
  }
  return { label: year, iso: year, year };
}

function makeWhen(startRaw, endRaw) {
  const s = parseDate(startRaw);
  const e = parseDate(endRaw);
  if (!s && !e) return { label: "", years: "", startIso: null };
  if (!s) return { label: e.label, years: e.year ?? e.label, startIso: null };
  const ys = s.year ?? s.label;
  if (!e) return { label: `${s.label}${RANGE_SEP}Present`, years: `${ys}${RANGE_SEP}Present`, startIso: s.iso };
  const ye = e.year ?? e.label;
  return {
    label: s.label === e.label ? s.label : `${s.label}${RANGE_SEP}${e.label}`,
    years: ys === ye ? ys : `${ys}${RANGE_SEP}${ye}`,
    startIso: s.iso,
  };
}

const sortKey = (iso) => (iso ? (iso.length === 4 ? `${iso}-00` : iso) : null);

// ---------- normalise ----------

function mergeOverrides(o) {
  const d = DEFAULT_OVERRIDES;
  const x = o ?? {};
  return {
    companyNames: { ...d.companyNames, ...(x.companyNames ?? {}) },
    sideRoles: x.sideRoles ?? d.sideRoles,
    summary: x.summary ?? d.summary,
    onepage: { ...d.onepage, ...(x.onepage ?? {}), highlights: { ...(x.onepage?.highlights ?? {}) } },
  };
}

const LEVELS = [
  [/^native/i, 5],
  [/^full professional/i, 4],
  [/^professional working/i, 3],
  [/^limited working/i, 2],
  [/^elementary/i, 1],
];

function summaryOf(aboutBlocks, overrides) {
  if (overrides.summary != null) {
    const arr = Array.isArray(overrides.summary) ? overrides.summary : [overrides.summary];
    return arr.map((s) => typo(s)).filter(Boolean);
  }
  const paras = aboutBlocks.filter((b) => b.type === "p").map((b) => b.text);
  if (!paras.length) return [];
  const sentences = splitSentences(paras[0]);
  const last = paras.length >= 2 ? paras[paras.length - 1] : null;
  if (last && last.split(/\s+/).length <= 60) return [sentences.slice(0, 2).join(" "), last];
  return [sentences.slice(0, 3).join(" ")];
}

export function normalize(input, overridesIn) {
  const cv = JSON.parse(JSON.stringify(input ?? {}));
  const ov = mergeOverrides(overridesIn);
  const used = new Set();
  const uniqueId = (base) => {
    const b = base || "item";
    let id = b;
    for (let n = 2; used.has(id); n++) id = `${b}-${n}`;
    used.add(id);
    return id;
  };

  cv.normalized = { version: 1 };

  // intro
  const intro = cv.intro && typeof cv.intro === "object" ? cv.intro : (cv.intro = {});
  const segments = String(intro.headline ?? "").split("|").map(typo).filter(Boolean);
  const about = toBlocks(intro.about);
  intro.name = typo([intro.firstName, intro.lastName].filter(Boolean).join(" "));
  intro.tagline = segments[0] ?? "";
  intro.facets = segments.slice(1);
  intro.aboutBlocks = about.blocks;
  intro.summary = summaryOf(about.blocks, ov);

  // experience (LinkedIn order kept)
  const experience = Array.isArray(cv.experience) ? cv.experience : [];
  const sideList = Array.isArray(ov.sideRoles) ? ov.sideRoles : null;
  for (const e of experience) {
    const when = makeWhen(e.startedOn ?? e.startDate, e.finishedOn ?? e.endDate);
    const { blocks, facts } = toBlocks(e.description);
    const rawCompany = e.companyName ?? "";
    const company = typo(Object.hasOwn(ov.companyNames, rawCompany) ? ov.companyNames[rawCompany] : rawCompany);
    e.id = uniqueId(`${slugify(company)}-${when.startIso ?? "undated"}`);
    e.company = company;
    e.kind = (sideList ? sideList.includes(rawCompany) : /advisory|investor|board|educator/i.test(e.title ?? "")) ? "side" : "main";
    e.current = !parseDate(e.finishedOn ?? e.endDate);
    e.when = when;
    e.blocks = blocks;
    e.facts = facts;
    e.lead = leadOf(blocks);
  }

  // projects (sorted by start desc, undated last; stable)
  if (Array.isArray(cv.projects)) {
    for (const p of cv.projects) {
      const title = typo(p.title ?? p.name);
      const m = /\s+[–—-]\s+/.exec(title);
      const when = makeWhen(p.startedOn ?? p.startDate, p.finishedOn ?? p.endDate);
      const { blocks, facts } = toBlocks(p.description);
      p.name = m ? title.slice(0, m.index) : title;
      p.subtitle = m ? title.slice(m.index + m[0].length) : "";
      p.when = when;
      p.blocks = blocks;
      p.facts = facts;
    }
    const keyed = cv.projects.map((p, i) => ({ p, i, k: sortKey(p.when.startIso) }));
    keyed.sort((a, b) => (a.k === b.k ? a.i - b.i : a.k === null ? 1 : b.k === null ? -1 : a.k < b.k ? 1 : -1));
    cv.projects = keyed.map((x) => x.p);
    for (const p of cv.projects) p.id = uniqueId(`${slugify(p.name)}-${p.when.startIso ?? "undated"}`);
  }

  // education
  for (const e of Array.isArray(cv.education) ? cv.education : []) {
    const when = makeWhen(e.startDate ?? e.startedOn, e.endDate ?? e.finishedOn);
    const { blocks, facts } = toBlocks(e.activities);
    e.id = uniqueId(`${slugify(e.schoolName)}-${when.startIso ?? "undated"}`);
    e.when = when;
    e.blocks = blocks;
    e.facts = facts;
  }

  // publications
  for (const p of Array.isArray(cv.publications) ? cv.publications : []) {
    const d = parseDate(p.publishedOn);
    p.when = { label: d ? d.label : "", years: d ? d.year ?? d.label : "", startIso: d ? d.iso : null };
  }

  // other dated sections: add when/blocks/facts without touching raw fields
  for (const key of ["certifications", "volunteering", "honors", "courses", "organizations"]) {
    for (const it of Array.isArray(cv[key]) ? cv[key] : []) {
      const start = it.startedOn ?? it.startDate ?? it.issuedOn ?? it.issuedAt;
      const when = makeWhen(start, it.finishedOn ?? it.endDate);
      const single = !(it.finishedOn ?? it.endDate) && !(it.startedOn ?? it.startDate);
      if (single && start) {
        const d = parseDate(start);
        it.when = { label: d.label, years: d.year ?? d.label, startIso: d.iso };
      } else {
        it.when = when;
      }
      const { blocks, facts } = toBlocks(it.description);
      it.blocks = blocks;
      it.facts = facts;
    }
  }

  // languages (stable sort by rank desc)
  if (Array.isArray(cv.languages)) {
    for (const l of cv.languages) {
      const prof = String(l.proficiency ?? "");
      l.levelShort = typo(prof.replace(/\s+or bilingual/i, "").replace(/\s+proficiency\s*$/i, ""));
      l.rank = (LEVELS.find(([re]) => re.test(prof)) ?? [null, 0])[1];
    }
    cv.languages = cv.languages.map((l, i) => ({ l, i })).sort((a, b) => b.l.rank - a.l.rank || a.i - b.i).map((x) => x.l);
  }

  // onepage
  const op = ov.onepage;
  const roles = experience
    .filter((e) => e.kind === "main")
    .slice(0, op.maxRoles)
    .map((e, i) => {
      const firstUl = e.blocks.find((b) => b.type === "ul");
      const all = firstUl ? firstUl.items : [];
      const picks = op.highlights[`${e.companyName}|${e.startedOn}`];
      const highlights = Array.isArray(picks)
        ? picks.map((n) => all[n]).filter((x) => x !== undefined)
        : all.slice(0, op.maxHighlights);
      return { company: e.company, title: typo(e.title), years: e.when.years, detailed: i < op.detailedRoles, lead: e.lead, highlights };
    });
  cv.onepage = {
    roles,
    projects: (cv.projects ?? []).slice(0, op.projects).map((p) => ({ name: p.name, subtitle: p.subtitle, years: p.when.years })),
    skills: (Array.isArray(cv.skills) ? cv.skills : []).map((s) => typo(s.name)).filter(Boolean).slice(0, op.skills),
  };

  return cv;
}

// ---------- CLI ----------

function main() {
  const dataPath = path.join(ROOT, "data", "cv.json");
  if (!fs.existsSync(dataPath)) {
    console.error("data/cv.json not found (run npm run fetch or npm run fetch:sample)");
    process.exit(1);
  }
  const overridesPath = path.join(ROOT, "cv.overrides.json");
  const overrides = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, "utf8")) : null;
  const out = normalize(JSON.parse(fs.readFileSync(dataPath, "utf8")), overrides);
  fs.writeFileSync(dataPath, JSON.stringify(out, null, 2) + "\n");
  const side = out.experience.filter((e) => e.kind === "side").length;
  console.log(`CV normalised: ${out.experience.length} roles (${side} side), ${out.projects?.length ?? 0} projects`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
