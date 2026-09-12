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

// The download count, beside the app it belongs to.
//
// Deliberately the sum of the three Agent Workbench files rather than the
// site-wide total: that total also carries CodeOp and two small Python tools,
// and quoting it as "Agent Workbench downloads" would be wrong by about a
// hundred. Added 2026-09-12 for the same reason the counter now separates
// browsers from crawlers - a number on a public page has to be one somebody
// can check.
fetch("/downloads").then(function (r) { return r.json(); }).then(function (d) {
  if (!d || !d.ok || !d.files) return;
  var n = (d.files.appimage || 0) + (d.files.deb || 0) + (d.files.tarball || 0);
  if (!n) return;
  var el = document.getElementById("awbn-downloads");
  if (!el) return;
  el.textContent = n.toLocaleString() + " downloads";
  el.hidden = false;
}).catch(function () {});
