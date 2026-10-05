#!/usr/bin/env bash
# Publish a management panel release to GitHub without GitHub Actions.
#
# Builds the single-file panel, tags the current main commit, and creates a GitHub
# release with management.html attached. CLIProxyAPI's panel updater downloads that
# asset from the latest release and verifies it against the SHA-256 digest GitHub
# records for it.
#
# Usage: scripts/release.sh vX.Y.Z-gremlinlabs.N
set -euo pipefail

REPO="gremlin-labs/Cli-Proxy-API-Management-Center-GLE"
TAG="${1:-}"

if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "usage: $0 vX.Y.Z[-suffix]  (e.g. v1.25.3-gremlinlabs.1)" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "main" ]]; then
  echo "release from main (current branch: $branch)" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree is not clean" >&2
  exit 1
fi
git fetch --quiet origin main
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo "main is not in sync with origin/main; push or pull first" >&2
  exit 1
fi
if git rev-parse --quiet --verify "refs/tags/$TAG" >/dev/null; then
  echo "tag $TAG already exists" >&2
  exit 1
fi

bun install --frozen-lockfile
bun run verify
VERSION="$TAG" bun run build

asset_dir="$(mktemp -d)"
trap 'rm -rf "$asset_dir"' EXIT
cp dist/index.html "$asset_dir/management.html"
sha256="$(shasum -a 256 "$asset_dir/management.html" | awk '{print $1}')"

previous="$(git describe --tags --abbrev=0 2>/dev/null || true)"
notes="$asset_dir/notes.md"
{
  echo "Management panel build for gremlinlabs CLIProxyAPI."
  echo
  echo "Asset: \`management.html\` (sha256 \`$sha256\`)"
  if [[ -n "$previous" ]]; then
    echo
    echo "Changes since $previous:"
    echo
    git log --no-merges --format='- %s' "$previous..HEAD"
  fi
} > "$notes"

git tag -a "$TAG" -m "Release $TAG"
git push --quiet origin "$TAG"
gh release create "$TAG" "$asset_dir/management.html" \
  --repo "$REPO" \
  --title "$TAG" \
  --notes-file "$notes" \
  --latest

echo "Released $TAG ($sha256)"
