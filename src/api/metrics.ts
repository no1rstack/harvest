/**
 * Minimal Prometheus-style counters for Collection Platform ops.
 */

const counters = new Map<string, { labels: Record<string, string>; value: number }[]>();

export function incCounter(name: string, labels: Record<string, string> = {}): void {
  const existing = counters.get(name)?.find((e) => JSON.stringify(e.labels) === JSON.stringify(labels));
  if (existing) {
    existing.value++;
  } else {
    if (!counters.has(name)) counters.set(name, []);
    counters.get(name)!.push({ labels, value: 1 });
  }
}

export function renderMetricsText(): string {
  const lines: string[] = [];
  for (const [name, entries] of counters) {
    for (const e of entries) {
      const labelStr = Object.entries(e.labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      lines.push(`${name}{${labelStr}} ${e.value}`);
    }
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
