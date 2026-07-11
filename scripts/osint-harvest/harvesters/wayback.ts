/**
 * Internet Archive CDX — historical URL harvest (passive).
 * ENNA / Judicium already documents Archive.org; this persists CDX hits to Postgres.
 * Upstream: https://github.com/internetarchive/wayback
 */

import type { Harvester, HarvestFinding } from '../types.js';
import { fetchText, normalizeDomain } from '../http.js';

export const waybackHarvester: Harvester = {
  id: 'wayback',
  name: 'Internet Archive CDX',
  description: 'Harvest historical URLs for a domain from Wayback CDX API',
  reference: 'https://github.com/internetarchive/wayback',

  async run(ctx) {
    const started = Date.now();
    const domain = normalizeDomain(ctx.target);
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];

    try {
      const url =
        `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(domain)}/*` +
        `&output=json&fl=timestamp,original,statuscode,mimetype&collapse=urlkey&limit=${ctx.maxResults}`;
      const text = await fetchText(url, {
        timeoutMs: ctx.timeoutMs,
        userAgent: ctx.userAgent,
      });
      const rows = JSON.parse(text) as string[][];
      // First row is header
      for (const row of rows.slice(1)) {
        const [timestamp, original, status, mime] = row;
        if (!original) continue;
        findings.push({
          source: 'wayback',
          sourceId: `${timestamp}:${original}`,
          entityType: 'url',
          value: original,
          label: original,
          title: `Wayback: ${original}`,
          description: `Captured ${timestamp} · HTTP ${status} · ${mime}`,
          confidence: 0.85,
          tags: ['wayback', 'archive', 'passive'],
          raw: {
            timestamp,
            original,
            statuscode: status,
            mimetype: mime,
            url: `https://web.archive.org/web/${timestamp}/${original}`,
          },
          observedAt: timestamp
            ? `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}T${timestamp.slice(8, 10)}:${timestamp.slice(10, 12)}:${timestamp.slice(12, 14)}Z`
            : undefined,
          related: [{ type: 'domain', value: domain, relation: 'archived_for' }],
        });
      }
    } catch (err) {
      errors.push(`wayback: ${(err as Error).message}`);
    }

    return {
      harvester: this.id,
      findings,
      errors,
      durationMs: Date.now() - started,
    };
  },
};
