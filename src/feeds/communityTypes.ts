/** Canonical Community Intelligence item — collect / organize / correlate. */

export type CommunitySourceClass = 'narrative' | 'sensor' | 'authority' | 'social' | 'market';

export type CommunityGeoQuality = 'exact' | 'approx' | 'region' | 'none';

export type CommunitySeverity = 'critical' | 'high' | 'medium' | 'low';

export interface CommunityItem {
  id: string;
  title: string;
  summary: string;
  sourceClass: CommunitySourceClass;
  sourceName: string;
  sourceUrl?: string;
  stream: string;
  category: string;
  severity: CommunitySeverity;
  publishedAt: string;
  lat?: number | null;
  lon?: number | null;
  geoQuality: CommunityGeoQuality;
  location?: string;
  originalLink?: string;
  clusterId?: string;
  severityScore?: number;
  payload?: Record<string, unknown>;
}

export interface CommunityStreamStatus {
  stream: string;
  lastOkAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  lastCount: number;
  updatedAt: string;
}

export const SOURCE_CLASS_LABELS: Record<CommunitySourceClass, string> = {
  narrative: 'News',
  sensor: 'Sensors',
  authority: 'Authority',
  social: 'Social',
  market: 'Markets',
};

export function inferSourceClass(stream: string, sourceName: string, category: string): CommunitySourceClass {
  const s = `${stream} ${sourceName} ${category}`.toLowerCase();
  if (/worldmonitor|usgs|gdacs|firms|opensky|adsb|ais|celestrak|earthquake|wildfire|sensor/.test(s)) {
    return 'sensor';
  }
  if (/ofac|sanction|govtrack|advisory|wikidata|court|legislation|authority/.test(s)) {
    return 'authority';
  }
  if (/telegram|twitter|x @|youtube|discord|reddit|mastodon|social/.test(s)) {
    return 'social';
  }
  if (/finance|market|stock|commodity|crypto/.test(s)) {
    return 'market';
  }
  return 'narrative';
}
