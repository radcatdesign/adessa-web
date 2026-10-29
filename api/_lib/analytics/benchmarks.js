// "How you compare": rates five numbers against published figures in benchmarks.config.js.
import config from './benchmarks.config.js';

const MIN_VISITS = 30;

export function benchmarks(t, settings = {}) {
  const values = {
    bounce_rate: t.bounce_rate, avg_visit: t.avg_visit_ms == null ? null : t.avg_visit_ms / 1000,
    pages_per_visit: t.pages_per_visit, returning_share: t.returning_share, action_rate: t.form_rate,
  };
  const enough = t.visits >= MIN_VISITS;
  return {
    min_visits: MIN_VISITS, enough, site_type: config.site_type,
    rows: config.metrics.map((m) => {
      const o = { ...m, ...(settings.benchmark_overrides?.[m.id] || {}) };
      const v = values[m.id];
      let status = null;
      if (enough && v != null) {
        const better = (a, b) => (o.higher_is_better ? a >= b : a <= b);
        status = better(v, o.goal) ? 'At goal' : (o.higher_is_better ? v >= o.low : v <= o.high) ? 'Typical' : 'Behind typical';
      }
      return { id: o.id, label: o.label, unit: o.unit, value: v, low: o.low, high: o.high, goal: o.goal, higher_is_better: o.higher_is_better, status, note: o.note, sources: o.sources };
    }),
  };
}
