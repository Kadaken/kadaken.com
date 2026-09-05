// The version beside a download button is written into the page as it is
// served, not fetched by the browser afterwards.
//
// The words in the HTML were hand-kept and drifted: the CodeOp buttons read
// v4.0.0-beta+13 while the file they handed over was beta+31 -- eighteen
// releases apart. A script filled them in correctly on load, so the number was
// right for anyone whose browser ran it and reached /versions, and wrong for
// everyone else, including for the moment before the fetch returned. That is
// what was being read off the screen.
//
// Rewriting here removes the window entirely. The page arrives correct.
//
// It cannot make the page worse: if the labels cannot be read the response is
// passed through untouched, and the words already in the HTML stand.

export async function onRequest(context) {
  const response = await context.next();
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html")) return response;

  let labels;
  try {
    const url = new URL("/versions", context.request.url);
    labels = await (
      await fetch(url, { cf: { cacheTtl: 60, cacheEverything: true } })
    ).json();
  } catch (_) {
    return response;
  }
  if (!labels || typeof labels !== "object") return response;

  return new HTMLRewriter()
    .on("[data-fill]", {
      element(el) {
        const text = labels[el.getAttribute("data-fill")];
        if (text) el.setInnerContent(text);
      },
    })
    .on("[data-news]", {
      element(el) {
        const news = labels.news;
        if (!news || typeof news.text !== "string") return;
        el.setInnerContent(news.text);
        if (typeof news.href === "string") el.setAttribute("href", news.href);
      },
    })
    .transform(response);
}
