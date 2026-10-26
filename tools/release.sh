#!/usr/bin/env bash
# Bump the version, commit, tag, and push to Forgejo (origin) and GitHub (github).
# GitHub Actions then builds the release that Foundry updates from.
# Usage: tools/release.sh <version> "<what changed>"
set -euo pipefail
cd "$(dirname "$0")/.."

version="${1:?usage: tools/release.sh <version> \"<what changed>\"}"
summary="${2:?usage: tools/release.sh <version> \"<what changed>\"}"
repo="https://github.com/N0-Chance/proximity-voice-chat"

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must look like 1.2.3" >&2; exit 1; }
git rev-parse -q --verify "refs/tags/v$version" >/dev/null && { echo "tag v$version already exists" >&2; exit 1; }

sed -i "s/^const SCRIPT_VERSION = \"[^\"]*\";/const SCRIPT_VERSION = \"$version\";/" scripts/proximity-voice-chat.js
grep -q "^const SCRIPT_VERSION = \"$version\";" scripts/proximity-voice-chat.js || { echo "failed to set SCRIPT_VERSION" >&2; exit 1; }

tmp=$(mktemp)
jq --arg v "$version" --arg d "$repo/releases/download/v$version/module.zip" \
  '.version = $v | .download = $d' module.json > "$tmp"
mv "$tmp" module.json

node --check scripts/proximity-voice-chat.js
node test/smoke.mjs | tail -1
node test/peers.mjs | tail -1

git add -A
git commit -m "$version: $summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag -a "v$version" -m "v$version"

export GIT_TERMINAL_PROMPT=0
git push origin HEAD:main "v$version"
git push github HEAD:main "v$version"
echo "Pushed v$version. Release: $repo/releases/tag/v$version"
