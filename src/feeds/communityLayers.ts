/**
 * Free Community map layers — no API keys required for Phase 1.
 * Disasters (USGS + GDACS), Aviation snapshot (OpenSky), Cyber lists (Feodo + URLHaus).
 * Heavy caching + polite User-Agent. Results normalize to CommunityItem shape.
 */

import type { CommunityItem, CommunitySeverity } from './communityTypes.js';

const UA = 'Harvest/1.0 (+https://harvest.noirstack.com; community-layers) (+https://harvest.noirstack.com; community-layers)';

type CacheEntry = { at: number; items: CommunityItem[] };
const cache = new Map<string, CacheEntry>();

function fromCache(key: string, ttlMs: number): CommunityItem[] | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > ttlMs) return null;
  return hit.items;
}

function toCache(key: string, items: CommunityItem[]): CommunityItem[] {
  cache.set(key, { at: Date.now(), items });
  return items;
}

async function fetchText(url: string, timeoutMs = 20000): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.text();
}

async function fetchJson<T = any>(url: string, timeoutMs = 20000): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

function magSeverity(mag: number): CommunitySeverity {
  if (mag >= 7) return 'critical';
  if (mag >= 6) return 'high';
  if (mag >= 5) return 'medium';
  return 'low';
}

/** USGS M4.5+ earthquakes (past day) — real coordinates. */
export async function fetchUsgsDisasters(): Promise<CommunityItem[]> {
  const key = 'layer:usgs';
  const cached = fromCache(key, 90_000);
  if (cached) return cached;

  const data = await fetchJson<any>(
    'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
  );
  const items: CommunityItem[] = (data.features || []).slice(0, 80).map((f: any) => {
    const coords = f.geometry?.coordinates || [];
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    const mag = Number(f.properties?.mag || 0);
    const place = f.properties?.place || `M${mag}`;
    const time = f.properties?.time ? new Date(f.properties.time).toISOString() : new Date().toISOString();
    return {
      id: `usgs:${f.id}`,
      title: `M${mag} — ${place}`,
      summary: `USGS earthquake M${mag}${coords[2] != null ? ` · depth ${Math.round(coords[2])} km` : ''}`,
      sourceClass: 'sensor',
      sourceName: 'USGS',
      sourceUrl: f.properties?.url || 'https://earthquake.usgs.gov/',
      stream: 'disasters',
      category: 'Disaster',
      severity: magSeverity(mag),
      publishedAt: time,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      geoQuality: Number.isFinite(lat) && Number.isFinite(lon) ? 'exact' : 'none',
      location: place,
      originalLink: f.properties?.url,
      severityScore: mag / 10,
      payload: { provider: 'usgs', magnitude: mag, depthKm: coords[2] },
    };
  });
  return toCache(key, items);
}

/** GDACS disaster alerts — parse geo from RSS when present. */
export async function fetchGdacsDisasters(): Promise<CommunityItem[]> {
  const key = 'layer:gdacs';
  const cached = fromCache(key, 180_000);
  if (cached) return cached;

  const text = await fetchText('https://www.gdacs.org/xml/rss.xml');
  const { XMLParser } = await import('fast-xml-parser');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const parsed = parser.parse(text);
  const rawItems = parsed?.rss?.channel?.item || [];
  const list = Array.isArray(rawItems) ? rawItems : [rawItems];

  const items: CommunityItem[] = list.slice(0, 60).map((item: any, i: number) => {
    const lat = Number(
      item['geo:lat'] ?? item?.['georss:point']?.split?.(' ')?.[0] ?? item?.point?.split?.(' ')?.[0],
    );
    const lon = Number(
      item['geo:long'] ??
        item['geo:lon'] ??
        item?.['georss:point']?.split?.(' ')?.[1] ??
        item?.point?.split?.(' ')?.[1],
    );
    const title = String(item.title || 'GDACS alert');
    const alertLevel = String(item['gdacs:alertlevel'] || item['gdacs:severity'] || '').toLowerCase();
    let severity: CommunitySeverity = 'medium';
    if (alertLevel.includes('red') || /critical|extreme/i.test(title)) severity = 'critical';
    else if (alertLevel.includes('orange') || /major|severe/i.test(title)) severity = 'high';
    else if (alertLevel.includes('green')) severity = 'low';

    const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();
    const guid = item.guid?.['#text'] || item.guid || item.link || i;

    return {
      id: `gdacs:${String(guid).slice(0, 80)}`,
      title: title.slice(0, 200),
      summary: String(item.description || '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 400),
      sourceClass: 'sensor',
      sourceName: 'GDACS',
      sourceUrl: item.link || 'https://www.gdacs.org/',
      stream: 'disasters',
      category: 'Disaster',
      severity,
      publishedAt,
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      geoQuality: Number.isFinite(lat) && Number.isFinite(lon) ? 'exact' : 'none',
      location: String(item['gdacs:country'] || item['dc:subject'] || 'Global'),
      originalLink: item.link,
      payload: { provider: 'gdacs', alertLevel },
    };
  });

  return toCache(key, items);
}

export async function fetchDisasterLayer(): Promise<CommunityItem[]> {
  const [usgs, gdacs] = await Promise.allSettled([fetchUsgsDisasters(), fetchGdacsDisasters()]);
  const items = [
    ...(usgs.status === 'fulfilled' ? usgs.value : []),
    ...(gdacs.status === 'fulfilled' ? gdacs.value : []),
  ];
  items.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  return items;
}

/** OpenSky Europe bbox snapshot — density sample, heavily cached. */
export async function fetchAviationSnapshot(): Promise<CommunityItem[]> {
  const key = 'layer:opensky';
  const cached = fromCache(key, 60_000);
  if (cached) return cached;

  // Europe bbox keeps payload smaller for anonymous OpenSky
  const data = await fetchJson<any>(
    'https://opensky-network.org/api/states/all?lamin=35&lomin=-10&lamax=60&lomax=30',
  );
  const states: any[] = data.states || [];
  // Sample evenly to ~80 markers
  const step = Math.max(1, Math.floor(states.length / 80));
  const sampled = states.filter((_, i) => i % step === 0).slice(0, 80);

  const now = new Date().toISOString();
  const items: CommunityItem[] = sampled
    .map((s: any) => {
      const icao = s[0];
      const callsign = (s[1] || '').trim() || icao;
      const lon = Number(s[5]);
      const lat = Number(s[6]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const alt = s[7];
      const vel = s[9];
      return {
        id: `opensky:${icao}`,
        title: `${callsign} · ${s[2] || 'aircraft'}`,
        summary: `OpenSky · alt ${alt != null ? Math.round(alt) + ' m' : 'n/a'} · ${vel != null ? Math.round(vel) + ' m/s' : ''}`,
        sourceClass: 'sensor' as const,
        sourceName: 'OpenSky Network',
        sourceUrl: 'https://opensky-network.org/',
        stream: 'aviation',
        category: 'Aviation',
        severity: 'low' as const,
        publishedAt: now,
        lat,
        lon,
        geoQuality: 'exact' as const,
        location: s[2] || 'In flight',
        originalLink: 'https://opensky-network.org/',
        payload: { provider: 'opensky', icao24: icao, callsign, altitude: alt, velocity: vel },
      };
    })
    .filter(Boolean) as CommunityItem[];

  return toCache(key, items);
}

/** Feodo Tracker C2 IPs (JSON) — geo often missing; keep as list with optional coords. */
export async function fetchFeodoCyber(): Promise<CommunityItem[]> {
  const key = 'layer:feodo';
  const cached = fromCache(key, 600_000);
  if (cached) return cached;

  const data = await fetchJson<any[]>('https://feodotracker.abuse.ch/downloads/ipblocklist.json');
  const now = new Date().toISOString();
  const items: CommunityItem[] = (Array.isArray(data) ? data : [])
    .filter((row) => row?.status === 'online' || !row?.status)
    .slice(0, 100)
    .map((row: any, i: number) => {
      const ip = row.ip_address || row.ip || row.dst_ip;
      const lat = Number(row.latitude ?? row.lat);
      const lon = Number(row.longitude ?? row.lon);
      return {
        id: `feodo:${ip || i}`,
        title: `C2 ${ip}${row.port ? `:${row.port}` : ''}`,
        summary: `Feodo Tracker · ${row.malware || row.as_name || 'botnet C2'}${row.hostname ? ` · ${row.hostname}` : ''}`,
        sourceClass: 'sensor' as const,
        sourceName: 'Feodo Tracker',
        sourceUrl: 'https://feodotracker.abuse.ch/',
        stream: 'cyber',
        category: 'Cybersecurity',
        severity: 'high' as const,
        publishedAt: row.last_online || row.first_seen || now,
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
        geoQuality: Number.isFinite(lat) && Number.isFinite(lon) ? 'exact' : 'none',
        location: row.as_name || row.country || 'Unknown',
        originalLink: 'https://feodotracker.abuse.ch/',
        payload: { provider: 'feodo', ip, port: row.port, malware: row.malware },
      };
    });

  return toCache(key, items);
}

/** URLHaus recent CSV — host-level markers without geo (region-none; still organizable). */
export async function fetchUrlhausCyber(): Promise<CommunityItem[]> {
  const key = 'layer:urlhaus';
  const cached = fromCache(key, 600_000);
  if (cached) return cached;

  const text = await fetchText('https://urlhaus.abuse.ch/downloads/csv_recent/');
  const lines = text.split('\n').filter((l) => l && !l.startsWith('#'));
  // CSV: id,dateadded,url,url_status,last_online,threat,tags,urlhaus_link,reporter
  const items: CommunityItem[] = [];
  for (const line of lines.slice(0, 120)) {
    // naive CSV split respecting quotes lightly
    const cols = line.match(/("([^"]|"")*"|[^,]+)/g)?.map((c) => c.replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
    if (cols.length < 6) continue;
    const [id, dateadded, url, , , threat] = cols;
    if (!url || url === 'url') continue;
    let host = url;
    try {
      host = new URL(url.startsWith('http') ? url : `http://${url}`).hostname;
    } catch {
      /* keep raw */
    }
    items.push({
      id: `urlhaus:${id || host}`,
      title: `${threat || 'malware'} · ${host}`,
      summary: url.slice(0, 300),
      sourceClass: 'sensor',
      sourceName: 'URLHaus',
      sourceUrl: cols[7] || 'https://urlhaus.abuse.ch/',
      stream: 'cyber',
      category: 'Cybersecurity',
      severity: /ransomware|c2/i.test(threat || '') ? 'critical' : 'high',
      publishedAt: dateadded ? new Date(dateadded + 'Z').toISOString() : new Date().toISOString(),
      lat: null,
      lon: null,
      geoQuality: 'none',
      location: host,
      originalLink: cols[7] || url,
      payload: { provider: 'urlhaus', threat, host },
    });
  }

  return toCache(key, items.slice(0, 80));
}

export async function fetchCyberLayer(): Promise<CommunityItem[]> {
  const [feodo, urlhaus] = await Promise.allSettled([fetchFeodoCyber(), fetchUrlhausCyber()]);
  return [
    ...(feodo.status === 'fulfilled' ? feodo.value : []),
    ...(urlhaus.status === 'fulfilled' ? urlhaus.value : []),
  ];
}

export type CommunityLayerId = 'disasters' | 'aviation' | 'cyber';

export async function fetchCommunityLayer(layer: CommunityLayerId): Promise<{
  layer: CommunityLayerId;
  items: CommunityItem[];
  error?: string;
}> {
  try {
    if (layer === 'disasters') return { layer, items: await fetchDisasterLayer() };
    if (layer === 'aviation') return { layer, items: await fetchAviationSnapshot() };
    if (layer === 'cyber') return { layer, items: await fetchCyberLayer() };
    return { layer, items: [], error: 'Unknown layer' };
  } catch (err: any) {
    return { layer, items: [], error: err.message || 'Layer fetch failed' };
  }
}

/** Haversine km — for corroboration badges. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function findCorroborations(
  narrative: CommunityItem[],
  sensors: CommunityItem[],
  opts?: { maxKm?: number; maxHours?: number },
): Array<{ narrativeId: string; sensorId: string; km: number }> {
  const maxKm = opts?.maxKm ?? 250;
  const maxHours = opts?.maxHours ?? 48;
  const out: Array<{ narrativeId: string; sensorId: string; km: number }> = [];
  for (const n of narrative) {
    if (n.lat == null || n.lon == null) continue;
    const nt = Date.parse(n.publishedAt) || 0;
    for (const s of sensors) {
      if (s.lat == null || s.lon == null) continue;
      const st = Date.parse(s.publishedAt) || 0;
      if (Math.abs(nt - st) > maxHours * 3600_000) continue;
      const km = haversineKm(n.lat, n.lon, s.lat, s.lon);
      if (km <= maxKm) out.push({ narrativeId: n.id, sensorId: s.id, km: Math.round(km) });
    }
  }
  return out.slice(0, 200);
}
