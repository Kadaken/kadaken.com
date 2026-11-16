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
  appimage: "Crews-x86_64.AppImage",
  deb: "crews-amd64.deb",
  tarball: "crews-linux-x64.tar.gz",
  // Small Python tools. No build step and no dependencies beyond what Fedora
  // already ships, so they are plain archives rather than packages.
  "subagent-viewer": "claude-code-subagent-viewer-linux.tar.gz",
  // Crews Lite: the crew harness on its own, no desktop app. Plain Python,
  // so it is an archive rather than a package.
  "crews-lite": "crews-lite-linux.tar.gz",
  "auto-clicker": "fedora-auto-clicker-linux.tar.gz",
  // Wayfinder: one binary plus its icons and an install script.
  wayfinder: "wayfinder-linux-x64.tar.gz",
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
  if (!env.CODEOP_UPDATE_BASE) return "";
  return new URL("/codeop-manifest-4.json", env.CODEOP_UPDATE_BASE).toString();
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
  // contain the Worker's account-scoped hostname or obsolete invite query.
  // Publish only the stable Kadaken download path; never expose credentials in
  // redirects, browser history, analytics, or intermediary logs.
  const source = new URL(String(entry.url));
  if (!source.pathname.startsWith("/downloads/")) return "";
  return new URL(source.pathname, env.CODEOP_UPDATE_BASE).toString();
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
  // CodeOp is invite-only (19 Sep 2026): new people email for it. Existing
  // installs update straight from updates.kadaken.com, not through here.
  if (platform) return { status: 403 };
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
  if (status === 403) {
    return new Response(
      "CodeOp is invite-only right now. Email support@kadaken.com to get it.",
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
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
  //
  // ?test=1 serves the file and counts nothing. Added 2026-09-12 because the
  // owner's own link sweeps were inflating the figures: on 11 September five
  // different files were fetched inside the same minute from one address,
  // which reads as five downloads and was one person checking the links.
  const counting = new URL(request.url).searchParams.get("test") !== "1";
  if (env.KADAKEN_STATS && counting) {
    waitUntil(bump(env.KADAKEN_STATS, key, request).catch(() => {}));
  }

  return Response.redirect(to, 302);
}

// What kind of thing asked for the file.
//
// Nothing here identifies a person. It answers one question the raw total
// cannot: is this a human on a home connection, a script, or a crawler? Before
// this existed, a security scanner sweeping the site and a developer in Berlin
// counted the same, and the site had no honest way to say how many downloads
// were people.
//
// Three buckets, deliberately coarse:
//   browser  a real browser user agent
//   tool     curl, wget, a package manager, a script. Often a real developer
//   bot      something that says it is a crawler, or gives no user agent
const BOT_MARKS = [
  "bot", "crawler", "spider", "slurp", "scraper", "archiver", "monitor",
  "checker", "validator", "preview", "fetcher", "headless", "phantom",
  "scrapy", "httrack", "wappalyzer", "semrush", "ahrefs", "petal", "bytespider",
];
const TOOL_MARKS = [
  "curl", "wget", "python", "go-http", "java/", "libwww", "okhttp", "axios",
  "node-fetch", "powershell", "aria2", "httpie", "apt", "dnf", "rpm",
];
const BROWSER_MARKS = ["mozilla", "chrome", "safari", "firefox", "edg/", "opera"];

function agentKind(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) return "bot";
  for (const mark of BOT_MARKS) if (ua.includes(mark)) return "bot";
  for (const mark of TOOL_MARKS) if (ua.includes(mark)) return "tool";
  for (const mark of BROWSER_MARKS) if (ua.includes(mark)) return "browser";
  return "bot";
}

// Whose network this came from.
//
// Cloudflare hands the worker the name of the operator that owns the address,
// free, on every request. A download from a home broadband provider and one
// from a rented server are not the same event, and until now they counted the
// same. Datacentre traffic is very rarely a person taking the file to use it.
const HOSTING_MARKS = [
  "amazon", "aws", "google", "microsoft", "azure", "oracle", "alibaba",
  "tencent", "huawei", "hetzner", "digitalocean", "linode", "vultr", "ovh",
  "scaleway", "contabo", "leaseweb", "choopa", "colocrossing", "m247",
  "datacamp", "cogent", "hostinger", "godaddy", "namecheap", "cloudflare",
  "fastly", "akamai", "digital ocean", "server", "hosting", "datacenter",
  "data center", "colo", "cloud",
];
const VPN_MARKS = [
  "mullvad", "nordvpn", "expressvpn", "protonvpn", "private internet",
  "surfshark", "cyberghost", "ipvanish", "windscribe", "tunnelbear", "tor ",
];

function networkKind(organisation) {
  const org = String(organisation || "").toLowerCase();
  if (!org) return "unknown";
  for (const mark of VPN_MARKS) if (org.includes(mark)) return "vpn";
  for (const mark of HOSTING_MARKS) if (org.includes(mark)) return "hosting";
  return "home";
}

// Which product the file belongs to, so one pile of numbers becomes three.
// "527 downloads" was never one thing: it mixed Crews, CodeOp and two
// small Python tools, and the headline figure was wrong for every one of them.
const PRODUCT = {
  appimage: "crews", deb: "crews", tarball: "crews",
  "codeop-windows": "codeop", "codeop-linux": "codeop", "codeop-appimage": "codeop",
  "subagent-viewer": "tools", "auto-clicker": "tools", "crews-lite": "crews",
};

// Who this is, without ever storing who this is.
//
// Asked for: "make sure the download counter registered NEW downloads, from
// NEW network address rather than another request from a previously counted
// tester. A raw total cannot answer that: repeated checks can otherwise look
// like distinct visitors.
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
  const agent = agentKind(request.headers.get("user-agent"));
  const network = networkKind((request.cf || {}).asOrganization);
  const product = PRODUCT[key] || "other";

  // The conservative reading: a real browser, on a real home connection.
  // Everything else still counts in the totals, it is simply not claimed as a
  // person. This is the only figure safe to quote to somebody who will ask how
  // it was measured.
  const human = agent === "browser" && network !== "hosting";

  // Is this somebody the site has never served before?
  const who = await visitorId(kv, request);
  const firstTime = who ? (await kv.get(`who:${who}`)) === null : false;

  const keys = [
    `file:${key}`, "total", `day:${day}`, `country:${country}`,
    `agent:${agent}`, `network:${network}`, `product:${product}`,
  ];
  if (human) keys.push("human", `product-human:${product}`);
  if (firstTime) keys.push("people", `newpeople:${day}`);
  if (firstTime && human) keys.push("humanpeople");
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
  recent.unshift({
    at: stamp, file: key, country, first: firstTime,
    agent, network, product, human,
  });
  await kv.put("recent", JSON.stringify(recent.slice(0, 50)));
}
