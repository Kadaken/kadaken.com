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
  "codeop-windows": "codeop-4.0.0-beta2-windows-x64.zip",
  "codeop-linux": "codeop_4.0.0-beta_amd64.deb",
  "codeop-appimage": "codeop-4.0.0-beta-x86_64.AppImage",
};

export async function onRequestGet({ params, env, request, waitUntil }) {
  const target = FILES[String(params.file || "").toLowerCase()];
  if (!target) {
    return new Response("Not found", { status: 404 });
  }

  const to = new URL(`/download/${target}`, request.url);

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
