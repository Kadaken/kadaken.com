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
  "codeop-linux": "codeop_4.0.0-beta_amd64.deb",
};

// CodeOp's app packages are NOT hosted here. Cloudflare Pages refuses any file
// over 25 MiB, and the Windows zip passed that when the video libraries were
// bundled into it (27 MiB) — which failed the WHOLE deploy, so the site quietly
// kept serving months-old files and none of the /get/ links worked at all. That
// is how a new friend ended up downloading a build too old for the current
// invite and being locked out (2026-08-25).
//
// They live in the same R2 bucket the in-app updater already downloads from, so
// there is one copy of each release rather than two that can disagree. The
// invite in the URL is the same one baked into every installer: it proves "this
// is CodeOp", not "this is you".
const CODEOP_BASE =
  "https://codeop-update.kadaken-updates.workers.dev/downloads";
const CODEOP_INVITE = "7bL1SWnM39YIji2AlIbSaw-qtP5T3Q0d";
const REMOTE = {
  "codeop-windows": "CodeOp-windows-4.0.0-beta+9-befec8e4.zip",
  "codeop-appimage": "CodeOp-linux-4.0.0-beta+9-4c9c6a62.AppImage",
};

export async function onRequestGet({ params, env, request, waitUntil }) {
  const key = String(params.file || "").toLowerCase();
  const remote = REMOTE[key];
  const target = FILES[key];
  if (!remote && !target) {
    return new Response("Not found", { status: 404 });
  }

  const to = remote
    ? new URL(`${CODEOP_BASE}/${encodeURIComponent(remote)}?invite=${CODEOP_INVITE}`)
    : new URL(`/download/${target}`, request.url);

  // The count must never be able to stop a download, so it runs after the
  // response is already on its way and any failure is swallowed.
  if (env.KADAKEN_STATS) {
    waitUntil(bump(env.KADAKEN_STATS, params.file, request).catch(() => {}));
  }

  return Response.redirect(to.toString(), 302);
}

async function bump(kv, key, request) {
  // KV has no atomic increment. At this volume a lost count now and then is
  // fine; a wrong number is better than a broken download.
  const day = new Date().toISOString().slice(0, 10);
  const country = request.headers.get("cf-ipcountry") || "??";

  for (const k of [`file:${key}`, "total", `day:${day}`, `country:${country}`]) {
    const now = parseInt((await kv.get(k)) || "0", 10) + 1;
    await kv.put(k, String(now));
  }
  await kv.put("last", new Date().toISOString());
}
