import type { Pool } from 'pg';
import { listCommunityItems } from '../../../feeds/communityStorePg.js';
import { fetchCommunityLayer } from '../../../feeds/communityLayers.js';
import { communityItemToCyberThreat } from '../mappers/sensor.js';
import type { CyberThreatEvent, ListCyberThreatsResponse } from '../schemas/sensor.js';
import { parseIntQuery, parseStringQuery } from '../context.js';

export async function listCyberThreats(
  pool: Pool | null,
  query: Record<string, unknown>,
): Promise<ListCyberThreatsResponse> {
  const live = parseStringQuery(query.live) === '1' || !pool;
  const limit = parseIntQuery(query.limit, 100, 300);
  const fetchedAt = new Date().toISOString();

  let threats: CyberThreatEvent[] = [];
  if (live) {
    const result = await fetchCommunityLayer('cyber');
    threats = result.items
      .map(communityItemToCyberThreat)
      .filter((t): t is NonNullable<typeof t> => t != null)
      .slice(0, limit);
  } else {
    const stored = await listCommunityItems(pool, {
      hours: parseIntQuery(query.hours, 48, 168),
      limit,
      stream: 'cyber',
    });
    threats = stored
      .map(communityItemToCyberThreat)
      .filter((t): t is NonNullable<typeof t> => t != null);
  }

  return {
    threats,
    fetchedAt,
    dataAvailable: threats.length > 0,
  };
}
