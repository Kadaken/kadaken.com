// Fill the version and size beside each download button from what actually
// serves the file. The words in the HTML are the fallback, so the page still
// reads correctly with scripting off or if /versions cannot be reached. It
// just risks being out of date, which is what this exists to prevent.
//
// This lives in a file rather than inline because the site's Content-Security
// Policy has to name what may run. An inline block cannot be named without
// either 'unsafe-inline' or a hash that changes every time a comment is
// edited, and the policy previously said script-src 'none', which silently
// blocked this from running at all: every button showed its stale fallback
// while /versions sat there serving the correct numbers. Same reason
// connect-src has to allow 'self'. The fetch below is the whole point.
fetch("/versions").then(function (r) { return r.json(); }).then(function (v) {
  document.querySelectorAll("[data-fill]").forEach(function (el) {
    var text = v[el.getAttribute("data-fill")];
    if (text) el.textContent = text;
  });
  if (Array.isArray(v.news)) {
    document.querySelectorAll("[data-news]").forEach(function (el) {
      var news = v.news[Number(el.getAttribute("data-news"))];
      if (!news || !news.text) return;
      el.textContent = news.text;
      if (news.href) el.setAttribute("href", news.href);
    });
  }
}).catch(function () {});


// The download counter is deliberately NOT fetched here any more.
//
// Added 12 September 2026, removed 14 September. Every visit to the front page
// called /downloads, and that endpoint does five kv.list() sweeps plus a read
// per key returned. Cloudflare started sending "KV daily operation limit 90%
// reached" alerts the next day. The counter was never worth a KV budget: the
// owner's own rule is that download numbers are marketing and do not belong on
// a public page.
