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
// The invite in the URL is the same one baked into every installer: it proves
// "this is CodeOp", not "this is you".
const CODEOP_BASE = "https://codeop-update.kadaken-updates.workers.dev";
const CODEOP_INVITE = "7bL1SWnM39YIji2AlIbSaw-qtP5T3Q0d";
const CODEOP_MANIFEST = `${CODEOP_BASE}/codeop-manifest-4.json?invite=${CODEOP_INVITE}`;
const CODEOP_PLATFORM = {
  "codeop-windows": "windows-x86_64",
  "codeop-linux": "linux-x86_64",
  "codeop-appimage": "linux-x86_64",
};

async function currentCodeopUrl(platform) {
  // Sixty seconds of edge cache: a publish is visible almost at once, and a
  // burst of downloads does not become a burst of manifest fetches.
  const response = await fetch(CODEOP_MANIFEST, {
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!response.ok) return "";
  const manifest = await response.json();
  const entry = (manifest.packages || {})[platform];
  return entry && entry.url ? String(entry.url) : "";
}

export async function onRequestGet({ params, env, request, waitUntil }) {
  const key = String(params.file || "").toLowerCase();
  const platform = CODEOP_PLATFORM[key];
  const target = FILES[key];
  if (!platform && !target) {
    return new Response("Not found", { status: 404 });
  }

  let to;
  if (platform) {
    const url = await currentCodeopUrl(platform);
    if (!url) {
      // Deliberately NOT a fallback to a known older build. Handing someone a
      // stale CodeOp is what locked a new person out of their account; saying
      // "try again shortly" costs a minute, and the other one cost a day.
      return new Response(
        "CodeOp's download is briefly unavailable — try again in a minute.",
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    to = new URL(url);
  } else {
    to = new URL(`/download/${target}`, request.url);
  }

  // The count must never be able to stop a download, so it runs after the
  // response is already on its way and any failure is swallowed.
  if (env.KADAKEN_STATS) {
    waitUntil(bump(env.KADAKEN_STATS, key, request).catch(() => {}));
  }

  return Response.redirect(to.toString(), 302);
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
