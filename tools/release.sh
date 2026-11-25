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
sed -i "s/^export const UI_SCRIPT_VERSION = \"[^\"]*\";/export const UI_SCRIPT_VERSION = \"$version\";/" scripts/voice-ui.js
grep -q "^export const UI_SCRIPT_VERSION = \"$version\";" scripts/voice-ui.js || { echo "failed to set UI_SCRIPT_VERSION" >&2; exit 1; }
sed -i "s/^export const DIAG_SCRIPT_VERSION = \"[^\"]*\";/export const DIAG_SCRIPT_VERSION = \"$version\";/" scripts/diagnostics.js
grep -q "^export const DIAG_SCRIPT_VERSION = \"$version\";" scripts/diagnostics.js || { echo "failed to set DIAG_SCRIPT_VERSION" >&2; exit 1; }
sed -i "s/^export const AUDIO_SCRIPT_VERSION = \"[^\"]*\";/export const AUDIO_SCRIPT_VERSION = \"$version\";/" scripts/voice-audio.js
grep -q "^export const AUDIO_SCRIPT_VERSION = \"$version\";" scripts/voice-audio.js || { echo "failed to set AUDIO_SCRIPT_VERSION" >&2; exit 1; }
sed -i "s/^export const PROPAGATION_SCRIPT_VERSION = \"[^\"]*\";/export const PROPAGATION_SCRIPT_VERSION = \"$version\";/" scripts/voice-propagation.js
grep -q "^export const PROPAGATION_SCRIPT_VERSION = \"$version\";" scripts/voice-propagation.js || { echo "failed to set PROPAGATION_SCRIPT_VERSION" >&2; exit 1; }
sed -i "s/^export const INPUT_SCRIPT_VERSION = \"[^\"]*\";/export const INPUT_SCRIPT_VERSION = \"$version\";/" scripts/voice-input.js
grep -q "^export const INPUT_SCRIPT_VERSION = \"$version\";" scripts/voice-input.js || { echo "failed to set INPUT_SCRIPT_VERSION" >&2; exit 1; }
sed -i "s/^export const WORKLET_SCRIPT_VERSION = \"[^\"]*\";/export const WORKLET_SCRIPT_VERSION = \"$version\";/" scripts/voice-input-worklet.js
grep -q "^export const WORKLET_SCRIPT_VERSION = \"$version\";" scripts/voice-input-worklet.js || { echo "failed to set WORKLET_SCRIPT_VERSION" >&2; exit 1; }

tmp=$(mktemp)
jq --arg v "$version" --arg d "$repo/releases/download/v$version/module.zip" \
  '.version = $v | .download = $d' module.json > "$tmp"
mv "$tmp" module.json

node --check scripts/proximity-voice-chat.js
node test/smoke.mjs | tail -1
node test/peers.mjs | tail -1
node test/ui.mjs | tail -1
node test/propagation.mjs | tail -1
node test/audio.mjs | tail -1
node test/input.mjs | tail -1

git add -A
git commit -m "$version: $summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git tag -a "v$version" -m "v$version"

export GIT_TERMINAL_PROMPT=0
git push origin HEAD:main "v$version"
git push github HEAD:main "v$version"
echo "Pushed v$version. Release: $repo/releases/tag/v$version"
