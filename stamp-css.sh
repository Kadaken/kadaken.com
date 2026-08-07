#!/usr/bin/env bash
# Cloudflare Pages ignores the Cache-Control we set on the stylesheet in
# _headers and serves it max-age=14400, while the HTML revalidates every time.
# That let a phone hold new markup with a four-hour-old stylesheet, which is
# how the screenshots rendered 1600px wide and ran off the right edge on
# 2026-08-07.
#
# A QUERY STRING DOES NOT FIX THIS. `?v=<hash>` defeats the browser cache but
# not Cloudflare's edge, which keyed the cached copy on the path alone and
# happily served the old bytes for `kadaken.css?v=<new hash>` — measured, not
# assumed. So the hash goes in the FILE NAME. A new name is a path the edge
# has never seen and cannot have a stale entry for.
#
# The HTML always revalidates (max-age=0, must-revalidate, confirmed against
# the live site), so a browser is never holding old markup that points at a
# name which no longer exists. `kadaken.css` is still written out anyway, as a
# safety net for anything that hardcodes it.
#
# Run after editing kadaken.css, before deploying. Safe to run twice.
set -euo pipefail
cd "$(dirname "$0")"

hash="$(sha256sum kadaken.css | cut -c1-10)"
name="kadaken.$hash.css"

# Drop stylesheets from earlier hashes so the folder does not silently grow.
for stale in kadaken.*.css; do
    [ "$stale" = "$name" ] && continue
    [ -e "$stale" ] || continue
    rm -f -- "$stale"
done
cp kadaken.css "$name"

for page in *.html; do
    sed -i -E "s|href=\"/kadaken(\.[a-f0-9]+)?\.css(\?v=[a-f0-9]+)?\"|href=\"/$name\"|g" "$page"
done

echo "stylesheet stamped: $name"
grep -ho 'kadaken[.a-f0-9]*\.css[^"]*' ./*.html | sort -u
