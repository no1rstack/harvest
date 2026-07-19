import type { Pool } from 'pg';
import { listCommunityItems } from '../../../feeds/communityStorePg.js';
import { fetchGdacsDisasters } from '../../../feeds/communityLayers.js';
import { communityItemToClimateDisaster } from '../mappers/sensor.js';
import type { ClimateDisasterEvent, ListClimateDisastersResponse } from '../schemas/sensor.js';
import { parseIntQuery, parseStringQuery } from '../context.js';

export async function listClimateDisasters(
  pool: Pool | null,
  query: Record<string, unknown>,
): Promise<ListClimateDisastersResponse> {
  const live = parseStringQuery(query.live) === '1' || !pool;
  const limit = parseIntQuery(query.limit, 60, 200);
  const fetchedAt = new Date().toISOString();

  let disasters: ClimateDisasterEvent[] = [];
  if (live) {
    const liveItems = await fetchGdacsDisasters();
    disasters = liveItems
      .map(communityItemToClimateDisaster)
      .filter((d): d is NonNullable<typeof d> => d != null)
      .slice(0, limit);
  } else {
    const stored = await listCommunityItems(pool, {
      hours: parseIntQuery(query.hours, 48, 168),
      limit,
      stream: 'disasters',
    });
    disasters = stored
      .filter((i) => i.id.startsWith('gdacs:'))
      .map(communityItemToClimateDisaster)
      .filter((d): d is NonNullable<typeof d> => d != null);
  }

  return {
    disasters,
    fetchedAt,
    dataAvailable: disasters.length > 0,
  };
}
