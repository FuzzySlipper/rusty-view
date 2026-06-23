#!/usr/bin/env bash
# Build the rusty-view debug-chat app and copy it to the rusty-crew static site directory.
# Usage: ./scripts/deploy-local.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="/home/agents/rusty-crew/site"

echo "Building debug-chat..."
cd "$REPO_ROOT"
pnpm exec nx build debug-chat

echo "Cleaning $DEST_DIR..."
rm -rf "$DEST_DIR"/*

echo "Copying build output..."
cp -r dist/apps/debug-chat/browser/* "$DEST_DIR"/

echo "Done. $(find "$DEST_DIR" -type f | wc -l) files deployed to $DEST_DIR"
