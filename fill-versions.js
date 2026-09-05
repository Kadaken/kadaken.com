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
  if (v.news && v.news.text) {
    document.querySelectorAll("[data-news]").forEach(function (el) {
      el.textContent = v.news.text;
      if (v.news.href) el.setAttribute("href", v.news.href);
    });
  }
}).catch(function () {});
