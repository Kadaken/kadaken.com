// What the download buttons should say, read from the things that actually
// serve the files.
//
// The version and size beside each button were typed by hand. That is the
// exact mechanism that left the CodeOp links four releases behind and locked a
// new person out of their account — the links were fixed to read the live
// manifest, but the words next to them were not, so they could still drift
// apart from what the button hands over.
//
// Nothing here is written out. Crews' figures come from its own update file
// and CodeOp's from the updater's manifest, so the label and the file can only
// ever agree.

const KIND = { portable: "Portable", zip: "Zip", deb: "Installer" };

export async function onRequestGet({ request, env }) {
  const out = {};
  let crewsVersion = "";
  let codeopVersion = "";
  let wayfinderVersion = "";

  try {
    const crews = await (
      await fetch(new URL("/crews-update.json", request.url), {
        cf: { cacheTtl: 60, cacheEverything: true },
      })
    ).json();
    const deb = (crews.assets || {}).deb || {};
    crewsVersion = crews.version || "";
    out.crews = label("Installer", deb.size, crews.version);
  } catch (_) {
    // A label that cannot be read is left out entirely: the page keeps the
    // words already in the HTML rather than showing a blank or a guess.
  }

  // Wayfinder reads the same file its own in-app update check reads, written
  // by scripts/make-update-manifest.sh off the release tarball. Before this,
  // Wayfinder was the one app whose label was still typed by hand, and it said
  // "2 MB" beside a 3.7 MB download of a version twelve releases newer than
  // the one the words described.
  try {
    const wayfinder = await (
      await fetch(new URL("/wayfinder-update.json", request.url), {
        cf: { cacheTtl: 60, cacheEverything: true },
      })
    ).json();
    wayfinderVersion = wayfinder.version || "";
    // "free" is part of the claim, not part of the file, so it is appended
    // rather than read.
    out.wayfinder = [label("Archive", wayfinder.size, wayfinder.version), "free"]
      .filter(Boolean)
      .join(" \u00b7 ");
  } catch (_) {
    // Same again: the HTML's own words stay.
  }

  try {
    const codeopManifest = codeopManifestUrl(env);
    const codeop = await (
      await fetch(codeopManifest, { cf: { cacheTtl: 60, cacheEverything: true } })
    ).json();
    const packages = codeop.packages || {};
    const linux = packages["linux-x86_64"] || {};
    const windows = packages["windows-x86_64"] || {};
    codeopVersion = codeop.version || "";
    out["codeop-linux"] = label(KIND[linux.kind] || "Download", linux.size, codeop.version);
    out["codeop-windows"] = label(KIND[windows.kind] || "Download", windows.size, codeop.version);
  } catch (_) {
    // Same again.
  }

  // The headline is configured in one small file. CodeOp release placeholders
  // are filled from the same live manifest as its download buttons, so a new
  // beta cannot leave the news bar advertising the previous one.
  try {
    const newsResponse = env.ASSETS
      ? await env.ASSETS.fetch(new URL("/news.json", request.url))
      : await fetch(new URL("/news.json", request.url));
    const news = await newsResponse.json();
    const rendered = renderNews(news, crewsVersion, codeopVersion, wayfinderVersion);
    if (rendered) out.news = rendered;
  } catch (_) {
    // The accessible HTML fallback remains visible if either source is down.
  }

  // The two small tools are NOT listed here, deliberately.
  //
  // They are plain archives with no manifest to read, and two attempts to get
  // their size from inside this Function both came back empty: a plain fetch
  // of our own site is a subrequest back into ourselves, and env.ASSETS
  // answered neither a HEAD content-length nor a ranged content-range. Rather
  // than leave code here that quietly does nothing, it is gone.
  //
  // Their labels stay in the HTML, written from the real files when the
  // archives are built. That is accurate but it is hand-kept, which is the
  // fault this file exists to remove. The fix when it matters: have the
  // packaging step write the sizes into a small JSON next to the archives and
  // read that here.

  return new Response(JSON.stringify(out), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "max-age=60",
    },
  });
}

function codeopManifestUrl(env) {
  if (!env.CODEOP_UPDATE_BASE) {
    throw new Error("CodeOp release source is not configured");
  }
  return new URL("/codeop-manifest-4.json", env.CODEOP_UPDATE_BASE).toString();
}

function renderNews(news, crewsVersion, codeopVersion, wayfinderVersion) {
  if (!news || !Array.isArray(news.items)) return null;
  const match = String(codeopVersion).match(/^(\d+)\.(\d+)(?:\.\d+)?-beta\+(\d+)$/i);
  const rendered = news.items.map((item) => {
    if (!item || typeof item.text !== "string" || typeof item.href !== "string") return null;
    let text = item.text
      .replaceAll("{{crews.version}}", String(crewsVersion))
      .replaceAll("{{wayfinder.version}}", String(wayfinderVersion));
    if (match) {
      text = text
        .replaceAll("{{codeop.major_minor}}", `${match[1]}.${match[2]}`)
        .replaceAll("{{codeop.beta}}", match[3]);
    }
    if (/{{[^}]+}}/.test(text) || !text.trim()) return null;
    // "//host" and "/\\host" leave the site, so a single leading slash only.
    const href = /^\/(?![\/\\])/.test(item.href) || item.href.startsWith("#")
      ? item.href
      : "/";
    return { text, href };
  });
  return rendered.every(Boolean) ? rendered : null;
}

function label(kind, size, version) {
  const mb = size ? `${Math.round(size / 1048576)} MB` : "";
  return [kind, mb, version ? `v${version}` : ""]
    .filter(Boolean)
    .join(" · ");
}
