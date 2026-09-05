# Kadaken — site

Static site for Kadaken's apps and games. Licensed AGPL-3.0.

## Local preview

```bash
cd /path/to/kadaken.com
python3 -m http.server 4177
```

Open:

```text
http://127.0.0.1:4177/
```

## Cheap hosting

This is plain static HTML/CSS/JS. Good low-cost options:

- Cloudflare Pages: free static hosting, custom domains, and enough build quota
  for this kind of site.
- GitHub Pages: free for public repositories, or private repositories on paid
  GitHub plans.

## Before publishing

- Replace remaining `href="#"` placeholders as beta links become available.
- Replace or add project screenshots as new beta builds become available.

## Headline news bar

The scrolling bar deliberately shows exactly one current announcement. Its
single source of truth is [`news.json`](news.json).

For a CodeOp beta announcement, leave the two placeholders in that file. The
site reads CodeOp's live release manifest and fills the version automatically,
so publishing Beta 35 will change the bar from Beta 34 to Beta 35 without an
edit to the homepage. The raw HTML intentionally uses a version-free fallback,
so a temporary manifest outage cannot make the page advertise an old beta.

To announce something else, ask Codex or Claude:

> Update Kadaken headline news in `news.json`, keep exactly one item, deploy,
> and verify the `/versions` response and live homepage.

Use plain text and a same-site path or fragment for `href`. After any change,
deploy the site; editing the repository alone does not update production.
