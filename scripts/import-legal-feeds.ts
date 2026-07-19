#!/usr/bin/env tsx
/**
 * One-shot: register legal RSS catalog in Harvest Postgres.
 * Usage: npm run feeds:import:legal
 */
import { getHarvestPool } from '../src/db/harvestPostgres.js';
import { LEGAL_FEED_SEEDS, legalFeedToRegistrySeed } from '../src/feeds/legalFeedSeeds.js';
import { upsertFeedSource } from '../src/feeds/rssFeedRegistry.js';

async function main() {
  const pool = getHarvestPool();
  if (!pool) {
    console.error('HARVEST_DATABASE_URL not configured — run npm run infisical:sync first');
    process.exit(1);
  }
  let n = 0;
  for (const feed of LEGAL_FEED_SEEDS) {
    await upsertFeedSource(pool, {
      ...legalFeedToRegistrySeed(feed),
      enabled: true,
      autoPull: true,
    });
    n++;
  }
  console.log(`[legal-feeds] registered ${n} sources`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
