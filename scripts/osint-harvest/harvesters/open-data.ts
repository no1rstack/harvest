/**
 * Open data / finance harvesters for Collection Platform.
 * World Bank, Data.gov, FinCEN (via catalog), Blockchain.com, IBAN MOD-97, OCCRP Aleph.
 */

import type { Harvester, HarvestFinding } from '../types.js';
import { fetchJson } from '../http.js';

const WB = (process.env.WORLDBANK_API_URL || 'https://api.worldbank.org/v2').replace(/\/$/, '');
const CATALOG = (process.env.DATAGOV_CATALOG_URL || 'https://catalog.data.gov').replace(/\/$/, '');
const ALEPH = 'https://aleph.occrp.org/api/2/';

function validateIban(ibanRaw: string) {
  const iban = String(ibanRaw || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban) || iban.length < 15 || iban.length > 34) {
    return { valid: false, iban, error: 'format' };
  }
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const expanded = rearranged
    .split('')
    .map((ch) => (/[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch))
    .join('');
  let remainder = 0;
  for (let i = 0; i < expanded.length; i += 7) {
    remainder = Number(String(remainder) + expanded.slice(i, i + 7)) % 97;
  }
  return { valid: remainder === 1, iban, country: iban.slice(0, 2) };
}

export const worldbankHarvester: Harvester = {
  id: 'worldbank',
  name: 'World Bank Open Data',
  description: 'Countries / indicators from api.worldbank.org',
  reference: 'https://data.worldbank.org/',
  async run(ctx) {
    const started = Date.now();
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];
    const q = ctx.target.trim().toLowerCase();
    try {
      const data = await fetchJson<[unknown, Array<Record<string, any>>]>(
        `${WB}/country/all?format=json&per_page=400`,
        { timeoutMs: ctx.timeoutMs, userAgent: ctx.userAgent, breakerName: 'api.worldbank.org' },
      );
      const rows = Array.isArray(data?.[1]) ? data[1] : [];
      for (const r of rows) {
        if (findings.length >= ctx.maxResults) break;
        const hay = `${r.id} ${r.name} ${r.iso2Code || ''}`.toLowerCase();
        if (q && !(hay.includes(q) || q.split(/\s+/).some((t) => t && hay.includes(t)))) continue;
        findings.push({
          source: 'worldbank',
          sourceId: String(r.id),
          entityType: 'organization',
          value: String(r.id),
          label: String(r.name),
          title: `World Bank: ${r.name}`,
          description: `${r.incomeLevel?.value || ''} · ${r.region?.value || ''}`.trim(),
          confidence: 0.9,
          tags: ['worldbank', 'wdi', 'statistics'],
          raw: r,
        });
      }
    } catch (err) {
      errors.push(`worldbank: ${(err as Error).message}`);
    }
    findings.push({
      source: 'worldbank',
      sourceId: `portal:${ctx.target}`,
      entityType: 'url',
      value: 'https://data.worldbank.org/',
      label: 'World Bank Open Data',
      title: `World Bank portal for "${ctx.target}"`,
      confidence: 0.7,
      tags: ['worldbank', 'portal'],
    });
    return { harvester: this.id, findings: findings.slice(0, ctx.maxResults), errors, durationMs: Date.now() - started };
  },
};

export const datagovHarvester: Harvester = {
  id: 'datagov',
  name: 'Data.gov Catalog',
  description: 'U.S. open government dataset catalog search',
  reference: 'https://catalog.data.gov/',
  async run(ctx) {
    const started = Date.now();
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];
    try {
      const data = await fetchJson<{ results?: Array<{ dcat?: Record<string, any> }> }>(
        `${CATALOG}/search?q=${encodeURIComponent(ctx.target)}&per_page=${Math.min(ctx.maxResults, 25)}`,
        {
          timeoutMs: ctx.timeoutMs,
          userAgent: ctx.userAgent,
          headers: { Accept: 'application/json' },
          breakerName: 'catalog.data.gov',
        },
      );
      for (const row of data.results || []) {
        const d = row.dcat || {};
        const title = String(d.title || 'Dataset');
        findings.push({
          source: 'datagov',
          sourceId: String(d.identifier || title).slice(0, 120),
          entityType: 'custom',
          value: String(d.landingPage || title),
          label: title,
          title: `Data.gov: ${title}`,
          description: String(d.description || '').slice(0, 400),
          confidence: 0.85,
          tags: ['datagov', 'opendata', ...(Array.isArray(d.keyword) ? d.keyword.slice(0, 5).map(String) : [])],
          raw: d,
        });
      }
    } catch (err) {
      errors.push(`datagov: ${(err as Error).message}`);
    }
    return { harvester: this.id, findings: findings.slice(0, ctx.maxResults), errors, durationMs: Date.now() - started };
  },
};

export const fincenHarvester: Harvester = {
  id: 'fincen',
  name: 'FinCEN',
  description: 'FinCEN datasets via Data.gov + portal anchors',
  reference: 'https://www.fincen.gov/',
  async run(ctx) {
    const started = Date.now();
    const findings: HarvestFinding[] = [
      {
        source: 'fincen',
        sourceId: 'portal',
        entityType: 'url',
        value: 'https://www.fincen.gov/',
        label: 'FinCEN',
        title: 'FinCEN portal',
        description: 'Financial Crimes Enforcement Network advisories & news',
        confidence: 0.75,
        tags: ['fincen', 'aml', 'bsa'],
      },
    ];
    const errors: string[] = [];
    try {
      const data = await fetchJson<{ results?: Array<{ dcat?: Record<string, any> }> }>(
        `${CATALOG}/search?q=${encodeURIComponent(`fincen ${ctx.target}`)}&per_page=${Math.min(ctx.maxResults, 20)}`,
        {
          timeoutMs: ctx.timeoutMs,
          userAgent: ctx.userAgent,
          headers: { Accept: 'application/json' },
          breakerName: 'catalog.data.gov',
        },
      );
      for (const row of data.results || []) {
        const d = row.dcat || {};
        findings.push({
          source: 'fincen',
          sourceId: String(d.identifier || d.title || 'dataset').slice(0, 120),
          entityType: 'custom',
          value: String(d.landingPage || d.title || ''),
          label: String(d.title || 'FinCEN dataset'),
          title: `FinCEN: ${d.title}`,
          description: String(d.description || '').slice(0, 400),
          confidence: 0.85,
          tags: ['fincen', 'datagov', 'aml'],
          raw: d,
        });
      }
    } catch (err) {
      errors.push(`fincen: ${(err as Error).message}`);
    }
    return { harvester: this.id, findings: findings.slice(0, ctx.maxResults), errors, durationMs: Date.now() - started };
  },
};

export const blockchainHarvester: Harvester = {
  id: 'blockchain',
  name: 'Blockchain.com',
  description: 'Bitcoin address lookup via blockchain.info',
  reference: 'https://www.blockchain.com/',
  async run(ctx) {
    const started = Date.now();
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];
    const q = ctx.target.trim();
    if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(q)) {
      try {
        const data = await fetchJson<Record<string, any>>(
          `https://blockchain.info/rawaddr/${encodeURIComponent(q)}?limit=3`,
          { timeoutMs: ctx.timeoutMs, userAgent: ctx.userAgent, breakerName: 'blockchain.info' },
        );
        findings.push({
          source: 'blockchain',
          sourceId: String(data.address || q),
          entityType: 'custom',
          value: String(data.address || q),
          label: `BTC ${data.address || q}`,
          title: `Blockchain.com BTC address`,
          description: `txs=${data.n_tx} balance_sat=${data.final_balance}`,
          confidence: 0.9,
          tags: ['blockchain', 'btc', 'crypto'],
          raw: data,
        });
      } catch (err) {
        errors.push(`blockchain: ${(err as Error).message}`);
      }
    } else {
      findings.push({
        source: 'blockchain',
        sourceId: `portal:${q}`,
        entityType: 'url',
        value: 'https://www.blockchain.com/explorer',
        label: 'Blockchain.com explorer',
        title: `Blockchain.com for "${q}"`,
        description: 'Pass a BTC address as the collection target for rawaddr enrichment',
        confidence: 0.6,
        tags: ['blockchain', 'portal'],
      });
    }
    return { harvester: this.id, findings, errors, durationMs: Date.now() - started };
  },
};

export const ibanHarvester: Harvester = {
  id: 'iban',
  name: 'IBAN validation',
  description: 'ISO 7064 MOD-97 IBAN check (optional IBAN.com API)',
  reference: 'https://www.iban.com/',
  async run(ctx) {
    const started = Date.now();
    const v = validateIban(ctx.target);
    const findings: HarvestFinding[] = [
      {
        source: 'iban',
        sourceId: v.iban || ctx.target,
        entityType: 'custom',
        value: v.iban || ctx.target,
        label: v.valid ? `Valid IBAN ${v.iban}` : 'Invalid IBAN',
        title: 'IBAN MOD-97',
        description: v.valid ? `country=${v.country}` : `error=${(v as any).error || 'invalid'}`,
        confidence: v.valid ? 0.95 : 0.7,
        tags: ['iban', 'banking', ...(v.valid ? ['valid'] : ['invalid'])],
        raw: v as unknown as Record<string, unknown>,
      },
    ];
    return { harvester: this.id, findings, errors: [], durationMs: Date.now() - started };
  },
};

export const alephHarvester: Harvester = {
  id: 'aleph',
  name: 'OCCRP Aleph',
  description: 'Aleph entity search (persons, companies, vessels)',
  reference: 'https://aleph.occrp.org/',
  async run(ctx) {
    const started = Date.now();
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];
    try {
      const data = await fetchJson<{ results?: Array<Record<string, any>> }>(
        `${ALEPH}entities?q=${encodeURIComponent(ctx.target)}&limit=${Math.min(ctx.maxResults, 15)}`,
        { timeoutMs: ctx.timeoutMs, userAgent: ctx.userAgent, breakerName: 'aleph.occrp.org' },
      );
      for (const e of data.results || []) {
        const name = e.name || e.properties?.name?.[0] || e.id;
        findings.push({
          source: 'aleph',
          sourceId: String(e.id),
          entityType: e.schema === 'Person' ? 'person' : e.schema === 'Company' ? 'organization' : 'custom',
          value: String(name),
          label: String(name),
          title: `Aleph ${e.schema}: ${name}`,
          description: `collection=${e.collection_id || ''}`,
          confidence: 0.85,
          tags: ['aleph', 'occrp', String(e.schema || 'entity').toLowerCase()],
          raw: e,
        });
      }
    } catch (err) {
      errors.push(`aleph: ${(err as Error).message}`);
    }
    return { harvester: this.id, findings: findings.slice(0, ctx.maxResults), errors, durationMs: Date.now() - started };
  },
};
