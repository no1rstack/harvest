/**
 * DNS harvest via Cloudflare DNS-over-HTTPS (passive).
 * ENNA category: recon / DNS
 */

import type { Harvester, HarvestFinding, HarvestEntityType } from '../types.js';
import { fetchJson, normalizeDomain, isIp } from '../http.js';

interface DohAnswer {
  name?: string;
  type?: number;
  data?: string;
  TTL?: number;
}

interface DohResponse {
  Answer?: DohAnswer[];
  Authority?: DohAnswer[];
}

const RECORD_TYPES: Array<{ type: string; entity: HarvestEntityType }> = [
  { type: 'A', entity: 'ip' },
  { type: 'AAAA', entity: 'ip' },
  { type: 'MX', entity: 'dns_record' },
  { type: 'NS', entity: 'dns_record' },
  { type: 'TXT', entity: 'dns_record' },
  { type: 'CNAME', entity: 'domain' },
  { type: 'SOA', entity: 'dns_record' },
];

export const dnsHarvester: Harvester = {
  id: 'dns',
  name: 'DNS over HTTPS',
  description: 'Resolve A/AAAA/MX/NS/TXT/CNAME/SOA via Cloudflare DoH',
  reference: 'https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/',

  async run(ctx) {
    const started = Date.now();
    const domain = normalizeDomain(ctx.target);
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];

    for (const rec of RECORD_TYPES) {
      if (findings.length >= ctx.maxResults) break;
      try {
        const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${rec.type}`;
        const data = await fetchJson<DohResponse>(url, {
          timeoutMs: Math.min(ctx.timeoutMs, 15000),
          userAgent: ctx.userAgent,
          headers: { Accept: 'application/dns-json' },
        });

        for (const ans of data.Answer || []) {
          if (!ans.data) continue;
          let value = ans.data.replace(/\.$/, '');
          if (rec.type === 'MX') {
            value = value.replace(/^\d+\s+/, '').replace(/\.$/, '');
          }
          if (!value || value === '.') continue;

          const entityType: HarvestEntityType =
            rec.type === 'A' || rec.type === 'AAAA'
              ? 'ip'
              : isIp(value)
                ? 'ip'
                : rec.entity;

          findings.push({
            source: 'dns-doh',
            sourceId: `${domain}:${rec.type}:${value}`,
            entityType,
            value,
            label: `${rec.type} ${value}`,
            title: `DNS ${rec.type}: ${domain} → ${value}`,
            description: `TTL ${ans.TTL ?? 'n/a'}`,
            confidence: 0.95,
            tags: ['dns', rec.type.toLowerCase(), 'passive'],
            raw: { recordType: rec.type, ttl: ans.TTL, name: ans.name, data: ans.data },
            related: [{ type: 'domain', value: domain, relation: 'resolves_from' }],
          });

          if (findings.length >= ctx.maxResults) break;
        }
      } catch (err) {
        errors.push(`dns:${rec.type}: ${(err as Error).message}`);
      }
    }

    return {
      harvester: this.id,
      findings,
      errors,
      durationMs: Date.now() - started,
    };
  },
};
