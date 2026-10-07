# Lars Baunwall - CV site

A static CV built with Hugo and published to GitHub Pages at https://larsbaunwall.github.io/. The data comes from LinkedIn (via [`@larsbaunwall/unlinked`](https://www.npmjs.com/package/@larsbaunwall/unlinked)) at build time, is cleaned up by a deterministic normaliser, and is rendered as a typography-led page (white paper, near-black ink, hairline rules, Inter and Source Serif 4). Two PDFs are rendered from dedicated print pages with Playwright and Chromium. There is no JavaScript and there are no external requests.

## Prerequisites

- Hugo 0.167 extended
- Node 26+ (see `.nvmrc`)

```bash
npm install
npx playwright install chromium   # one time, for local PDF rendering
cp .env.example .env              # then put your LinkedIn token in .env
```

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run fetch` | Fetch the CV from LinkedIn into `data/cv.json` (reads `.env`), then normalise it |
| `npm run fetch:sample` | Copy the synthetic fixture to `data/cv.json` (no token needed), then normalise it |
| `npm run normalize` | Re-run the normaliser on `data/cv.json` in place (idempotent) |
| `npm test` | Unit tests for the normaliser (`node --test scripts/`) |
| `npm run dev` | `hugo server` with live reload |
| `npm run build` | `hugo --minify` into `public/` |
| `npm run pdf` | Render both PDFs from `public/` (see below) |
| `npm run shoot -- <dir>` | Screenshot the built site at 375, 768, 1280 and 1920 px (plus one full-page shot at 1280) into `<dir>` |
| `npm run all` | fetch, build, pdf |

`scripts/render-pdf.mjs` and `scripts/shoot.mjs` read the `PUBLIC_DIR` environment variable (default `public`) if you want to point them at another build.

## Data and the normaliser

LinkedIn exports flatten line breaks into runs of spaces, join bullets with en dashes and append "Stack:" or "Internal title:" tails to prose. `scripts/normalize-cv.mjs` rewrites `data/cv.json` in place and adds derived fields next to the raw ones; raw fields are never modified, derived fields are recomputed on every run (so it is idempotent), and the file gets `"normalized": {"version": 1}`. Templates only present the data; every heuristic lives in the normaliser. In production builds the templates fail if `normalized` is missing; in dev they show "CV data not normalised: run npm run normalize".

Rules, in short:

- Descriptions become blocks: paragraphs (`p`), bullet lists (`ul`) and facts (`Stack`, `Tech stack`, `Technologies`, `Tools`, `Internal title`, shown as a small label list under the entry). "Scope:" and "Outcome:" stay inline in the text.
- Lines are split on real newlines if present, otherwise on runs of two or more spaces. Lines starting with a bullet marker (`•`, `-`, `*`, en or em dash) become list items. When the text has a multi-space dash marker (or newlines), list items containing a spaced dash before a capital letter or digit are split into two. Paragraphs are never split on dashes, so ranges like "10-12" stay intact.
- Typography: straight apostrophes inside words become curly, runs of spaces collapse. No words or full stops are ever added or removed.
- Dates become "Mar 2024 – Present" (thin spaces around the en dash); identical start and end collapse to one date. Unparseable dates are kept as written.
- The headline is split on `|`: the first segment is the tagline, the rest become facets. No `|` means the whole headline is the tagline.
- Roles are `main` or `side`. Side roles (advisory, investor, board, educator by default) go under "Other roles" in a compact style and are left out of the one-page PDF.
- Projects are sorted by start date, newest first, and the title is split into name and subtitle at the first spaced dash.
- Languages are sorted by proficiency.
- `summary` is the first two sentences of the About text (plus a short closing paragraph if there is one), unless overridden. Nothing is invented.

Because of this, **add line breaks and bullets on LinkedIn; they are honoured.**

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

## PDFs

Both PDFs are rendered from real Hugo pages that are excluded from the sitemap and marked `noindex`:

| Page | Output | Content |
| --- | --- | --- |
| `/print/full/` | `lars-baunwall-cv.pdf` | The full CV, normally 2 to 4 A4 pages, with "n / N" page numbers in the footer |
| `/print/onepage/` | `lars-baunwall-cv-onepage.pdf` | A one-page A4 summary: portrait, contact, languages, education, skills, main roles, selected projects |

The home page links to both. Footers are CSS `@page` margin boxes using the page's own web fonts, not Chromium header/footer templates.

`npm run pdf` (`scripts/render-pdf.mjs`) serves `public/` locally and, for each page, emulates print media with reduced motion, waits for fonts and asserts that Source Serif 4 and Inter loaded. It then checks the result:

- Any request to a host other than the local server (or a `data:` URL) fails the run.
- The PDF must start with `%PDF-`, embed only subset fonts, include Source Serif 4 and Inter, and contain no fallback fonts (Times, Helvetica, Arial, DejaVu, Liberation).
- Size ceilings: 600 KB for the full CV, 400 KB for the one-pager.
- Full CV: 2 to 4 pages passes; other counts up to 6 pass with a `::warning::` annotation; more than 6 (or 0) fails.
- One-pager: must be exactly 1 page. All its sizes are multiplied by `--op-scale`, so the script tries 1, 0.97, 0.94 and 0.91 and uses the first that fits. If none does, it tries Chromium's PDF `scale` of 0.96, 0.92 and 0.88. The scale used is logged, for example `onepage: 1 page, 31 KB, scale 0.94`.

If the one-pager overflows the run fails with "One-pager overflows". Reduce what goes on it in `cv.overrides.json`: lower `onepage.skills`, `onepage.maxRoles` or `onepage.maxHighlights` (or set `onepage.highlights` and `onepage.detailedRoles`), then rebuild.

## Portrait

Put the original photo at `assets/profile.png` (gitignored, so the large original stays local) and create the committed `assets/profile.jpg` from it:

```bash
sips -s format jpeg -s formatOptions 92 assets/profile.png --out assets/profile.jpg
```

Hugo crops it to 4:5, converts it to grayscale with slightly raised contrast, and emits WebP at 320, 480 and 640 px wide for the screen and a single JPEG for the PDFs. If neither file exists the portrait is simply omitted.

## Deployment

`.github/workflows/deploy.yml` builds and deploys on every push to `main`, manually, and every Sunday at 23:00 UTC (GitHub cron is UTC-only). Steps: `npm ci`, `npm test`, fetch (which also normalises), Hugo build, Playwright install, `npm run pdf`, output checks (both PDFs non-empty and starting with `%PDF-`, `noindex` present on the print page), then upload and deploy.

One-time setup:

1. Repo Settings, Secrets and variables, Actions: add secret `LINKEDIN_TOKEN`.
2. Repo Settings, Pages, Source: **GitHub Actions**.

### Token expiry

LinkedIn member tokens last about 60 days and the API is available to EEA members only. When the token expires the scheduled run fails at the fetch step and the live site stays as it was. Rotate the secret to recover.

## Privacy

`data/cv.json` and `.env` are gitignored and never committed. Only the rendered HTML and PDFs are published. Tests use synthetic strings only.

## Configuration

`hugo.toml` holds the site settings: `[[params.links]]` (LinkedIn and GitHub, because the API returns no contact info; each can carry a `display` text), `params.email` (empty by default; set it to show an email address on the page and the PDFs), `[params.pdf]` (the two PDF file names) and `[imaging]`. Locale is `en-GB`. The URLs for the links are placeholders; please confirm them.

## Fonts

Self-hosted from npm (`@fontsource-variable/source-serif-4`, `@fontsource-variable/inter`) and mounted by Hugo (see `[module]` in `hugo.toml`) at `/fonts/source-serif-4/` and `/fonts/inter/`. Use latin and latin-ext subsets. Variants: `wght` = weight axis only; `opsz` = weight plus optical size axis; `standard` = static-width full variant.

Source Serif 4 (`/fonts/source-serif-4/`):

- source-serif-4-latin-wght-normal.woff2
- source-serif-4-latin-wght-italic.woff2
- source-serif-4-latin-ext-wght-normal.woff2
- source-serif-4-latin-ext-wght-italic.woff2
- source-serif-4-latin-opsz-normal.woff2 (opsz + wght)
- source-serif-4-latin-opsz-italic.woff2
- source-serif-4-latin-ext-opsz-normal.woff2
- source-serif-4-latin-ext-opsz-italic.woff2
- source-serif-4-latin-standard-normal.woff2 / -italic.woff2 and latin-ext equivalents (all axes)

Inter (`/fonts/inter/`):

- inter-latin-wght-normal.woff2
- inter-latin-ext-wght-normal.woff2
- inter-latin-wght-italic.woff2
- inter-latin-ext-wght-italic.woff2
- inter-latin-opsz-normal.woff2 (opsz + wght), inter-latin-ext-opsz-normal.woff2
- inter-latin-standard-normal.woff2 / -italic.woff2 and latin-ext equivalents

Recommended `@font-face`: use the `wght` files with `font-weight: 200 900` (serif) or `100 900` (Inter), with `unicode-range` split between latin and latin-ext.
