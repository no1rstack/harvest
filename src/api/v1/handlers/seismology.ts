import type { Pool } from 'pg';
import { listCommunityItems } from '../../../feeds/communityStorePg.js';
import { fetchUsgsDisasters } from '../../../feeds/communityLayers.js';
import { communityItemToEarthquake } from '../mappers/sensor.js';
import type { EarthquakeEvent, ListEarthquakesResponse } from '../schemas/sensor.js';
import { parseIntQuery, parseStringQuery } from '../context.js';

export async function listEarthquakes(
  pool: Pool | null,
  query: Record<string, unknown>,
): Promise<ListEarthquakesResponse> {
  const live = parseStringQuery(query.live) === '1' || !pool;
  const limit = parseIntQuery(query.limit, 80, 200);
  const fetchedAt = new Date().toISOString();

  let earthquakes: EarthquakeEvent[] = [];
  if (live) {
    const liveItems = await fetchUsgsDisasters();
    earthquakes = liveItems
      .map(communityItemToEarthquake)
      .filter((e): e is NonNullable<typeof e> => e != null)
      .slice(0, limit);
  } else {
    const stored = await listCommunityItems(pool, {
      hours: parseIntQuery(query.hours, 48, 168),
      limit,
      stream: 'disasters',
      q: 'usgs',
    });
    earthquakes = stored
      .filter((i) => i.id.startsWith('usgs:'))
      .map(communityItemToEarthquake)
      .filter((e): e is NonNullable<typeof e> => e != null);
  }

  return {
    earthquakes,
    fetchedAt,
    dataAvailable: earthquakes.length > 0,
  };
}
