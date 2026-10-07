#!/usr/bin/env bash
# Fetch CV data from LinkedIn into data/cv.json. Never prints the token or CV contents.
set -euo pipefail

cd "$(dirname "$0")/.."

SECTIONS="intro,experience,education,skills,certifications,projects,languages,volunteering,honors,publications,courses,organizations"

if [[ "${1:-}" == "--sample" ]]; then
  mkdir -p data
  cp scripts/fixtures/cv.sample.json data/cv.json
  echo "Using sample CV data"
  node scripts/normalize-cv.mjs
  exit 0
fi

if [[ -z "${LINKEDIN_TOKEN:-}" && -f .env ]]; then
  # Parse as plain text (never executed): tolerates spaces around "=", quotes and CRLF.
  LINKEDIN_TOKEN="$(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?LINKEDIN_TOKEN[[:space:]]*[=:][[:space:]]*(.*)$/\2/p' .env | tail -n 1 | tr -d '\r' | sed -E "s/[[:space:]]+$//; s/^\"(.*)\"$/\1/; s/^'(.*)'\$/\1/")"
  export LINKEDIN_TOKEN
fi

if [[ -z "${LINKEDIN_TOKEN:-}" ]]; then
  printf "%s\n" "LINKEDIN_TOKEN is not set (add it to .env or use --sample)" >&2
  exit 1
fi
export LINKEDIN_TOKEN

# Always fetch fresh from LinkedIn: never read or write unlinked's disk cache.
# --no-cache skips the cache entirely; the TTL of 0 is belt and braces.
export UNLINKED_CACHE_TTL=0

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

node_modules/.bin/unlinked profile --sections "$SECTIONS" --no-cache > "$tmp"

node -e '
const fs = require("fs");
const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const fail = (m) => { console.error("Invalid CV data: " + m); process.exit(1); };
if (!d.intro || typeof d.intro !== "object" || Array.isArray(d.intro)) fail("intro is not an object");
if (!d.intro.firstName || !d.intro.lastName) fail("intro has no name");
const n = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
// LinkedIn may return a section empty while it is still preparing the export
// (up to 24h after consent). Refuse to publish a CV that lost its core sections.
for (const k of ["experience", "skills"]) if (n(k) === 0) fail(k + " is empty (LinkedIn may still be preparing the data)");
const f = d.freshness || {};
// If the changelog call fails (e.g. a daily rate limit), unlinked still exits 0 but returns the older
// export WITHOUT the last 28 days of edits (headline, About, ...). Never publish that silently.
if (f.recentChangesError && process.env.ALLOW_STALE_CV !== "1") {
  fail("LinkedIn could not provide recent changes, so edits from the last 28 days may be missing: " + f.recentChangesError + " (set ALLOW_STALE_CV=1 to accept the older export)");
}
console.log(`CV fetched: ${n("experience")} positions, ${n("education")} education, ${n("skills")} skills (asOf ${f.asOf || "unknown"}, ${f.recentChangesMerged ?? 0} recent changes merged)`);
const pending = Array.isArray(f.pendingEdits) ? f.pendingEdits : [];
if (pending.length) console.log(`::warning::LinkedIn has recent edits not yet in the export for: ${pending.join(", ")}`);
if (Array.isArray(f.empty) && f.empty.length) console.log(`Empty sections: ${f.empty.join(", ")}`);
' "$tmp"

mkdir -p data
mv "$tmp" data/cv.json
node scripts/normalize-cv.mjs
