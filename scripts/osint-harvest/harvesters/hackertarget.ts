/**
 * HackerTarget free APIs — hostsearch / DNS / reverse (theHarvester-style public sources).
 * ENNA category: recon / OSINT aggregation
 * Upstream: https://hackertarget.com/ip-tools/
 * Rate-limited free tier — keep maxResults modest.
 */

import type { Harvester, HarvestFinding } from '../types.js';
import { fetchText, normalizeDomain, isIp, sleep } from '../http.js';

async function linesFrom(url: string, ctx: { timeoutMs: number; userAgent: string }): Promise<string[]> {
  const text = await fetchText(url, ctx);
  if (/error|api count exceeded|invalid/i.test(text) && text.split('\n').length < 3) {
    throw new Error(text.trim().slice(0, 200));
  }
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.toLowerCase().startsWith('error'));
}

export const hackertargetHarvester: Harvester = {
  id: 'hackertarget',
  name: 'HackerTarget',
  description: 'Passive hostsearch, DNS, and reverse DNS via HackerTarget free APIs',
  reference: 'https://hackertarget.com/ip-tools/',

  async run(ctx) {
    const started = Date.now();
    const target = normalizeDomain(ctx.target);
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();

    const push = (f: HarvestFinding) => {
      const key = `${f.entityType}:${f.value.toLowerCase()}`;
      if (seen.has(key) || findings.length >= ctx.maxResults) return;
      seen.add(key);
      findings.push(f);
    };

    // hostsearch — domain → host,ip pairs
    if (!isIp(target)) {
      try {
        const lines = await linesFrom(
          `https://api.hackertarget.com/hostsearch/?q=${encodeURIComponent(target)}`,
          ctx,
        );
        for (const line of lines) {
          const [host, ip] = line.split(',').map((s) => s.trim());
          if (!host) continue;
          push({
            source: 'hackertarget',
            sourceId: `host:${host}`,
            entityType: host === target ? 'domain' : 'subdomain',
            value: host.toLowerCase(),
            label: host,
            title: `Hostsearch: ${host}`,
            confidence: 0.8,
            tags: ['hackertarget', 'hostsearch', 'passive'],
            related: ip
              ? [{ type: 'ip', value: ip, relation: 'resolves_to' }]
              : [{ type: 'domain', value: target, relation: 'subdomain_of' }],
            raw: { host, ip },
          });
          if (ip) {
            push({
              source: 'hackertarget',
              sourceId: `ip:${ip}`,
              entityType: 'ip',
              value: ip,
              label: ip,
              title: `Host IP: ${ip}`,
              confidence: 0.8,
              tags: ['hackertarget', 'ip'],
              related: [{ type: 'domain', value: host.toLowerCase(), relation: 'hosts' }],
            });
          }
        }
      } catch (err) {
        errors.push(`hackertarget:hostsearch: ${(err as Error).message}`);
      }
      await sleep(1100);
    }

    // DNS lookup
    try {
      const lines = await linesFrom(
        `https://api.hackertarget.com/dnslookup/?q=${encodeURIComponent(target)}`,
        ctx,
      );
      for (const line of lines) {
        push({
          source: 'hackertarget',
          sourceId: `dns:${line}`,
          entityType: 'dns_record',
          value: line,
          label: line.slice(0, 120),
          title: `DNS: ${line.slice(0, 80)}`,
          confidence: 0.85,
          tags: ['hackertarget', 'dns'],
          related: [{ type: 'domain', value: target, relation: 'has_record' }],
        });
      }
    } catch (err) {
      errors.push(`hackertarget:dns: ${(err as Error).message}`);
    }

    return {
      harvester: this.id,
      findings,
      errors,
      durationMs: Date.now() - started,
    };
  },
};
