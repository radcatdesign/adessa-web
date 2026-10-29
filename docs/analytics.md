# Analytics

First-party analytics for adessamind.com: a small tracking script on every public page, Vercel Functions that store what it sends in Postgres, and a staff-only dashboard at `/admin/analytics`. No cookies, no third-party trackers, nothing sent anywhere but this site.

## Where things are

| Part | Location |
|---|---|
| Tracking script | `js/a.js` (about 4 KB gzipped), loaded `defer` on every public page. `scripts/localize.py` adds it to fresh Webflow exports. |
| Collection endpoints | `api/analytics/collect.js`, `api/analytics/presence.js` |
| Dashboard API | `api/analytics/data.js` (`?r=overview`, `pages`, `audience`, `actions`, `action`, `visit`, `live`, `visitors`, `visitor`, `heat`, `settings`, `export`, `config`, `me`) |
| Daily job | `api/analytics/cron.js`, scheduled in `vercel.json` at 07:17 UTC |
| Server code | `api/_lib/analytics/` (files starting with `_` are never served or turned into functions) |
| Dashboard | `admin/analytics.html`, `js/analytics-admin.js`, `css/analytics-admin.css`, `js/analytics-world.js` (map dots) |
| Benchmarks | `api/_lib/analytics/benchmarks.config.js` (values and sources) |
| Tests | `tests/analytics/collect.test.cjs`, `tests/analytics/dashboard.test.cjs` |
| Privacy text for the policy | `docs/analytics-privacy.md` |

## Environment variables (Vercel project adessa-web)

| Name | What it does |
|---|---|
| `DATABASE_URL` | Postgres connection string. Added by the Neon integration (Storage, Create, Neon, connect to adessa-web). Without it the functions fall back to an in-memory database that forgets everything. |
| `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | The "Adessa Website" Clerk app. Staff sign in with it. |
| `ANALYTICS_STAFF_EMAILS` | Comma-separated emails allowed into the dashboard. A Clerk account with a verified email on this list gets in; nobody else does. |
| `CRON_SECRET` | Any long random string. Vercel sends it to the daily job; other callers are refused. |
| `ANALYTICS_TZ` | Optional. Time zone for days and hours in the reports. Default `America/New_York`. |
| `ANALYTICS_ORIGINS` | Optional. Extra origins allowed to send events, comma-separated (for example a second domain). The site's own host is always allowed. |

Local only: `ANALYTICS_DEV=1` (adds a test SQL hook to the dev server) and `ANALYTICS_DEV_AUTH=1` (sign in with any email, no Clerk). Never set these on Vercel.

## Run it locally

```
npm install
ANALYTICS_DEV=1 ANALYTICS_DEV_AUTH=1 node scripts/dev-server.mjs 8790
node tests/analytics/collect.test.cjs
node tests/analytics/dashboard.test.cjs /tmp/shots
```

Open `http://127.0.0.1:8790/admin/analytics` and continue with any email.

## What's collected

- **Page views:** path (no query string; `utm_*` and `ref` are kept separately), the referring site if it's another site, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, device type (phone, tablet, desktop), browser language, the visit ID, the browser ID when allowed, and whether the browser has been here before. The server adds browser and operating system names (the full user agent isn't stored), approximate country, region and city from Vercel's edge lookup (the IP address isn't stored), and the source.
- **Leaving a page:** active time on the page and the deepest scroll point, written onto the page view.
- **Actions:** email and phone link clicks, downloads, links to other sites, form submissions (form name or ID only, never what was typed), HubSpot form submissions, and custom actions.
- **Presence:** while a page is visible and the person interacted in the last 10 minutes, a check-in every 45 seconds with the path; a "gone" signal when they leave.
- **Heatmaps:** clicks and cursor positions grouped into a grid (50 columns across, 20 px rows), the clicked element's short tag and class name, and how far each page view scrolled. Stored as daily counts per page and device, not as recordings.

## Definitions

- **Visit:** runs from the first page until the tab closes or 30 minutes pass without a page view or action. One tab is one visit.
- **Bounce:** a visit that saw one page, did no action and left within 10 seconds of active time.
- **Active time:** counts only while the page is visible and the person scrolled, clicked, tapped, typed or moved the mouse in the last 2 minutes. Opening a page counts as an interaction.
- **Average visit:** active time per visit, added up across its pages.
- **Visitors:** counted once per day from a daily hash; ranges add up the days. The salt behind the hash turns over at midnight in the report time zone, so a day in the reports is a day for the hash too.
- **No browser ID:** with Global Privacy Control or Do Not Track, with a time zone in the EU, EEA, UK or Switzerland (including Cyprus, Ceuta and France's overseas regions), or when Vercel places the request in one of those countries.
- **Returning:** a visit from a browser with a browser ID that was set on an earlier visit. Browsers without an ID are "not identifiable".
- **Likely bots:** visits that never sent a leave signal and never did an action, once they are 30 minutes old. They are left out of every report and counted in Settings.
- **Source:** `utm_source`, then `?ref=`, then the referring site (search engines and social sites get friendly names), else "Direct".

## Add a custom action

From any page on the site:

```js
analytics.track('Booked a call', 'Intro call');
```

The first value is the name (up to 80 characters), the second an optional label (up to 200). It shows up under Actions and in visit logs.

## Settings

- **This browser:** signing in to the dashboard marks the browser as the team's (`localStorage.a_staff = 1`), and the script sends nothing from it on any network. "Count it again" removes the mark.
- **Excluded networks:** IP addresses whose events are dropped. IPv6 excludes the whole /64.
- **Heatmap pages:** every page by default, or a chosen list.
- **Export:** CSV of events, daily totals, heatmap counts or presence for the chosen range.
- **Delete a visitor:** removes every event, presence row and email link for one browser ID.
- **Sample data:** made-up data in a separate in-memory database for demos. Nothing is saved while it's on. Writes are refused.

## Storage and the daily job

Tables: `analytics_events` (partitioned by month), `analytics_presence`, `analytics_heat`, `analytics_daily`, `analytics_rollups`, `analytics_salts`, `analytics_settings`, `analytics_shots` (reserved for page screenshots), `analytics_identities`. They are created automatically on first use.

The daily job creates next month's partition, rotates the salt (deleting the old one), rolls up finished days into `analytics_daily`, clears presence rows older than 30 minutes and drops raw events and heatmap counts older than 400 days. Daily totals are kept.

## Heatmap previews

Vercel can't run a headless browser cheaply, so heatmaps paint over the live page loaded in a sandboxed frame at 1440, 820 or 390 px wide (with `?a_preview=1`, which the script never counts). The frame gets its own opaque origin, so scripts on the page can't reach the dashboard; `js/a-preview.js` inside the page receives the heat data by `postMessage` and draws it. Only paths on this site can be previewed. Scroll inside the preview to see the whole page. A scheduled screenshot job could fill `analytics_shots` later.

## Notes

- The site also loads HubSpot's tracking code through the Webflow HubSpot app. That's separate from this system and sets its own cookies.
- `*.vercel.app` addresses are team-only, so real traffic arrives only once adessamind.com points at this project.
