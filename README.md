# Adessa Mind website

Static code export of the Adessa Webflow site (adessamind.com), served by Vercel.

## Updating
1. Publish in Webflow, then Export Code.
2. Replace everything in this repo except `vercel.json`, `.gitignore` and this README with the export.
3. Commit and push to `main`. Vercel deploys production on every push to `main`; other branches get preview URLs.

## Notes
- `vercel.json` turns on clean URLs, so `/miami` serves `miami.html` and `/miami.html` redirects to `/miami`.
- `404.html` is Vercel's not-found page. `401.html` is Webflow's password page and does nothing here.
- The waitlist popup forms are native Webflow forms and do not submit outside Webflow hosting. The HubSpot embeds (`hs-form-frame`) work as-is.
- Webflow CDN still hosts GSAP and the OG image URLs.
