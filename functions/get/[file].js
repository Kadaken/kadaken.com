// Counts a download, then hands over the real file.
//
// It sits in FRONT of /download/ rather than replacing it: the static files
// stay reachable at their own addresses, so if this ever breaks or the free
// request budget is exhausted, every download link still works. Counting is
// the thing allowed to fail, never the download.
//
// Only /get/* runs a function. Everything else on the site is still plain
// static files and costs nothing.

const FILES = {
  appimage: "Agent_Workbench_Native-x86_64.AppImage",
  deb: "agent-workbench-native-amd64.deb",
  tarball: "agent-workbench-native-linux-x64.tar.gz",
  // Small Python tools. No build step and no dependencies beyond what Fedora
  // already ships, so they are plain archives rather than packages.
  "subagent-viewer": "claude-code-subagent-viewer-linux.tar.gz",
  "auto-clicker": "fedora-auto-clicker-linux.tar.gz",
};

// CodeOp's app packages are NOT hosted here. Cloudflare Pages refuses any file
// over 25 MiB, and the Windows zip passed that when the video libraries were
// bundled into it (27 MiB) — which failed the WHOLE deploy, so the site quietly
// kept serving months-old files and none of the /get/ links worked at all. That
// is how a new friend ended up downloading a build too old for the current
// invite and being locked out (2026-08-25).
//
// They live in the same R2 bucket the in-app updater already downloads from, so
// there is one copy of each release rather than two that can disagree.
//
// The filenames used to be written out here, which reintroduced the same fault
// by hand: on 2026-08-27 these still said beta+9 while beta+13 was live, four
// releases behind. Nothing is written out any more. The current release is read
// from the updater's own manifest at request time, so this page cannot fall
// behind what the app itself installs.
//
const CODEOP_PLATFORM = {
  "codeop-windows": "windows-x86_64",
  "codeop-linux": "linux-x86_64",
  "codeop-appimage": "linux-x86_64",
};

function codeopManifestUrl(env) {
  if (!env.CODEOP_UPDATE_BASE || !env.CODEOP_INVITE) return "";
  const url = new URL("/codeop-manifest-4.json", env.CODEOP_UPDATE_BASE);
  url.searchParams.set("invite", env.CODEOP_INVITE);
  return url.toString();
}

async function currentCodeopUrl(platform, env) {
  // Sixty seconds of edge cache: a publish is visible almost at once, and a
  // burst of downloads does not become a burst of manifest fetches.
  const manifestUrl = codeopManifestUrl(env);
  if (!manifestUrl) return "";
  const response = await fetch(manifestUrl, {
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!response.ok) return "";
  const manifest = await response.json();
  const entry = (manifest.packages || {})[platform];
  if (!entry || !entry.url) return "";

  // Release manifests created before the branded domain was introduced may
  // contain the Worker's account-scoped hostname. Keep the signed path and
  // query intact while presenting only the stable Kadaken domain publicly.
  const source = new URL(String(entry.url));
  if (!source.pathname.startsWith("/downloads/")) return "";
  return new URL(`${source.pathname}${source.search}`, env.CODEOP_UPDATE_BASE).toString();
}

// A HEAD request used to 404 on every one of these, because only GET was
// exported. Browsers use GET so ordinary downloads worked and the fault was
// invisible — but download managers, link checkers and some corporate proxies
// send HEAD first and report the link as dead. Measured 2026-08-27: HEAD on
// /get/appimage returned 404 while GET returned a correct 302.
// Where a name points, without counting anything. Shared by GET and HEAD so
// the two can never disagree about which file a link means.
async function resolve(key, request, env) {
  const platform = CODEOP_PLATFORM[key];
  const target = FILES[key];
  if (!platform && !target) return { status: 404 };
  if (platform) {
    const url = await currentCodeopUrl(platform, env);
    if (!url) return { status: 503 };
    return { status: 302, to: url };
  }
  return { status: 302, to: new URL(`/download/${target}`, request.url).toString() };
}

// A HEAD request used to 404 on every one of these, because only GET was
// exported. Browsers use GET so ordinary downloads worked and the fault was
// invisible — but download managers, link checkers and some corporate proxies
// send HEAD first and report the link as dead. Measured 2026-08-27: HEAD on
// /get/appimage returned 404 while GET returned a correct 302.
//
// It deliberately does NOT count. A HEAD is somebody checking the link exists,
// not somebody taking the file, and a link checker sweeping the site would
// otherwise invent downloads that never happened.
export async function onRequestHead({ params, env, request }) {
  const key = String(params.file || "").toLowerCase();
  const { status, to } = await resolve(key, request, env);
  const headers = to ? { Location: to } : {};
  return new Response(null, { status, headers });
}

export async function onRequestGet({ params, env, request, waitUntil }) {
  const key = String(params.file || "").toLowerCase();
  const { status, to } = await resolve(key, request, env);
  if (status === 404) {
    return new Response("Not found", { status: 404 });
  }
  if (status === 503) {
    // Deliberately NOT a fallback to a known older build. Handing someone a
    // stale CodeOp is what locked a new person out of their account; saying
    // "try again shortly" costs a minute, and the other one cost a day.
    return new Response(
      "CodeOp's download is briefly unavailable — try again in a minute.",
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  // The count must never be able to stop a download, so it runs after the
  // response is already on its way and any failure is swallowed.
  if (env.KADAKEN_STATS) {
    waitUntil(bump(env.KADAKEN_STATS, key, request).catch(() => {}));
  }

  return Response.redirect(to, 302);
}

// Who this is, without ever storing who this is.
//
// Asked for: "make sure the download counter registered NEW downloads, from
// NEW ip address or whatever you can, so I can see if someone other than
// myself or you or test participant has downloaded something." A raw total cannot answer
// that -- three people testing a link looks the same as three strangers.
//
// The address is hashed with a random salt that is generated once and never
// leaves this worker, and only the first sixteen characters are kept. That is
// enough to tell "seen before" from "never seen", and it is not enough to work
// backwards to a person or to match them against any other list.
async function visitorId(kv, request) {
  const address = request.headers.get("cf-connecting-ip") || "";
  if (!address) return "";
  let salt = await kv.get("salt");
  if (!salt) {
    salt = crypto.randomUUID();
    await kv.put("salt", salt);
  }
  const bytes = new TextEncoder().encode(`${salt}:${address}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

async function bump(kv, key, request) {
  // KV has no atomic increment. At this volume a lost count now and then is
  // fine; a wrong number is better than a broken download.
  const day = new Date().toISOString().slice(0, 10);
  const country = request.headers.get("cf-ipcountry") || "??";

  // Is this somebody the site has never served before?
  const who = await visitorId(kv, request);
  const firstTime = who ? (await kv.get(`who:${who}`)) === null : false;

  const keys = [`file:${key}`, "total", `day:${day}`, `country:${country}`];
  if (firstTime) keys.push("people", `newpeople:${day}`);
  for (const k of keys) {
    const now = parseInt((await kv.get(k)) || "0", 10) + 1;
    await kv.put(k, String(now));
  }
  if (who) {
    await kv.put(`who:${who}`, day);
  }

  // The newest download, and a short log of them, so a person can be told what
  // happened rather than only how many times.
  const stamp = new Date().toISOString();
  await kv.put("last", stamp);
  const recent = JSON.parse((await kv.get("recent")) || "[]");
  recent.unshift({ at: stamp, file: key, country, first: firstTime });
  await kv.put("recent", JSON.stringify(recent.slice(0, 50)));
}
