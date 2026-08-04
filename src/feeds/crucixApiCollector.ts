/**
 * Crucix zero-auth API collectors — GDELT, Safecast, ReliefWeb, WHO, OFAC SDN, OpenSanctions.
 * Each maps API responses to CommunityItem for upsert into community_items.
 */
import type { CommunityItem, CommunitySeverity } from './communityTypes.js';
import { XMLParser } from 'fast-xml-parser';

const UA = 'Harvest/1.0 (+https://harvest.noirstack.com; crucix-collector)';

async function fetchText(url: string, timeoutMs = 25_000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

async function fetchJson<T = any>(url: string, timeoutMs = 25_000): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

// ─── GDELT — Global events (RSS via Google News — no rate limit) ───
export async function fetchGdeltEvents(): Promise<CommunityItem[]> {
  const url = 'https://news.google.com/rss/search?q=geopolitical+conflict+sanctions+military&hl=en-US&gl=US&ceid=US:en';
  try {
    const text = await fetchText(url, 15_000);
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(text);
    const rawItems = parsed?.rss?.channel?.item || [];
    const list = Array.isArray(rawItems) ? rawItems : [rawItems];
    const items: CommunityItem[] = list.slice(0, 75).map((item: any) => ({
      id: `gdelt-rss:${item.guid?.['#text'] || item.guid || item.link || Math.random().toString(36)}`,
      title: String(item.title || 'Geopolitical news').slice(0, 200),
      summary: String(item.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
      sourceClass: 'narrative' as const,
      sourceName: 'Google News — Geopolitical',
      sourceUrl: item.link || url,
      stream: 'gdelt',
      category: 'Geopolitics',
      severity: 'medium' as CommunitySeverity,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      lat: null,
      lon: null,
      geoQuality: 'none' as const,
      location: 'Global',
      originalLink: item.link,
      payload: { provider: 'gdelt-rss', source: item.source?.['#text'] || item.source },
    }));
    return items;
  } catch (err: unknown) {
    console.warn(`[crucix-api] gdelt: ${(err as Error).message}`);
    return [];
  }
}

// ─── Safecast — Radiation monitoring ───
export async function fetchSafecastRadiation(): Promise<CommunityItem[]> {
  const url = 'https://api.safecast.org/measurements.json?order=created_at+desc&per_page=60';
  const data = await fetchJson<any>(url);
  const measurements = Array.isArray(data) ? data : (data?.data || []);
  const items: CommunityItem[] = measurements.slice(0, 60).map((m: any) => {
    const val = Number(m.value || 0);
    const unit = m.unit || 'cpm';
    const severity: CommunitySeverity = val > 1000 ? 'critical' : val > 500 ? 'high' : val > 200 ? 'medium' : 'low';
    return {
      id: `safecast:${m.id || Math.random().toString(36)}`,
      title: `Safecast · ${val} ${unit} · ${m.location || 'Unknown'}`,
      summary: `Radiation: ${val} ${unit}${m.device_id ? ` · device ${m.device_id}` : ''}`,
      sourceClass: 'sensor' as const,
      sourceName: 'Safecast',
      sourceUrl: 'https://safecast.org/',
      stream: 'safecast',
      category: 'Radiation',
      severity,
      publishedAt: m.captured_at || m.created_at || new Date().toISOString(),
      lat: Number.isFinite(Number(m.latitude)) ? Number(m.latitude) : null,
      lon: Number.isFinite(Number(m.longitude)) ? Number(m.longitude) : null,
      geoQuality: (Number.isFinite(Number(m.latitude)) ? 'exact' : 'none') as const,
      location: m.location || 'Unknown',
      originalLink: 'https://safecast.org/',
      severityScore: Math.min(1, val / 1000),
      payload: { provider: 'safecast', value: val, unit, deviceId: m.device_id },
    };
  });
  return items;
}

// ─── ReliefWeb / GDACS — UN-coordinated disaster alerts ───
export async function fetchReliefWebDisasters(): Promise<CommunityItem[]> {
  // ReliefWeb requires approved appname for API; use GDACS RSS as free alternative
  const rssUrl = 'https://www.gdacs.org/xml/rss.xml';
  try {
    const text = await fetchText(rssUrl, 15_000);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(text);
    const rawItems = parsed?.rss?.channel?.item || [];
    const list = Array.isArray(rawItems) ? rawItems : [rawItems];
    const items: CommunityItem[] = list.slice(0, 50).map((item: any) => {
      const title = String(item.title || 'GDACS alert');
      let severity: CommunitySeverity = 'medium';
      if (/red|critical/i.test(title)) severity = 'critical';
      else if (/orange|major|severe/i.test(title)) severity = 'high';
      else if (/green/i.test(title)) severity = 'low';
      return {
        id: `gdacs-crucix:${item.guid?.['#text'] || item.guid || item.link || Math.random().toString(36)}`,
        title: title.slice(0, 200),
        summary: String(item.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
        sourceClass: 'sensor' as const,
        sourceName: 'GDACS (ReliefWeb)',
        sourceUrl: item.link || 'https://www.gdacs.org/',
        stream: 'reliefweb',
        category: 'Humanitarian',
        severity,
        publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
        lat: null,
        lon: null,
        geoQuality: 'none' as const,
        location: 'Global',
        originalLink: item.link,
        payload: { provider: 'gdacs', note: 'ReliefWeb requires approved appname; using GDACS instead' },
      };
    });
    return items;
  } catch (err: unknown) {
    console.warn(`[crucix-api] reliefweb: ${(err as Error).message}`);
    return [];
  }
}

// ─── WHO — Disease Outbreaks (RSS fallback since GHO needs indicators) ───
export async function fetchWhoOutbreaks(): Promise<CommunityItem[]> {
  const rssUrl = 'https://www.who.int/rss-feeds/news-english.xml';
  try {
    const text = await fetchText(rssUrl);
    const parser = new XMLParser({ ignoreAttributes: false });
    const parsed = parser.parse(text);
    const rawItems = parsed?.rss?.channel?.item || [];
    const list = Array.isArray(rawItems) ? rawItems : [rawItems];
    const items: CommunityItem[] = list.slice(0, 20).map((item: any) => ({
      id: `who:${item.guid?.['#text'] || item.guid || item.link || Math.random().toString(36)}`,
      title: String(item.title || 'WHO update').slice(0, 200),
      summary: String(item.description || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
      sourceClass: 'authority' as const,
      sourceName: 'WHO',
      sourceUrl: item.link || 'https://www.who.int/',
      stream: 'who',
      category: 'Health',
      severity: /outbreak|pandemic|emergency/i.test(item.title || '') ? 'critical' :
        /epidemic|alert/i.test(item.title || '') ? 'high' : 'medium',
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      lat: null,
      lon: null,
      geoQuality: 'none' as const,
      location: 'Global',
      originalLink: item.link,
      payload: { provider: 'who', categories: item.category },
    }));
    return items;
  } catch {
    return [];
  }
}

// ─── OFAC SDN — Sanctions list (XML) ───
export async function fetchOfacSanctions(): Promise<CommunityItem[]> {
  const url = 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML';
  try {
    const text = await fetchText(url, 60_000);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(text);
    const entries = parsed?.sdnList?.sdnEntry || [];
    const list = Array.isArray(entries) ? entries : [entries];
    const items: CommunityItem[] = list.slice(0, 100).map((e: any, i: number) => {
      const firstName = e.firstName || '';
      const lastName = e.lastName || '';
      const name = `${lastName}${firstName ? ', ' + firstName : ''}`.trim() || e.sdnType || 'OFAC entry';
      const programs = e.programList?.program;
      const progList = Array.isArray(programs) ? programs : (programs ? [programs] : []);
      const progNames = progList.map((p: any) => p['#text'] || p).filter(Boolean).join(', ');
      return {
        id: `ofac:${e.uid || i}`,
        title: `OFAC SDN · ${name}`.slice(0, 200),
        summary: `Sanctions: ${progNames || e.sdnType || 'SDN'} · ${e.remarks || ''}`.slice(0, 400),
        sourceClass: 'authority' as const,
        sourceName: 'OFAC SDN',
        sourceUrl: 'https://sanctionssearch.ofac.treas.gov/',
        stream: 'ofac',
        category: 'Sanctions',
        severity: 'high' as const,
        publishedAt: new Date().toISOString(),
        lat: null,
        lon: null,
        geoQuality: 'none' as const,
        location: e.country || 'Global',
        originalLink: 'https://sanctionssearch.ofac.treas.gov/',
        payload: { provider: 'ofac', uid: e.uid, type: e.sdnType, programs: progList },
      };
    });
    return items;
  } catch {
    return [];
  }
}

// ─── OpenSanctions — Global sanctions (public catalog — no auth needed) ───
export async function fetchOpenSanctions(): Promise<CommunityItem[]> {
  try {
    const data = await fetchJson<any>('https://data.opensanctions.org/datasets/latest/default/index.json', 20_000);
    const datasets = data?.datasets || [];
    const items: CommunityItem[] = (Array.isArray(datasets) ? datasets : []).slice(0, 50).map((ds: any) => {
      const name = ds.name || ds.title || 'Dataset';
      return {
        id: `opensanctions:${ds.name || Math.random().toString(36)}`,
        title: `OpenSanctions · ${name}`.slice(0, 200),
        summary: `Dataset: ${ds.title || name} · ${ds.country || 'Global'} · ${ds.category || 'sanctions'}`.slice(0, 400),
        sourceClass: 'authority' as const,
        sourceName: 'OpenSanctions',
        sourceUrl: 'https://www.opensanctions.org/',
        stream: 'opensanctions',
        category: 'Sanctions',
        severity: 'high' as const,
        publishedAt: ds.updated_at || ds.created_at || new Date().toISOString(),
        lat: null,
        lon: null,
        geoQuality: 'none' as const,
        location: ds.country || 'Global',
        originalLink: `https://www.opensanctions.org/datasets/${ds.name}/`,
        payload: { provider: 'opensanctions', dataset: ds.name, summary: ds.summary, category: ds.category },
      };
    });
    return items;
  } catch (err: unknown) {
    console.warn(`[crucix-api] opensanctions: ${(err as Error).message}`);
    return [];
  }
}

/** Collect from all 6 zero-auth Crucix APIs. Returns { streamName, items }. */
export async function collectAllCrucixApis(): Promise<Array<{ stream: string; items: CommunityItem[] }>> {
  const results: Array<{ stream: string; items: CommunityItem[]; error?: string }> = [];

  const collectors: Array<{ stream: string; fn: () => Promise<CommunityItem[]> }> = [
    { stream: 'gdelt', fn: fetchGdeltEvents },
    { stream: 'safecast', fn: fetchSafecastRadiation },
    { stream: 'reliefweb', fn: fetchReliefWebDisasters },
    { stream: 'who', fn: fetchWhoOutbreaks },
    { stream: 'ofac', fn: fetchOfacSanctions },
    { stream: 'opensanctions', fn: fetchOpenSanctions },
  ];

  for (const { stream, fn } of collectors) {
    try {
      const items = await fn();
      results.push({ stream, items });
    } catch (err: unknown) {
      const msg = (err as Error)?.message || String(err);
      console.warn(`[crucix-api] ${stream} failed: ${msg}`);
      results.push({ stream, items: [], error: msg });
    }
  }

  return results;
}
