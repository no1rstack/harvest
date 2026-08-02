import { fetchWorldMonitorFeedCatalog, worldMonitorFeedToSeed, filterWorldMonitorCatalog } from '../src/feeds/worldMonitorFeedCatalog';

async function main() {
  console.log('Fetching World Monitor catalog...');
  const catalog = await fetchWorldMonitorFeedCatalog({ refresh: true, cache: false });
  console.log(`Got ${catalog.total} feeds from catalog`);

  const feeds = filterWorldMonitorCatalog(catalog.feeds, { minQuality: 0.5, maxFeeds: 500 });
  console.log(`Filtered to ${feeds.length} feeds`);

  const token = process.env.COLLECTION_INTERNAL_TOKEN || '';
  let registered = 0, skipped = 0, errors = 0;

  for (const feed of feeds) {
    const seed = worldMonitorFeedToSeed(feed);
    try {
      const res = await fetch('http://127.0.0.1:3020/api/feeds/community/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Collection-Token': token },
        body: JSON.stringify({
          name: seed.name,
          siteUrl: seed.siteUrl,
          feedUrl: seed.feedUrl,
          category: seed.category,
          discoveredVia: seed.discoveredVia,
          autoPull: true,
        }),
      });
      if (res.ok) registered++;
      else if (res.status === 409) skipped++;
      else { errors++; console.error(`  Failed ${seed.name}: ${res.status}`); }
    } catch (e) {
      errors++;
    }
    if ((registered + skipped + errors) % 25 === 0) {
      await new Promise(r => setTimeout(r, 150));
      console.log(`  ${registered + skipped + errors}/${feeds.length} (${registered} new, ${skipped} dupes)`);
    }
  }

  console.log(`\nWorld Monitor: ${registered} registered, ${skipped} skipped, ${errors} errors`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
