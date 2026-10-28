# Adessa Mind website

Static code export of the Adessa Webflow site (adessamind.com), served by Vercel.

## Updating
1. Publish in Webflow, then Export Code.
2. Replace the pages, css/ and images/ with the export. Keep `vercel.json`, `.gitignore`, this README, `scripts/`, `js/vendor/` and `videos/Adessa-home.webm`.
3. Run `python3 scripts/localize.py`.
4. Commit and push to `main`. Vercel deploys production on every push to `main`; other branches get preview URLs.

## Notes
- `vercel.json` turns on clean URLs, so `/miami` serves `miami.html` and `/miami.html` redirects to `/miami`.
- `404.html` is Vercel's not-found page. `401.html` is Webflow's password page and does nothing here.
- The waitlist and request-access popups use HubSpot embeds (`hs-form-frame`), which work as-is. Each popup also holds a native Webflow form inside a hidden `.hide` wrapper. It would not submit outside Webflow hosting, so keep it hidden.
- Everything the pages load is in this repo: GSAP 3.15.0 and jQuery 3.5.1 (from npm, in `js/vendor/`), the homepage video, the noise texture and the ripple file. After a fresh Webflow export, run `scripts/localize.py` to point the new HTML at these copies again.
- OG image tags point at `https://adessamind.com/images/...`, so link previews work once the domain points here.
- Still external by design: Google Fonts, HubSpot (forms, tracking and the Webflow HubSpot app loader) and Unicorn Studio (jsDelivr).
