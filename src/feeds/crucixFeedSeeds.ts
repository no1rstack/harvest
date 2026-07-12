/**
 * Crucix-style regional/news feeds — verified via Harvest RSS discovery.
 * @see https://www.crucix.live/
 */

export interface CuratedFeedSeed {
  name: string;
  siteUrl: string;
  feedUrl: string;
  category: string;
  pack: 'crucix' | 'worldmonitor' | 'harvest';
  notes?: string;
}

/** Feeds used by Crucix-style terminals (site URL → discovered feed URL). */
export const CRUCIX_FEED_SEEDS: CuratedFeedSeed[] = [
  {
    name: 'SBS News Australia',
    siteUrl: 'https://www.sbs.com.au/',
    feedUrl: 'https://www.sbs.com.au/news/feed',
    category: 'geopolitics',
    pack: 'crucix',
  },
  {
    name: 'The Indian Express',
    siteUrl: 'https://indianexpress.com/',
    feedUrl: 'https://indianexpress.com/feed',
    category: 'geopolitics',
    pack: 'crucix',
  },
  {
    name: 'MercoPress',
    siteUrl: 'https://en.mercopress.com/',
    feedUrl: 'https://en.mercopress.com/rss/',
    category: 'geopolitics',
    pack: 'crucix',
    notes: 'Latin America & Mercosur',
  },
  {
    name: 'Al Jazeera English',
    siteUrl: 'https://www.aljazeera.com/',
    feedUrl: 'https://www.aljazeera.com/xml/rss/all.xml',
    category: 'geopolitics',
    pack: 'crucix',
  },
  {
    name: 'Al Jazeera NewsFeed',
    siteUrl: 'https://www.aljazeera.com/video/newsfeed/',
    feedUrl: 'https://www.aljazeera.com/rss',
    category: 'geopolitics',
    pack: 'crucix',
    notes: 'Video/newsfeed page RSS',
  },
];
