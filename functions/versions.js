// What the download buttons should say, read from the things that actually
// serve the files.
//
// The version and size beside each button were typed by hand. That is the
// exact mechanism that left the CodeOp links four releases behind and locked a
// new person out of their account — the links were fixed to read the live
// manifest, but the words next to them were not, so they could still drift
// apart from what the button hands over.
//
// Nothing here is written out. AWBN's figures come from its own update file
// and CodeOp's from the updater's manifest, so the label and the file can only
// ever agree.

const CODEOP_MANIFEST =
  "https://codeop-update.kadaken-updates.workers.dev/codeop-manifest-4.json" +
  "?invite=7bL1SWnM39YIji2AlIbSaw-qtP5T3Q0d";

const KIND = { portable: "Portable", zip: "Zip", deb: "Installer" };

export async function onRequestGet({ request }) {
  const out = {};

  try {
    const awbn = await (
      await fetch(new URL("/awbn-update.json", request.url), {
        cf: { cacheTtl: 60, cacheEverything: true },
      })
    ).json();
    const deb = (awbn.assets || {}).deb || {};
    out.awbn = label("Installer", deb.size, awbn.version);
  } catch (_) {
    // A label that cannot be read is left out entirely: the page keeps the
    // words already in the HTML rather than showing a blank or a guess.
  }

  try {
    const codeop = await (
      await fetch(CODEOP_MANIFEST, { cf: { cacheTtl: 60, cacheEverything: true } })
    ).json();
    const packages = codeop.packages || {};
    const linux = packages["linux-x86_64"] || {};
    const windows = packages["windows-x86_64"] || {};
    out["codeop-linux"] = label(KIND[linux.kind] || "Download", linux.size, codeop.version);
    out["codeop-windows"] = label(KIND[windows.kind] || "Download", windows.size, codeop.version);
  } catch (_) {
    // Same again.
  }

  return new Response(JSON.stringify(out), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "max-age=60",
    },
  });
}

function label(kind, size, version) {
  const mb = size ? `${Math.round(size / 1048576)} MB` : "";
  return [kind, mb, version ? `v${version}` : ""]
    .filter(Boolean)
    .join(" · ");
}
