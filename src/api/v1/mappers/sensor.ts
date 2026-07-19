import type { CommunityItem } from '../../../feeds/communityTypes.js';
import type {
  AircraftPosition,
  ClimateDisasterEvent,
  CyberThreatEvent,
  EarthquakeEvent,
} from '../schemas/sensor.js';

function toEpochMs(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export function communityItemToEarthquake(item: CommunityItem): EarthquakeEvent | null {
  if (!item.id.startsWith('usgs:')) return null;
  const magnitude = Number((item.payload as Record<string, unknown>)?.magnitude ?? 0);
  const depthKm = (item.payload as Record<string, unknown>)?.depthKm as number | undefined;
  return {
    id: item.id,
    title: item.title,
    magnitude,
    depthKm,
    place: item.location || item.title,
    publishedAt: toEpochMs(item.publishedAt),
    sourceUrl: item.originalLink || item.sourceUrl,
    severity: item.severity,
    location:
      item.lat != null && item.lon != null
        ? { latitude: item.lat, longitude: item.lon }
        : undefined,
  };
}

export function communityItemToClimateDisaster(item: CommunityItem): ClimateDisasterEvent | null {
  if (!item.id.startsWith('gdacs:') && item.stream !== 'disasters') return null;
  if (item.id.startsWith('usgs:')) return null;
  const alertLevel = String((item.payload as Record<string, unknown>)?.alertLevel || '');
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    alertLevel: alertLevel || undefined,
    publishedAt: toEpochMs(item.publishedAt),
    locationName: item.location,
    sourceUrl: item.originalLink || item.sourceUrl,
    severity: item.severity,
    location:
      item.lat != null && item.lon != null
        ? { latitude: item.lat, longitude: item.lon }
        : undefined,
  };
}

export function communityItemToCyberThreat(item: CommunityItem): CyberThreatEvent | null {
  if (item.stream !== 'cyber') return null;
  const payload = (item.payload || {}) as Record<string, unknown>;
  const indicator = String(payload.ip || payload.indicator || item.title).replace(/^C2\s+/i, '');
  return {
    id: item.id,
    title: item.title,
    summary: item.summary,
    indicator,
    malware: payload.malware ? String(payload.malware) : undefined,
    publishedAt: toEpochMs(item.publishedAt),
    locationName: item.location,
    sourceUrl: item.originalLink || item.sourceUrl,
    severity: item.severity,
    location:
      item.lat != null && item.lon != null
        ? { latitude: item.lat, longitude: item.lon }
        : undefined,
  };
}

export function communityItemToAircraftPosition(item: CommunityItem): AircraftPosition | null {
  if (item.stream !== 'aviation' || item.lat == null || item.lon == null) return null;
  const payload = (item.payload || {}) as Record<string, unknown>;
  return {
    id: item.id,
    callsign: item.title.split('·')[0]?.trim() || item.id,
    icao24: String(payload.icao24 || item.id.replace('opensky:', '')),
    aircraftType: String(payload.aircraftType || item.location || ''),
    altitudeM: payload.altitude != null ? Number(payload.altitude) : undefined,
    velocityMs: payload.velocity != null ? Number(payload.velocity) : undefined,
    publishedAt: toEpochMs(item.publishedAt),
    location: { latitude: item.lat, longitude: item.lon },
  };
}
