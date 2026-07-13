/**
 * Public RSS / Atom intel feeds — keyless news & advisory harvest.
 */

import { XMLParser } from 'fast-xml-parser';
import type { Harvester, HarvestFinding } from '../types.js';
import { fetchText } from '../http.js';

const DEFAULT_FEEDS: Array<{ id: string; name: string; url: string }> = [
  {
    id: 'cisa-alerts',
    name: 'CISA Alerts',
    url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml',
  },
  {
    id: 'krebs',
    name: 'Krebs on Security',
    url: 'https://krebsonsecurity.com/feed/',
  },
  {
    id: 'bleepingcomputer',
    name: 'BleepingComputer',
    url: 'https://www.bleepingcomputer.com/feed/',
  },
];

function asArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export const rssHarvester: Harvester = {
  id: 'rss',
  name: 'Public RSS Intel Feeds',
  description: 'Harvest public cybersecurity RSS/Atom feeds; filter by target keyword when set',
  reference: 'https://www.en-na.com/#tools',

  async run(ctx) {
    const started = Date.now();
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    const needle = ctx.target.trim().toLowerCase();
    const feeds = process.env.OSINT_RSS_FEEDS
      ? process.env.OSINT_RSS_FEEDS.split('|').map((pair, i) => {
          const [name, url] = pair.split('::');
          return { id: `custom-${i}`, name: name || `feed-${i}`, url: url || name };
        })
      : DEFAULT_FEEDS;

    for (const feed of feeds) {
      if (findings.length >= ctx.maxResults) break;
      try {
        const xml = await fetchText(feed.url, {
          timeoutMs: Math.min(ctx.timeoutMs, 20000),
          userAgent: ctx.userAgent,
        });
        const doc = parser.parse(xml);
        const items = [
          ...asArray(doc?.rss?.channel?.item),
          ...asArray(doc?.feed?.entry),
        ];

        for (const item of items) {
          if (findings.length >= ctx.maxResults) break;
          const title = String(item.title?.['#text'] ?? item.title ?? '');
          const link = String(
            item.link?.['@_href'] ??
              (typeof item.link === 'string' ? item.link : item.link?.[0]?.['@_href']) ??
              item.guid?.['#text'] ??
              item.id ??
              '',
          );
          const summary = String(
            item.description ?? item.summary?.['#text'] ?? item.summary ?? item.content?.['#text'] ?? '',
          ).replace(/<[^>]+>/g, ' ').slice(0, 1500);
          const published = String(
            item.pubDate ?? item.published ?? item.updated ?? item['dc:date'] ?? '',
          );

          const hay = `${title} ${summary} ${link}`.toLowerCase();
          // If target looks like a domain/org keyword, prefer matches; else take all
          if (needle && needle !== '*' && !hay.includes(needle) && needle.includes('.')) {
            // domain targets: only keep matching items
            if (!hay.includes(needle.split('.')[0])) continue;
          }

          findings.push({
            source: `rss:${feed.id}`,
            sourceId: link || `${feed.id}:${title}`,
            entityType: 'feed_item',
            value: link || title,
            label: title || link,
            title: title || `${feed.name} item`,
            description: summary.slice(0, 500),
            confidence: 0.65,
            tags: ['rss', 'intel', feed.id],
            related: link
              ? [{ type: 'url', value: link, relation: 'from_source' }]
              : undefined,
            raw: {
              feed: feed.name,
              feedId: feed.id,
              feedUrl: feed.url,
              url: link,
              title,
              summary,
            },
            observedAt: published ? new Date(published).toISOString() : undefined,
          });
        }
      } catch (err) {
        errors.push(`rss:${feed.id}: ${(err as Error).message}`);
      }
    }

    return {
      harvester: this.id,
      findings,
      errors,
      durationMs: Date.now() - started,
    };
  },
};
