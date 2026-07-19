import type { Pool } from 'pg';
import { listCommunityItems } from '../../../feeds/communityStorePg.js';
import { fetchAviationSnapshot } from '../../../feeds/communityLayers.js';
import { communityItemToAircraftPosition } from '../mappers/sensor.js';
import type { AircraftPosition, ListAircraftPositionsResponse } from '../schemas/sensor.js';
import { parseIntQuery, parseStringQuery } from '../context.js';

export async function listAircraftPositions(
  pool: Pool | null,
  query: Record<string, unknown>,
): Promise<ListAircraftPositionsResponse> {
  const live = parseStringQuery(query.live) === '1' || !pool;
  const limit = parseIntQuery(query.limit, 80, 200);
  const fetchedAt = new Date().toISOString();

  let positions: AircraftPosition[] = [];
  if (live) {
    const liveItems = await fetchAviationSnapshot();
    positions = liveItems
      .map(communityItemToAircraftPosition)
      .filter((p): p is NonNullable<typeof p> => p != null)
      .slice(0, limit);
  } else {
    const stored = await listCommunityItems(pool, {
      hours: parseIntQuery(query.hours, 6, 48),
      limit,
      stream: 'aviation',
    });
    positions = stored
      .map(communityItemToAircraftPosition)
      .filter((p): p is NonNullable<typeof p> => p != null);
  }

  return {
    positions,
    fetchedAt,
    dataAvailable: positions.length > 0,
  };
}
