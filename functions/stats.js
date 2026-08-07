// The download numbers, readable from a phone.
//
// Not linked from anywhere and marked noindex — it is not secret, just quiet.
// If it should ever be truly private, the fix is a token check here, not
// hiding the address.

export async function onRequestGet({ env }) {
  const kv = env.KADAKEN_STATS;
  if (!kv) {
    return page("<p class=\"alt\">The counter is not connected yet.</p>");
  }

  const read = async (k) => parseInt((await kv.get(k)) || "0", 10);
  const [appimage, deb, tarball, total, last] = await Promise.all([
    read("file:appimage"), read("file:deb"), read("file:tarball"),
    read("total"), kv.get("last"),
  ]);

  const days = (await kv.list({ prefix: "day:" })).keys.map((k) => k.name).sort().reverse();
  const recent = [];
  for (const name of days.slice(0, 14)) {
    recent.push([name.slice(4), await read(name)]);
  }

  const countries = (await kv.list({ prefix: "country:" })).keys.map((k) => k.name);
  const places = [];
  for (const name of countries) places.push([name.slice(8), await read(name)]);
  places.sort((a, b) => b[1] - a[1]);

  const rows = (pairs) =>
    pairs.length
      ? pairs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join("")
      : '<tr><td colspan="2">Nothing yet.</td></tr>';

  return page(`
      <section class="thing">
        <div class="head"><h2>Downloads</h2><span class="chip live">${total} total</span></div>
        <table class="tally">
          <tr><td>AppImage</td><td>${appimage}</td></tr>
          <tr><td>.deb</td><td>${deb}</td></tr>
          <tr><td>.tar.gz</td><td>${tarball}</td></tr>
        </table>
        <p class="alt">Last one: ${last ? esc(last.replace("T", " ").slice(0, 16)) + " UTC" : "none yet"}</p>
      </section>

      <section class="thing">
        <h2>By day</h2>
        <table class="tally">${rows(recent)}</table>
      </section>

      <section class="thing">
        <h2>By country</h2>
        <table class="tally">${rows(places)}</table>
      </section>

      <section class="thing">
        <p class="alt">
          Counts downloads that go through the buttons on this site. Someone
          hitting a /download/ address directly is not counted, and neither is
          anything taken from GitHub.
        </p>
      </section>`);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function page(body) {
  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Downloads | Kadaken</title>
    <meta name="robots" content="noindex" />
    <link rel="stylesheet" href="/kadaken.css" />
  </head>
  <body class="kadaken">
    <div class="sky"></div>
    <div class="floor"></div>
    <div class="veil"></div>
    <header>
      <div class="wrap">
        <a class="name" href="/">KADAKEN</a>
        <span class="tag">Downloads</span>
      </div>
    </header>
    <main class="wrap">
      <section class="intro"><h1>Download counter</h1></section>
${body}
    </main>
    <footer><div class="wrap"><a href="/">Back to Kadaken</a></div></footer>
  </body>
</html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
