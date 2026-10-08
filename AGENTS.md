# AGENTS.md

Everything a contributor (human or agent) needs to work on this repo. The public-facing summary is in `README.md`.

## What this is

A static CV site for https://larsbaunwall.github.io/ (a GitHub user-pages repo, served at the root). Hugo renders it from LinkedIn data fetched at build time with [`@larsbaunwall/unlinked`](https://www.npmjs.com/package/@larsbaunwall/unlinked). The layout is typography-led: white paper, near-black ink, hairline rules, Inter and Source Serif 4, no accent colour, no JavaScript, no external requests. Two PDFs (full and one-page) are rendered from dedicated print pages with Playwright and Chromium during the publish workflow.

Data flow:

```
LINKEDIN_TOKEN (.env locally, Actions secret in CI)
  -> scripts/fetch-cv.sh  (unlinked profile --sections ... --no-cache)
  -> data/cv.json         (gitignored; raw LinkedIn data)
  -> scripts/normalize-cv.mjs  (adds derived fields beside raw ones)
  -> hugo --minify        (layouts read site.Data.cv)  -> public/
  -> scripts/render-pdf.mjs    (renders /print/full/ and /print/onepage/) -> public/*.pdf
  -> GitHub Pages
```

## Ground rules

- **Never read, print, log or commit `.env`.** It holds the LinkedIn token. The fetch script parses it as plain text (it is never executed or sourced). Never use `set -x` or echo environment variables in scripts or workflows.
- **`data/cv.json` is real personal data and is gitignored.** Never commit it. Unit tests and fixtures use synthetic data only (`scripts/fixtures/cv.sample.json`, "Ada Synthetic").
- Before running `npm run fetch:sample` over real data, back up `data/cv.json` and restore it afterwards (then `npm run normalize`).
- Don't edit raw LinkedIn fields in the normaliser; derived fields only.
- Don't use `safeHTML` or `markdownify` on CV text. Go template auto-escaping is the only escaping. (`safeHTML` is used only on already-rendered partial output and hard-coded labels.)
- Always use root-relative asset URLs (`.RelPermalink`), so the PDF renderer loads assets from its local server and not from the live site.

## Prerequisites and setup

- Hugo 0.167 extended (CI pins `0.167.0`).
- Node 26 (`.nvmrc`, `engines`; CI reads `.nvmrc`).

```bash
npm install
npx playwright install chromium   # one time, for local PDF rendering
cp .env.example .env              # then put your LinkedIn token in .env
```

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run fetch` | Fetch the CV from LinkedIn into `data/cv.json` (reads `.env`), then normalise |
| `npm run fetch:sample` | Copy the synthetic fixture to `data/cv.json` (no token needed), then normalise |
| `npm run normalize` | Re-run the normaliser on `data/cv.json` in place (idempotent) |
| `npm test` | Unit tests for the normaliser (`node --test scripts/*.test.mjs`) |
| `npm run dev` | `hugo server` with live reload |
| `npm run build` | `hugo --minify` into `public/` |
| `npm run pdf` | Render both PDFs from `public/` |
| `npm run shoot -- <dir>` | Screenshot the built site at 375, 768, 1280 and 1920 px (plus one full-page shot at 1280) into `<dir>` |
| `npm run all` | fetch, build, pdf |

`scripts/render-pdf.mjs` and `scripts/shoot.mjs` read `PUBLIC_DIR` (default `public`) if you want to point them at another build.

## Fetching from LinkedIn

`scripts/fetch-cv.sh` runs `unlinked profile --sections intro,experience,education,skills,certifications,projects,languages,volunteering,honors,publications,courses,organizations --no-cache`. Recommendations are deliberately excluded (text written by other people).

- **Always fresh:** `--no-cache` neither reads nor writes unlinked's disk cache, and the script also exports `UNLINKED_CACHE_TTL=0`. (`--refresh` would ignore the cache but still write it; it is not needed.)
- **Recent edits are included:** unlinked merges LinkedIn's last 28 days of changes into the export. The output's `freshness` block reports `asOf`, `recentChangesMerged`, `pendingEdits` (sections with edits the export does not show yet) and `empty` sections.
- **Guards:** the script fails (and writes no data) if `intro` has no name or if `experience` or `skills` is empty. LinkedIn can return a section empty while it is still preparing the export (up to 24 hours after consent), and a CV that silently lost its experience must not be published. It prints a `::warning::` if `pendingEdits` is non-empty and lists empty sections.
- **Rate limits (important):** LinkedIn limits the changelog call per application and member per day. Every `unlinked profile` call (and so every push-triggered CI run and every local `npm run fetch`) uses some of that quota. When it is exhausted, unlinked still exits 0 but returns the older export without the last 28 days of edits and sets `freshness.recentChangesError` and `recentChangesMerged: 0`. The script treats that as a failure (nothing is written) so a stale CV is never published silently; set `ALLOW_STALE_CV=1` to accept it locally. The quota resets daily, so re-run later. Avoid ad-hoc `unlinked activity` calls and bursts of pushes.
- **What unlinked can merge:** recent edits to the intro (headline, About, name) and to posts, comments and reactions are merged from the changelog. Edits to profile sections (experience, projects, skills, ...) cannot be merged because LinkedIn rows have no ids; they only appear once LinkedIn's snapshot export catches up, and unlinked lists such sections in `freshness.pendingEdits` (the script warns). Removals of entries are not flagged at all, so a deleted project can linger until the snapshot refreshes.
- **Local testing: use a short cache, not fresh fetches.** Don't run `npm run fetch` repeatedly while iterating on styling or templates; every call spends LinkedIn quota. Fetch once, then reuse `data/cv.json` (or `npm run fetch:sample`) and rebuild with `npm run build`. If you must run `unlinked` locally, use a short cache (e.g. `UNLINKED_CACHE_TTL=3600`, and drop `--no-cache`) so repeat runs are served from disk. `--no-cache` and `UNLINKED_CACHE_TTL=0` are for CI only.
- **Output is limited to counts and freshness:** it never prints CV contents or the token. unlinked's own errors are JSON on stderr (exit 1 for LinkedIn or token problems, 2 for usage errors).
- `@larsbaunwall/unlinked` is pinned to an exact version in `package.json` so the pipeline cannot change silently.

Not available from LinkedIn's API: profile photo, banner, Featured and contact info. Contact links therefore come from `hugo.toml` (below) and the portrait is a local file.

### Token

The token is a LinkedIn Member Data Portability access token, generated by the member in the LinkedIn Developer Portal OAuth Token Generator (scope `r_dma_portability_self_serve`). The API works for members in the EEA and Switzerland only. Microsoft's documentation does not state a lifetime for these tokens, so don't assume one: in practice, if the token is revoked or stops working, the scheduled run fails at the fetch step with unlinked's error and the live site is left untouched (deploy never runs). Generate a new token and update the `LINKEDIN_TOKEN` repository secret (and `.env` locally) to recover. `npx unlinked status` shows whether LinkedIn is sharing recent changes with the app.

## Data and the normaliser

LinkedIn exports flatten line breaks into runs of spaces, join bullets with en dashes and append "Stack:" or "Internal title:" tails to prose. `scripts/normalize-cv.mjs` rewrites `data/cv.json` in place and adds derived fields next to the raw ones. Raw fields are never modified, derived fields are recomputed on every run (so it is idempotent), and the file gets `"normalized": {"version": 1}`. Templates only present data; every heuristic lives in the normaliser. In production builds the templates fail if `normalized` is missing; in dev they show "CV data not normalised: run npm run normalize".

Rules:

- **Blocks:** descriptions become paragraphs (`p`), bullet lists (`ul`) and facts (`Stack`, `Tech stack`, `Technologies`, `Tools`, `Internal title`, shown as a small label list under the entry). "Scope:" and "Outcome:" stay inline.
- **Line splitting:** on real newlines if present, otherwise on runs of two or more spaces. Lines starting with a bullet marker (`•`, `-`, `*`, en or em dash) become list items. When the text has a multi-space dash marker (or newlines), list items containing a spaced dash before a capital letter or digit are split in two. Paragraphs are never split on dashes, so ranges like "10-12" stay intact.
- **Coverage:** every section with free text is structured: About, experience, education (notes and activities), projects, publications, certifications, volunteering, honors, courses and organizations. A regression test covers all of them.
- **Typography:** straight apostrophes inside words become curly; runs of spaces collapse. No words or full stops are added or removed.
- **Dates:** "Mar 2024 – Present" (thin spaces around the en dash); identical start and end collapse to one date; unparseable dates are kept as written.
- **Headline:** split on `|`. The first segment is the tagline, the rest become facets. No `|` means the whole headline is the tagline.
- **Roles:** `main` or `side`. Side roles (title matches advisory, investor, board or educator, unless overridden) go under "Other roles" in a compact style and are left out of the one-page PDF.
- **Projects** are sorted by start date, newest first, and the title is split into name and subtitle at the first spaced dash. **Languages** are sorted by proficiency.
- **`intro.summary`** is the first two sentences of About (plus a short closing paragraph if there is one), unless overridden. Nothing is invented; there is no LLM or generative step anywhere in the pipeline.

So: **add line breaks and bullets on LinkedIn; they are honoured.**

Derived fields used by templates: `intro.{name,tagline,facets,aboutBlocks,summary}`; per item `id`, `company`, `kind`, `current`, `when.{label,years,startIso}`, `blocks`, `facts`, `lead` (experience), `name`/`subtitle` (projects), `levelShort`/`rank` (languages); and `onepage.{roles,projects,skills}`.

### `cv.overrides.json`

Committed, at the repo root. Every field is optional.

| Field | Meaning |
| --- | --- |
| `companyNames` | Map of raw LinkedIn company name to display name, e.g. `"LEGO Group": "the LEGO Group"` |
| `sideRoles` | List of raw company names to treat as side roles; `null` uses the title heuristic |
| `summary` | Array of strings to use as the one-page summary instead of deriving it |
| `onepage.detailedRoles` | How many of the first main roles get a lead sentence and highlights (default 2) |
| `onepage.maxRoles` | Maximum main roles on the one-pager (default 8) |
| `onepage.maxHighlights` | Highlights per detailed role when not set explicitly (default 3) |
| `onepage.skills` | Number of skills in the one-pager rail (default 12) |
| `onepage.projects` | Number of selected projects (default 3) |
| `onepage.highlights` | Map of `"<raw company>|<raw startedOn>"` to indices into that role's first bullet list |

## Layout

- Templates: `layouts/baseof.html`, `layouts/home.html`, partials in `layouts/_partials/cv/` (shared by the home page and the full PDF) and `layouts/_partials/print/`.
- CSS: `assets/css/base.css` (tokens, fonts, globals), `screen.css` (screen layout, wrapped in `@media screen`), `print.css` (both PDFs, plus a fallback so printing the home page with Cmd+P is reasonable).
- `cv/masthead.html` and `cv/sections.html` take `dict "cv" $cv "media" "print"` so the print pages can reuse them.
- Print pages (`content/print/*.md`, `layouts/print/*.html`) are standalone templates with their own head partial (`print/head.html`), so `screen.css` never leaks into them. They are `noindex` and excluded from the sitemap. `@page` rules are inline `<style>` blocks in the templates because they carry dynamic text.
- **Dark theme:** CSS-only, follows the system setting (`prefers-color-scheme`), no toggle (the site has no JavaScript). The tokens are overridden at the end of `screen.css` inside `@media screen and (prefers-color-scheme: dark)`, so the PDFs and print pages always stay on white paper. Dark palette: paper `#0F0F0F`, ink `#ECECEA` (16.2:1), secondary `#A3A3A0` (7.6:1), the portrait is dimmed slightly, and the favicon adapts. Use the colour tokens, never hard-coded colours, in screen styles.
- The footer (`cv/colophon.html`, screen only) shows the update date and discreet links to unlinked and this repository. Keep it quiet; it is the intended place to credit unlinked.
- Hyphenation is manual except below 30rem; hyphen-joined tokens containing a digit (e.g. "200-engineer") are wrapped in `.nb` so they never break; define `.nb` in print CSS too.

### Configuration (`hugo.toml`)

`[[params.links]]` (LinkedIn and GitHub, each can carry a `display` text; the URLs are placeholders, confirm them), `params.email` (empty by default; set it to show an email address on the page and PDFs), `[params.pdf]` (the two PDF file names), `[imaging]` (Lanczos; per-format quality under `[imaging.jpeg]` and `[imaging.webp]`), locale `en-GB`, and the font mounts under `[module]`.

### Portrait

Put the original photo at `assets/profile.png` (gitignored, so the large original stays local) and create the committed `assets/profile.jpg` from it:

```bash
sips -s format jpeg -s formatOptions 92 assets/profile.png --out assets/profile.jpg
```

Hugo crops it to 4:5, converts it to grayscale with slightly raised contrast, and emits WebP at 320, 480 and 640 px for the screen and a single JPEG for the PDFs. If neither file exists the portrait is omitted.

### Fonts

Self-hosted from npm (`@fontsource-variable/source-serif-4`, `@fontsource-variable/inter`) and mounted by Hugo at `/fonts/source-serif-4/` and `/fonts/inter/`. File names follow `<family>-<subset>-<variant>-<style>.woff2` with subsets `latin` and `latin-ext`, and variants `wght` (weight axis only), `opsz` (weight plus optical size) and `standard` (all axes). Currently used: Source Serif 4 `wght` roman and italic (`font-weight: 200 900`), Inter `latin-opsz-normal` (optical size gives Inter Display shapes at the large name size) and Inter latin-ext `wght` (`100 900`), with `unicode-range` splitting latin and latin-ext. List the directory under `node_modules/@fontsource-variable/*/files` for the full set.

## PDFs

Both PDFs are rendered from real Hugo pages:

| Page | Output | Content |
| --- | --- | --- |
| `/print/full/` | `lars-baunwall-cv.pdf` | The full CV, normally 2 to 4 A4 pages, "n / N" page numbers in the footer |
| `/print/onepage/` | `lars-baunwall-cv-onepage.pdf` | One A4 page: portrait, contact, languages, education, skills, main roles, selected projects; footer shows the update month and the site address, no page counter |

The home page links to both. Footers are CSS `@page` margin boxes using the page's own web fonts, not Chromium header/footer templates.

`npm run pdf` (`scripts/render-pdf.mjs`) serves `public/` locally and, for each page, emulates print media with reduced motion, waits for fonts and asserts that Source Serif 4 and Inter loaded. Checks:

- Any request to a host other than the local server (or a `data:` URL) fails the run.
- The PDF must start with `%PDF-`, embed only subset fonts, include Source Serif 4 and Inter, and contain no fallback fonts (Times, Helvetica, Arial, DejaVu, Liberation).
- Size ceilings: 600 KB (full) and 400 KB (one-pager).
- **Full CV:** rendered at 100% and then at 98.5%, 97%, 95.5% and 94%; the largest scale giving the fewest pages is kept. This absorbs small layout differences between machines (the Linux CI Chromium once pushed one line onto an otherwise empty fifth page that the Mac build did not have). 2 to 4 pages passes, up to 6 passes with a `::warning::`, more than 6 (or 0) fails. If the CV genuinely grows by a page or more, expect an extra page.
- **One-pager:** must be exactly 1 page. All its sizes are multiplied by `--op-scale`, so the script tries 1, 0.97, 0.94 and 0.91 and uses the first that fits, then Chromium's PDF `scale` of 0.96, 0.92 and 0.88. If none fits it fails with "One-pager overflows"; reduce what goes on it in `cv.overrides.json` (`onepage.skills`, `onepage.maxRoles`, `onepage.maxHighlights`, or set `onepage.highlights` and `onepage.detailedRoles`) and rebuild.
- The chosen scale and size are logged, e.g. `full: 4 pages, 304 KB, scale 0.985`.

PDFs contain a creation timestamp, so they are not byte-identical between runs; everything else is deterministic for a given CV (Hugo output, the normaliser and image processing are reproducible).

## Deployment

`.github/workflows/deploy.yml` builds and deploys on every push to `main`, manually (`workflow_dispatch`), and every day at 00:00 UTC (GitHub cron is UTC-only). The runner is pinned to `ubuntu-24.04` (not `ubuntu-latest`) for reproducibility.

Build steps: checkout, setup-node (from `.nvmrc`), `npm ci`, `npm test`, fetch (the only step that receives `LINKEDIN_TOKEN`; it also normalises), setup Hugo (`HUGO_VERSION` in the workflow env), configure-pages, `hugo --minify --gc --baseURL <pages url>`, `npx playwright install --with-deps chromium`, `npm run pdf`, output checks (both PDFs non-empty and starting with `%PDF-`, `noindex` present on the one-page print page), upload artifact, deploy.

A `keepalive` job runs only on the scheduled trigger and re-enables the workflow through the API (`actions: write`), because GitHub disables scheduled workflows after 60 days without repository activity.

Versions: Node, Hugo and the actions are pinned (actions by major tag); dependencies are locked by `package-lock.json` and `@larsbaunwall/unlinked` is an exact version. Bump them deliberately and check the workflow log.

One-time repository setup:

1. Settings, Secrets and variables, Actions: add secret `LINKEDIN_TOKEN`.
2. Settings, Pages, Source: **GitHub Actions**.

Failure modes: a failed scheduled run emails you and leaves the live site as it was. Causes include a revoked token, an empty core section (see Guards above), or a one-pager that no longer fits.

## Privacy

`data/cv.json` and `.env` are gitignored and never committed. The published HTML and PDFs are public by design and contain whatever is in the selected LinkedIn sections (and the portrait). Recommendations, connections and activity are not fetched. Print pages are `noindex`.

## Testing and verification tips

- `npm test` runs the normaliser tests (synthetic strings only). CI runs them before fetching.
- For visual checks, `npm run build && npm run pdf`, then rasterise the PDFs (e.g. PyMuPDF) and review every page. Check the Linux CI output too: layout can differ slightly from macOS.
- Check responsive layout with `npm run shoot -- <dir>`; no horizontal scroll at 375 px.
- After changing the pipeline, push and confirm the Actions run is green, then check the live pages and PDFs (page counts, fonts, `noindex`).
