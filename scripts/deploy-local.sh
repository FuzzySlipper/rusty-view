#!/usr/bin/env bash
# Build the rusty-view app and copy it to both local rusty-crew static site
# directories.
# Usage: ./scripts/deploy-local.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEPLOYMENTS=(
  "/home/system/rusty-crew/site|production"
  "/home/system/rusty-crew-debug/site|debug"
)

echo "Building rusty-view..."
cd "$REPO_ROOT"
pnpm exec nx build rusty-view
node tools/fix-package-esm-specifiers.mjs --write

for deployment in "${DEPLOYMENTS[@]}"; do
  IFS='|' read -r dest_dir coordination_role <<< "$deployment"
  echo "Cleaning $dest_dir..."
  mkdir -p "$dest_dir"
  rm -rf "$dest_dir"/*

  echo "Copying build output to $dest_dir..."
  cp -r dist/apps/rusty-view/browser/* "$dest_dir"/
  install -m 0644 \
    "$REPO_ROOT/scripts/deploy-config/rusty-view-config.$coordination_role.js" \
    "$dest_dir/rusty-view-config.js"

  echo "Done. $(find "$dest_dir" -type f | wc -l) files deployed to $dest_dir ($coordination_role coordination)"
done
