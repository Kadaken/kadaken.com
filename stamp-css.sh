#!/usr/bin/env bash
# Cloudflare Pages ignores the Cache-Control we set on kadaken.css in _headers
# and serves it max-age=14400, while the HTML revalidates every time. That let
# a phone hold new markup with a four-hour-old stylesheet, which is how the
# screenshots rendered 1600px wide and ran off the right edge on 2026-08-07.
#
# A query string the browser has never seen is a different resource, so this
# stamps the CSS's own content hash onto every link to it. Change the CSS and
# the link changes with it; leave it alone and caching still works.
#
# Run after editing kadaken.css, before deploying.
set -euo pipefail
cd "$(dirname "$0")"
hash="$(sha256sum kadaken.css | cut -c1-10)"
for page in *.html; do
    sed -i -E "s|href=\"/kadaken\.css(\?v=[a-f0-9]+)?\"|href=\"/kadaken.css?v=$hash\"|g" "$page"
done
echo "stylesheet stamped: v=$hash"
grep -ho 'kadaken\.css?v=[a-f0-9]*' ./*.html | sort -u
