// Benchmark ranges and their sources, for a lead-generation site in health and wellness.
// Update the numbers here when newer studies come out. Staff can also override per metric (analytics_settings.benchmark_overrides).
// Researched October 2026. Units: percent values are fractions (0.45 = 45%), avg_visit is seconds.
export default {
  site_type: 'Lead generation in health and wellness',
  metrics: [
    {
      id: 'bounce_rate', label: 'Bounce rate', unit: 'percent', higher_is_better: false,
      low: 0.40, high: 0.53, goal: 0.40,
      note: {
        what: 'Share of visits that saw one page, did nothing and left within 10 seconds. That matches how GA4 counts a bounce, which is what these studies measure. Published medians sit between about 40% and 53%; health and fitness sites run toward the top of that.',
        moves: 'A first screen that answers "is this for me" right away, fast loading on phones, and ads or posts that send people to the page that matches what they clicked.',
      },
      sources: [
        { name: 'AgencyAnalytics, GA4 bounce rate by industry (2025)', url: 'https://agencyanalytics.com/blog/bounce-rate-google-analytics-4' },
        { name: 'Siege Media, GA4 engagement rate benchmarks', url: 'https://www.siegemedia.com/research/ga4-engagement-rate-benchmarks' },
        { name: 'Loves Data, what is a good bounce rate', url: 'https://www.lovesdata.com/blog/google-analytics-bounce-rate/' },
      ],
    },
    {
      id: 'avg_visit', label: 'Average visit', unit: 'seconds', higher_is_better: true,
      low: 135, high: 167, goal: 160,
      note: {
        what: 'Time per visit. The studies report GA4-style session length, which counts time a tab sits open. Ours only counts time the page is visible and in use, so expect to read somewhat lower than these figures for the same behavior. Watch the trend as much as the rating.',
        moves: 'Content worth staying for (the AQ explainer, video, the how-it-works steps), clear next steps on every page, and links between related pages.',
      },
      sources: [
        { name: 'Databox, website performance benchmarks', url: 'https://databox.com/benchmarks/website-performance' },
        { name: 'Webtonic, pageview and session benchmarks (citing WebFX)', url: 'https://www.webtonic.io/blog/pageview-statistics' },
      ],
    },
    {
      id: 'pages_per_visit', label: 'Pages per visit', unit: 'number', higher_is_better: true,
      low: 2.2, high: 3.8, goal: 2.8,
      note: {
        what: 'Page views divided by visits. Health and wellness sites average about 2.2; the all-industry average is about 3.8.',
        moves: 'Obvious paths from the homepage to the next useful page, related links at the end of each page, and a small number of clear sections rather than one long page.',
      },
      sources: [
        { name: 'Focus Digital, average pages per session by industry (2026)', url: 'https://focus-digital.co/average-pages-per-session-industry-benchmarks/' },
      ],
    },
    {
      id: 'returning_share', label: 'Returning visitors', unit: 'percent', higher_is_better: true,
      low: 0.15, high: 0.35, goal: 0.30,
      note: {
        what: 'Share of identifiable visits from a browser that has been here before. There is no strong published study for this one: these are industry estimates (15% to 25% for early-stage sites, 25% to 35% as they grow). It only counts browsers that keep an ID, not EU visitors or those who opt out.',
        moves: 'A reason to come back: events, the waitlist, emails that link to new pages, and returning-guest offers.',
      },
      sources: [
        { name: 'Count, return visitor rate estimates', url: 'https://count.co/metric/return-visitor-rate' },
        { name: 'Shield Labs, new vs returning visitors', url: 'https://shieldlabs.ai/blog/new-vs-returning-visitors' },
      ],
    },
    {
      id: 'action_rate', label: 'Visits that send a form', unit: 'percent', higher_is_better: true,
      low: 0.023, high: 0.051, goal: 0.05,
      note: {
        what: 'Share of visits with at least one form submission (the waitlist and request-access forms). Across whole sites, health and social care converts about 2.3% of sessions and all industries about 5.1%. Focused landing pages do better: wellness landing pages have a median of 8.2%.',
        moves: 'One clear ask per page, a short form, proof near the button (guest quotes, the Miami results), and sending campaign traffic to a page built for that campaign.',
      },
      sources: [
        { name: 'Ruler Analytics, conversion rate by industry (2026)', url: 'https://ruleranalytics.com/blog/insight/conversion-rate-by-industry/' },
        { name: 'Unbounce, health and wellness conversion benchmarks', url: 'https://unbounce.com/conversion-benchmark-report/healthcare-wellness-conversion-rate' },
      ],
    },
  ],
};
