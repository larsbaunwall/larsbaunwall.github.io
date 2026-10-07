import test from "node:test";
import assert from "node:assert/strict";
import { toBlocks, normalize, splitSentences } from "./normalize-cv.mjs";

const DANSKE =
  "We lead architecture for Acme Core, the large programme building the next platform: cloud-native and event-driven. I sit on the leadership team and own direction for two domains.   " +
  "– Led the redesign behind the move to Team Topologies: two value streams and a platform team. Outcome: e.g. fewer dependencies, shorter lead time – Member of the leadership team alongside delivery leads  " +
  "– Line manager for 10–12 architects in Denmark  – Built the architecture guild  – Wrote the decision log  – Hosted the monthly forum  " +
  "Stack: .NET, Azure, Kafka.  Internal title: Head of Things";

test("Danske shape: p + ul(6) + facts(2), Outcome stays inline", () => {
  const { blocks, facts } = toBlocks(DANSKE);
  assert.deepEqual(blocks.map((b) => b.type), ["p", "ul"]);
  assert.equal(blocks[1].items.length, 6);
  assert.ok(blocks[1].items[0].includes("Outcome: e.g. fewer dependencies"));
  assert.deepEqual(facts, [
    { label: "Stack", text: ".NET, Azure, Kafka" },
    { label: "Internal title", text: "Head of Things" },
  ]);
});

test("number ranges are not split", () => {
  const { blocks } = toBlocks("Intro  – Manage 10–12 architects  – Another one");
  assert.equal(blocks[1].items[0], "Manage 10–12 architects");
});

test("prose with spaced dash but no multi-space markers stays one paragraph", () => {
  const { blocks } = toBlocks("We chose X – It worked well for us.");
  assert.deepEqual(blocks, [{ type: "p", text: "We chose X – It worked well for us." }]);
});

test("in list mode ' – lowercase' is not split", () => {
  const { blocks } = toBlocks("Intro  – First thing – and then more  – Second – Third");
  assert.deepEqual(blocks[1].items, ["First thing – and then more", "Second", "Third"]);
});

test("real newlines with bullet markers", () => {
  const { blocks } = toBlocks("Lead line\n• One\n• Two\n- Three\n* Four\n\nClosing paragraph");
  assert.deepEqual(blocks.map((b) => b.type), ["p", "ul", "p"]);
  assert.deepEqual(blocks[1].items, ["One", "Two", "Three", "Four"]);
  assert.equal(blocks[2].text, "Closing paragraph");
});

test("Scope: mid-paragraph stays inline", () => {
  const { blocks, facts } = toBlocks("Ran the team.  Scope: three countries and two products.");
  assert.equal(facts.length, 0);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].text, "Scope: three countries and two products.");
  const one = toBlocks("Delivery lead. Scope: three countries. Stack: not a fact here");
  assert.equal(one.facts.length, 0);
  assert.equal(one.blocks.length, 1);
});

test("empty input and CRLF/NBSP", () => {
  assert.deepEqual(toBlocks(""), { blocks: [], facts: [] });
  assert.deepEqual(toBlocks(undefined), { blocks: [], facts: [] });
  const { blocks } = toBlocks("A line\r\n- item\r\n- item two");
  assert.equal(blocks[0].text, "A line");
  assert.equal(blocks[1].items.length, 2);
});

test("apostrophes curl", () => {
  const { blocks } = toBlocks("The bank's plan and the teams' goals, don't stop.");
  assert.equal(blocks[0].text, "The bank’s plan and the teams’ goals, don’t stop.");
});

test("sentence split respects abbreviations, .NET and LEGO.com", () => {
  assert.deepEqual(splitSentences("Use patterns, e.g. Danske style. Next we ship."), [
    "Use patterns, e.g. Danske style.",
    "Next we ship.",
  ]);
  assert.deepEqual(splitSentences("We run .NET services. Then LEGO.com moved. Done."), [
    "We run .NET services.",
    "Then LEGO.com moved.",
    "Done.",
  ]);
});

const CV = () => ({
  intro: {
    firstName: "Ada",
    lastName: "Synthetic",
    headline: "Leader | Facet one about things | ex-Acme | Facet three",
    about: "First sentence here. Second sentence follows. Third one.  Next I would like to build things.",
  },
  experience: [
    { companyName: "Acme Corp", title: "Head of Stuff", startedOn: "Mar 2024", description: DANSKE, location: "Aarhus" },
    { companyName: "LEGO Group", title: "Platform Advisor (consultant)", startedOn: "Sep 2018", finishedOn: "Feb 2021" },
    { companyName: "Champagne_Moments", title: "Investor & Advisory Board", startedOn: "Aug 2017", finishedOn: "Aug 2017" },
    { companyName: "Acme Corp", title: "Earlier role", startedOn: "Mar 2024", finishedOn: "Mar 2024" },
    { companyName: "School", title: "Educator", startedOn: "Jun 2002", finishedOn: "Jun 2011" },
  ],
  projects: [
    { title: "Old thing - the first one", startedOn: "Feb 2023", finishedOn: "Feb 2023" },
    { title: "Undated" },
    { title: "Newer – a subtitle here", startedOn: "Jun 2025", finishedOn: "Sep 2025" },
  ],
  education: [{ schoolName: "Uni", degreeName: "MSc", startDate: "2004", endDate: "2006", activities: "Chair of council" }],
  publications: [{ name: "Post", publisher: "Medium", publishedOn: "Mar 1, 2026" }],
  languages: [
    { name: "English", proficiency: "Full professional proficiency" },
    { name: "French", proficiency: "Elementary proficiency" },
    { name: "Danish", proficiency: "Native or bilingual proficiency" },
  ],
  skills: Array.from({ length: 15 }, (_, i) => ({ name: `Skill ${i}` })),
});

test("headline split into tagline and facets; no pipe -> tagline only", () => {
  const n = normalize(CV());
  assert.equal(n.intro.tagline, "Leader");
  assert.deepEqual(n.intro.facets, ["Facet one about things", "ex-Acme", "Facet three"]);
  const c = CV();
  c.intro.headline = "Just a tagline";
  const m = normalize(c);
  assert.equal(m.intro.tagline, "Just a tagline");
  assert.deepEqual(m.intro.facets, []);
});

test("date ranges: same month collapses, Present, day dropped, ids unique", () => {
  const n = normalize(CV());
  const [a, b, c, d] = n.experience;
  assert.equal(a.when.label, "Mar 2024 – Present");
  assert.equal(a.when.years, "2024 – Present");
  assert.equal(a.current, true);
  assert.equal(c.when.label, "Aug 2017");
  assert.equal(d.when.label, "Mar 2024");
  assert.equal(n.projects.find((p) => p.name === "Old thing").when.label, "Feb 2023");
  assert.equal(n.publications[0].when.label, "Mar 2026");
  assert.equal(n.education[0].when.label, "2004 – " + "2006");
  assert.equal(b.when.years, "2018 – 2021");
  assert.equal(new Set(n.experience.map((e) => e.id)).size, n.experience.length);
  assert.equal(a.id, "acme-corp-2024-03");
  assert.equal(d.id, "acme-corp-2024-03-2");
});

test("company names, side roles, projects, languages", () => {
  const n = normalize(CV());
  assert.deepEqual(n.experience.map((e) => e.kind), ["main", "main", "side", "main", "side"]);
  assert.equal(n.experience[1].company, "the LEGO Group");
  assert.equal(n.experience[2].company, "Champagne Moments");
  assert.deepEqual(n.projects.map((p) => p.name), ["Newer", "Old thing", "Undated"]);
  assert.equal(n.projects[0].subtitle, "a subtitle here");
  assert.deepEqual(n.languages.map((l) => [l.name, l.levelShort, l.rank]), [
    ["Danish", "Native", 5],
    ["English", "Full professional", 4],
    ["French", "Elementary", 1],
  ]);
});

test("summary, lead and onepage", () => {
  const n = normalize(CV(), { onepage: { highlights: { "Acme Corp|Mar 2024": [0, 2] }, skills: 5 } });
  assert.equal(n.intro.summary.length, 2);
  assert.equal(n.intro.summary[0], "First sentence here. Second sentence follows.");
  assert.equal(n.intro.summary[1], "Next I would like to build things.");
  assert.ok(n.experience[0].lead.startsWith("We lead architecture for Acme Core"));
  const roles = n.onepage.roles;
  assert.deepEqual(roles.map((r) => r.detailed), [true, true, false]);
  assert.equal(roles[0].highlights.length, 2);
  assert.equal(roles[0].highlights[1], n.experience[0].blocks[1].items[2]);
  assert.equal(roles[1].highlights.length, 0);
  assert.equal(n.onepage.skills.length, 5);
  assert.equal(n.onepage.projects.length, 3);
});

test("raw fields are never modified", () => {
  const raw = CV();
  const n = normalize(raw);
  assert.equal(n.experience[0].description, raw.experience[0].description);
  assert.equal(n.intro.headline, raw.intro.headline);
  assert.equal(n.normalized.version, 1);
});

test("idempotent: normalising twice equals once", () => {
  const once = normalize(CV());
  assert.deepEqual(normalize(once), once);
  assert.equal(JSON.stringify(normalize(once)), JSON.stringify(once));
});

test("every free-text section is structured into paragraphs and lists", () => {
  const T = "Intro sentence.  Second paragraph.  – Item one  – Item two  Stack: A, B";
  const cv = {
    intro: { firstName: "A", lastName: "B", headline: "H", about: T },
    experience: [{ companyName: "X", title: "T", startedOn: "Jan 2020", description: T }],
    education: [{ schoolName: "S", degreeName: "D", startDate: "2010", endDate: "2012", notes: T, activities: T }],
    projects: [{ title: "P", startedOn: "Jan 2021", description: T }],
    publications: [{ name: "Pub", publishedOn: "Mar 1, 2026", description: T }],
    certifications: [{ name: "C", startedOn: "Jan 2020", description: T }],
    volunteering: [{ role: "V", startedOn: "Jan 2020", description: T }],
    honors: [{ title: "H", issuedOn: "Mar 2021", description: T }],
    courses: [{ name: "Co", description: T }],
    organizations: [{ name: "O", startedOn: "2018", description: T }],
  };
  const out = normalize(cv);
  const ok = (blocks, where) => {
    assert.ok(blocks && blocks.length >= 2, where + ": expected several blocks");
    assert.ok(blocks.some((b) => b.type === "ul" && b.items.length === 2), where + ": expected a 2-item list");
  };
  ok(out.intro.aboutBlocks, "about");
  for (const k of ["experience", "education", "projects", "publications", "certifications", "volunteering", "honors", "courses", "organizations"]) {
    ok(out[k][0].blocks, k);
    assert.ok(out[k][0].facts.length >= 1, k + ": expected a Stack fact");
  }
});
