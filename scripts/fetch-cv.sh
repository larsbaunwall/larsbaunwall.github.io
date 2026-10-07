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

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

node_modules/.bin/unlinked profile --sections "$SECTIONS" --no-cache > "$tmp"

node -e '
const fs = require("fs");
const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!d.intro || typeof d.intro !== "object" || Array.isArray(d.intro)) { console.error("Invalid CV data: intro is not an object"); process.exit(1); }
if (!Array.isArray(d.experience)) { console.error("Invalid CV data: experience is not an array"); process.exit(1); }
const n = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
const asOf = d.freshness && d.freshness.asOf ? d.freshness.asOf : "unknown";
console.log(`CV fetched: ${n("experience")} positions, ${n("education")} education, ${n("skills")} skills (asOf ${asOf})`);
' "$tmp"

mkdir -p data
mv "$tmp" data/cv.json
node scripts/normalize-cv.mjs
