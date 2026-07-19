import {
  getCommunityPullStatusAsync,
  pullFreeLayers,
  pullRssDigest,
  pullSharedCorpus,
  runCommunityDailyPull,
} from '../../../feeds/communityPullWorker.js';
import { getCommunityStats, listStreamStatus } from '../../../feeds/communityStorePg.js';
import type { Pool } from 'pg';

export async function getCommunityStatus(pool: Pool | null) {
  const pull = await getCommunityPullStatusAsync();
  if (!pool) {
    return {
      ...pull,
      apiVersion: 'v1',
      foundation: 'worldmonitor-layout',
    };
  }
  const [streams, stats] = await Promise.all([
    listStreamStatus(pool),
    getCommunityStats(pool, 48),
  ]);
  return {
    ...pull,
    streams,
    stats,
    apiVersion: 'v1',
    foundation: 'worldmonitor-layout',
  };
}

export async function runCommunityPull(which: string) {
  if (which === 'layers') {
    return { which, results: await pullFreeLayers() };
  }
  if (which === 'rss') {
    return { which, result: await pullRssDigest() };
  }
  if (which === 'corpus' || which === 'shared' || which === 'aiid') {
    return { which: 'corpus', results: await pullSharedCorpus() };
  }
  return { which: 'daily', ...(await runCommunityDailyPull()) };
}
