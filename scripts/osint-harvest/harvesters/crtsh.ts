/**
 * Certificate Transparency harvest — crt.sh with Cert Spotter fallback.
 * ENNA category: recon / certificate transparency
 * Upstream: https://crt.sh · https://sslmate.com/certspotter
 *
 * crt.sh is frequently 502/slow; we retry briefly then fall back.
 */

import type { Harvester, HarvestFinding } from '../types.js';
import { fetchJson, normalizeDomain, sleep } from '../http.js';

interface CrtShRow {
  id?: number;
  common_name?: string;
  name_value?: string;
  issuer_name?: string;
  not_before?: string;
  not_after?: string;
  serial_number?: string;
}

interface CertSpotterIssuance {
  id?: string;
  dns_names?: string[];
  issuer?: { name?: string };
  not_before?: string;
  not_after?: string;
  cert_sha256?: string;
}

function expandNames(row: CrtShRow): string[] {
  const parts = `${row.common_name || ''}\n${row.name_value || ''}`
    .split(/[\n,]/)
    .map((s) => s.trim().toLowerCase().replace(/^\*\./, ''))
    .filter(Boolean);
  return [...new Set(parts)];
}

function toFinding(
  name: string,
  domain: string,
  meta: {
    source: string;
    sourceId: string;
    issuer?: string;
    notBefore?: string;
    notAfter?: string;
    url?: string;
    serial?: string;
  },
): HarvestFinding {
  return {
    source: meta.source,
    sourceId: meta.sourceId,
    entityType: name === domain ? 'domain' : 'subdomain',
    value: name,
    label: name,
    title: `CT name: ${name}`,
    description: `Seen in certificate issued by ${meta.issuer || 'unknown'}`,
    confidence: 0.85,
    tags: ['certificate-transparency', 'passive', meta.source],
    raw: {
      issuer: meta.issuer,
      notBefore: meta.notBefore,
      notAfter: meta.notAfter,
      serial: meta.serial,
      url: meta.url,
    },
    related: meta.issuer
      ? [{ type: 'organization', value: meta.issuer, relation: 'issued_by' }]
      : [],
    observedAt: meta.notBefore,
  };
}

async function fromCrtSh(
  domain: string,
  ctx: { timeoutMs: number; userAgent: string; maxResults: number },
  errors: string[],
): Promise<HarvestFinding[]> {
  const findings: HarvestFinding[] = [];
  const seen = new Set<string>();
  const attemptTimeout = Math.min(ctx.timeoutMs, 12_000);
  const url = `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const rows = await fetchJson<CrtShRow[]>(url, {
        timeoutMs: attemptTimeout,
        userAgent: ctx.userAgent,
      });
      const list = Array.isArray(rows) ? rows : [];
      for (const row of list.slice(0, ctx.maxResults * 3)) {
        for (const name of expandNames(row)) {
          if (!name.endsWith(domain) && name !== domain) continue;
          if (seen.has(name)) continue;
          seen.add(name);
          if (findings.length >= ctx.maxResults) break;
          findings.push(
            toFinding(name, domain, {
              source: 'crtsh',
              sourceId: String(row.id ?? name),
              issuer: row.issuer_name,
              notBefore: row.not_before,
              notAfter: row.not_after,
              serial: row.serial_number,
              url: `https://crt.sh/?id=${row.id}`,
            }),
          );
        }
        if (findings.length >= ctx.maxResults) break;
      }
      return findings;
    } catch (err) {
      const msg = (err as Error).message;
      errors.push(`crtsh attempt ${attempt}: ${msg}`);
      if (attempt < 2) await sleep(800);
    }
  }
  return findings;
}

async function fromCertSpotter(
  domain: string,
  ctx: { timeoutMs: number; userAgent: string; maxResults: number },
  errors: string[],
): Promise<HarvestFinding[]> {
  const findings: HarvestFinding[] = [];
  const seen = new Set<string>();
  const url =
    `https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(domain)}` +
    `&include_subdomains=true&expand=dns_names&expand=issuer`;

  try {
    const rows = await fetchJson<CertSpotterIssuance[]>(url, {
      timeoutMs: Math.min(ctx.timeoutMs, 15_000),
      userAgent: ctx.userAgent,
    });
    const list = Array.isArray(rows) ? rows : [];
    for (const row of list) {
      for (const rawName of row.dns_names || []) {
        const name = rawName.trim().toLowerCase().replace(/^\*\./, '');
        if (!name.endsWith(domain) && name !== domain) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        if (findings.length >= ctx.maxResults) break;
        findings.push(
          toFinding(name, domain, {
            source: 'certspotter',
            sourceId: String(row.id ?? row.cert_sha256 ?? name),
            issuer: row.issuer?.name,
            notBefore: row.not_before,
            notAfter: row.not_after,
            url: row.cert_sha256
              ? `https://crt.sh/?q=${row.cert_sha256}`
              : undefined,
          }),
        );
      }
      if (findings.length >= ctx.maxResults) break;
    }
  } catch (err) {
    errors.push(`certspotter: ${(err as Error).message}`);
  }
  return findings;
}

export const crtshHarvester: Harvester = {
  id: 'crtsh',
  name: 'Certificate Transparency',
  description: 'Passive subdomain/cert discovery via crt.sh (Cert Spotter fallback)',
  reference: 'https://crt.sh',

  async run(ctx) {
    const started = Date.now();
    const domain = normalizeDomain(ctx.target);
    const errors: string[] = [];

    let findings = await fromCrtSh(domain, ctx, errors);
    if (!findings.length) {
      findings = await fromCertSpotter(domain, ctx, errors);
    }

    return {
      harvester: this.id,
      findings,
      errors,
      durationMs: Date.now() - started,
    };
  },
};
