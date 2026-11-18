#!/usr/bin/env bash
# Copies app/ to dist/ and stamps the git sha into the meta tag and footer (R6).
set -euo pipefail
cd "$(dirname "$0")"
sha=$(git rev-parse HEAD)
rm -rf dist && cp -r app dist
sed -i "s/__BUILD_SHA__/$sha/g" dist/index.html
echo "built $sha"
