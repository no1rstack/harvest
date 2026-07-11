/**
 * URLhaus recent malicious URLs (abuse.ch) — IOC harvest.
 * ENNA category: threat intel / IOC
 * Upstream: https://urlhaus.abuse.ch/
 */

import type { Harvester, HarvestFinding } from '../types.js';
import { fetchText, normalizeDomain } from '../http.js';

export const urlhausHarvester: Harvester = {
  id: 'urlhaus',
  name: 'URLhaus',
  description: 'Pull recent malicious URLs matching target domain from abuse.ch URLhaus',
  reference: 'https://urlhaus.abuse.ch/',

  async run(ctx) {
    const started = Date.now();
    const domain = normalizeDomain(ctx.target);
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];

    try {
      // CSV recent (limited). Filter client-side for target domain.
      const text = await fetchText('https://urlhaus.abuse.ch/downloads/csv_recent/', {
        timeoutMs: ctx.timeoutMs,
        userAgent: ctx.userAgent,
      });

      const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
      // header: id,dateadded,url,url_status,last_online,threat,tags,urlhaus_link,reporter
      for (const line of lines.slice(1)) {
        if (findings.length >= ctx.maxResults) break;
        // naive CSV split — URLs may contain commas rarely; URLhaus quotes fields
        const cols = line.match(/("([^"]*)"|[^,]*),?/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '')) || [];
        const [id, dateadded, url, urlStatus, , threat, tags, urlhausLink] = cols;
        if (!url || !url.toLowerCase().includes(domain)) continue;

        findings.push({
          source: 'urlhaus',
          sourceId: id || url,
          entityType: 'ioc',
          value: url,
          label: url,
          title: `URLhaus IOC: ${threat || 'malware_download'}`,
          description: `Status ${urlStatus || 'n/a'} · tags ${tags || ''}`,
          severity: 'high',
          confidence: 0.9,
          tags: ['urlhaus', 'ioc', ...(tags ? tags.split(';') : [])],
          raw: {
            id,
            dateadded,
            url,
            url_status: urlStatus,
            threat,
            tags,
            url: urlhausLink || `https://urlhaus.abuse.ch/url/${id}/`,
          },
          observedAt: dateadded,
          related: [{ type: 'domain', value: domain, relation: 'ioc_for' }],
        });
      }
    } catch (err) {
      errors.push(`urlhaus: ${(err as Error).message}`);
    }

    return {
      harvester: this.id,
      findings,
      errors,
      durationMs: Date.now() - started,
    };
  },
};
