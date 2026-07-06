#!/usr/bin/env bash
# Build the rusty-view app and copy it to both local rusty-crew static site
# directories.
# Usage: ./scripts/deploy-local.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIRS=(
  "/home/system/rusty-crew/site"
  "/home/system/rusty-crew-debug/site"
)

echo "Building rusty-view..."
cd "$REPO_ROOT"
pnpm exec nx build rusty-view
node tools/fix-package-esm-specifiers.mjs --write

for dest_dir in "${DEST_DIRS[@]}"; do
  echo "Cleaning $dest_dir..."
  mkdir -p "$dest_dir"
  rm -rf "$dest_dir"/*

  echo "Copying build output to $dest_dir..."
  cp -r dist/apps/rusty-view/browser/* "$dest_dir"/

  echo "Done. $(find "$dest_dir" -type f | wc -l) files deployed to $dest_dir"
done
