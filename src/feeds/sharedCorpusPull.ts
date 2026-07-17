/**
 * Shared open-data corpora → community_items (same path as RSS / free layers).
 * Streams: `aiid`, `aptnotes`
 */

import type { CommunityItem } from './communityTypes.js';
import { enrichCommunityPayload } from './feedEnrichment.js';

const UA = 'Harvest/1.0 (+https://harvest.noirstack.com; shared-corpus)';

const APTNOTES_URL =
  process.env.APTNOTES_JSON_URL ||
  'https://raw.githubusercontent.com/aptnotes/data/master/APTnotes.json';

type AptNote = {
  Filename?: string;
  Title?: string;
  Source?: string;
  Link?: string;
  'SHA-1'?: string;
  Date?: string;
  Year?: string;
};

type AiidCorpusItem = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt: string;
  category?: string;
  deployer?: string;
  developer?: string;
  harmed?: string;
};

function judiciumBase(): string {
  return (
    process.env.JUDICIUM_INTERNAL_URL ||
    process.env.JUDICIUM_URL ||
    ''
  ).replace(/\/$/, '');
}

async function fetchJson<T>(url: string, timeoutMs = 60_000): Promise<T> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/json',
  };
  const token = process.env.COLLECTION_INTERNAL_TOKEN || process.env.JUDICIUM_SERVICE_TOKEN || '';
  if (token) headers['X-Collection-Token'] = token;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function isoOrNow(raw?: string): string {
  if (!raw) return new Date().toISOString();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** APTnotes public report index → community items. */
export async function fetchAptnotesCorpus(limit = 400): Promise<CommunityItem[]> {
  const rows = await fetchJson<AptNote[]>(APTNOTES_URL, 45_000);
  const list = Array.isArray(rows) ? rows : [];
  const n = Math.max(1, Math.min(limit, 2000));
  return list.slice(0, n).map((r) => {
    const sha = String(r['SHA-1'] || '').slice(0, 40);
    const id = `aptnotes:${sha || r.Filename || r.Title || Math.random().toString(36).slice(2)}`;
    const title = String(r.Title || r.Filename || 'APT report');
    const link = String(r.Link || '');
    const base: CommunityItem = {
      id,
      title: `APTnotes: ${title}`,
      summary: `${r.Source || ''} · ${r.Year || r.Date || ''}`.trim().slice(0, 800) || title,
      sourceClass: 'authority',
      sourceName: 'APTnotes',
      sourceUrl: link || 'https://github.com/aptnotes/data',
      stream: 'aptnotes',
      category: 'Threat Report',
      severity: 'medium',
      publishedAt: isoOrNow(r.Date || (r.Year ? `${r.Year}-01-01` : undefined)),
      lat: null,
      lon: null,
      geoQuality: 'none',
      originalLink: link || undefined,
      payload: {
        filename: r.Filename,
        year: r.Year,
        sha1: sha || undefined,
      },
    };
    // Corpus rows are already structured — keep rule-based enrich (avoid N LLM calls).
    return { ...base, payload: enrichCommunityPayload(base) };
  });
}

/** AIID via Judicium processed corpus (feeds-style ingest). */
export async function fetchAiidCorpus(limit = 2000): Promise<CommunityItem[]> {
  const base = judiciumBase();
  if (!base) {
    throw new Error('JUDICIUM_INTERNAL_URL or JUDICIUM_URL required for AIID corpus pull');
  }
  const url = `${base}/api/search/aiid/corpus?limit=${Math.max(1, Math.min(limit, 5000))}`;
  const data = await fetchJson<{ items?: AiidCorpusItem[]; count?: number }>(url, 90_000);
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map((r) => {
    const baseItem: CommunityItem = {
      id: r.id.startsWith('aiid:') ? r.id : `aiid:${r.id}`,
      title: r.title,
      summary: (r.summary || '').slice(0, 800),
      sourceClass: 'authority',
      sourceName: 'AI Incident Database',
      sourceUrl: r.sourceUrl || 'https://incidentdatabase.ai/',
      stream: 'aiid',
      category: r.category || 'AI Incident',
      severity: 'medium',
      publishedAt: isoOrNow(r.publishedAt),
      lat: null,
      lon: null,
      geoQuality: 'none',
      originalLink: r.sourceUrl,
      payload: {
        deployer: r.deployer,
        developer: r.developer,
        harmed: r.harmed,
      },
    };
    return { ...baseItem, payload: enrichCommunityPayload(baseItem) };
  });
}
