# Lars Baunwall - CV site

A static CV built with Hugo and published to GitHub Pages at https://larsbaunwall.github.io/. The data comes from LinkedIn (via [`@larsbaunwall/unlinked`](https://www.npmjs.com/package/@larsbaunwall/unlinked)) at build time. The same page is used on screen and for print, and a PDF (`lars-baunwall-cv.pdf`) is rendered from it with Playwright and Chromium. There is no JavaScript and there are no external requests.

## Prerequisites

- Hugo 0.163 extended
- Node 22+ (see `.nvmrc`)

```bash
npm install
npx playwright install chromium   # one time, for local PDF rendering
cp .env.example .env              # then put your LinkedIn token in .env
```

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run fetch` | Fetch the CV from LinkedIn into `data/cv.json` (reads `.env`) |
| `npm run fetch:sample` | Copy the synthetic fixture to `data/cv.json` (no token needed) |
| `npm run dev` | `hugo server` with live reload |
| `npm run build` | `hugo --minify` into `public/` |
| `npm run pdf` | Render `public/index.html` to `public/lars-baunwall-cv.pdf` |
| `npm run all` | fetch, build, pdf |

## Deployment

`.github/workflows/deploy.yml` builds and deploys on every push to `main`, manually, and weekly (Mondays 05:17 UTC).

One-time setup:

1. Repo Settings, Secrets and variables, Actions: add secret `LINKEDIN_TOKEN`.
2. Repo Settings, Pages, Source: **GitHub Actions**.

### Token expiry

LinkedIn member tokens last about 60 days and the API is available to EEA members only. When the token expires the scheduled run fails at the fetch step and the live site stays as it was. Rotate the secret to recover.

## Privacy

`data/cv.json` and `.env` are gitignored and never committed. Only the rendered HTML and PDF are published.

## Configuration

Contact links (LinkedIn, GitHub) come from `[[params.links]]` in `hugo.toml` because the API returns no contact info. The URLs there are placeholders; please confirm them.

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
