/**
 * Legal / legislation RSS catalog for Judicium community intelligence.
 * Platform tier (curated) + syndicated publishers (Lawyers & Settlements, JD Supra).
 *
 * Site discovery notes:
 * - jurist.org → https://www.jurist.org/feed/ (RSS; no scrape required)
 * - courthousenews.com → https://www.courthousenews.com/feed/
 * - legalnewsfeed.com → https://legalnewsfeed.com/feed/
 * - JD Supra topical feeds: https://www.jdsupra.com/topics/{slug}_rss/
 *   @see https://www.jdsupra.com/legal-news/rss-law-feeds.aspx
 * - Cornell LII Wex taxonomy: https://www.law.cornell.edu/taxonomy/term/{id}/feed
 *   @see https://www.law.cornell.edu/
 */

export interface LegalFeedSeed {
  name: string;
  siteUrl: string;
  feedUrl: string;
  category: 'legislation';
  pack: 'legal';
  publisher: 'lawyersandsettlements' | 'jdsupra' | 'court' | 'legal-news' | 'government' | 'cornell-lii' | 'govinfo' | 'courtlistener';
  notes?: string;
}

const LII = 'https://www.law.cornell.edu';

const LNS = 'https://feeds.feedburner.com/lawyersandsettlements';

/** Always-on platform legal baseline (live pull without DB registry). */
export const LEGAL_PLATFORM_FEEDS: LegalFeedSeed[] = [
  {
    name: 'Jurist',
    siteUrl: 'https://www.jurist.org/',
    feedUrl: 'https://www.jurist.org/feed/',
    category: 'legislation',
    pack: 'legal',
    publisher: 'legal-news',
    notes: 'Legal news & commentary — RSS at /feed/',
  },
  {
    name: 'Courthouse News',
    siteUrl: 'https://www.courthousenews.com/',
    feedUrl: 'https://www.courthousenews.com/feed/',
    category: 'legislation',
    pack: 'legal',
    publisher: 'court',
  },
  {
    name: 'Legal News Feed',
    siteUrl: 'https://legalnewsfeed.com/',
    feedUrl: 'https://legalnewsfeed.com/feed/',
    category: 'legislation',
    pack: 'legal',
    publisher: 'legal-news',
  },
  {
    name: 'Lawyers & Settlements — Main',
    siteUrl: 'https://www.lawyersandsettlements.com/',
    feedUrl: `${LNS}/main`,
    category: 'legislation',
    pack: 'legal',
    publisher: 'lawyersandsettlements',
  },
  {
    name: 'JD Supra — Legal Alerts (All)',
    siteUrl: 'https://www.jdsupra.com/',
    feedUrl: 'https://www.jdsupra.com/topics/legal-alerts_rss/',
    category: 'legislation',
    pack: 'legal',
    publisher: 'jdsupra',
    notes: 'Topical catalog: https://www.jdsupra.com/legal-news/rss-law-feeds.aspx',
  },
  {
    name: 'Cornell LII — Constitutional Law (Wex)',
    siteUrl: LII,
    feedUrl: `${LII}/taxonomy/term/122/feed`,
    category: 'legislation',
    pack: 'legal',
    publisher: 'cornell-lii',
    notes: 'Wex taxonomy RSS — authoritative legal definitions',
  },
];

/** Lawyers & Settlements Feedburner series. */
export const LAWYERS_AND_SETTLEMENTS_FEEDS: LegalFeedSeed[] = [
  { name: 'L&S — Hot Legal Issues', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/hot-legal-issues`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Settlements', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/settlements`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Legal News', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/legal-news`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Accidents', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/accidents`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Antitrust', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/antitrust`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Automotive', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/automotive`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Bankruptcy', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/bankruptcy`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Business', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/business`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Civil & Human Rights', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/civil-human-rights`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Consumer Banking', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/consumer-banking`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Consumer Fraud', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/consumer-fraud`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Criminal Law', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/criminal-law`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Employment', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/employment`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Drugs & Medical', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/drugs-medical`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Malpractice', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/malpractice`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Securities', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/securities`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Whistleblower', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/whistleblower`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
  { name: 'L&S — Discrimination', siteUrl: 'https://www.lawyersandsettlements.com/', feedUrl: `${LNS}/discrimination`, category: 'legislation', pack: 'legal', publisher: 'lawyersandsettlements' },
];

/** JD Supra topical law feeds ({slug}_rss pattern). */
export const JDSUPRA_TOPIC_FEEDS: LegalFeedSeed[] = [
  ['JD Supra — Agriculture', 'agriculture'],
  ['JD Supra — ADR', 'alternative-dispute-resolution-adr'],
  ['JD Supra — Antitrust & Trade', 'antitrust-trade-regulation'],
  ['JD Supra — Bankruptcy', 'bankruptcy-law'],
  ['JD Supra — Civil Rights', 'civil-rights-constitutional-law'],
  ['JD Supra — Consumer Protection', 'consumer-protection'],
  ['JD Supra — Criminal Law', 'criminal-law'],
  ['JD Supra — Environmental Law', 'environmental-law'],
  ['JD Supra — Finance & Banking', 'finance-banking'],
  ['JD Supra — Immigration', 'immigration-law'],
  ['JD Supra — Intellectual Property', 'intellectual-property'],
  ['JD Supra — Labor & Employment', 'labor-employment-law'],
  ['JD Supra — Personal Injury', 'personal-injury-products-liability'],
  ['JD Supra — Privacy', 'privacy'],
  ['JD Supra — Securities', 'securities-law'],
  ['JD Supra — Workers Compensation', 'workers-compensation'],
].map(([name, slug]) => ({
  name,
  siteUrl: 'https://www.jdsupra.com/',
  feedUrl: `https://www.jdsupra.com/topics/${slug}_rss/`,
  category: 'legislation' as const,
  pack: 'legal' as const,
  publisher: 'jdsupra' as const,
}));

/** Cornell LII Wex taxonomy RSS — term IDs from law.cornell.edu subject areas. */
export const CORNELL_LII_FEEDS: LegalFeedSeed[] = [
  { name: 'LII Wex — Business Law', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/118/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
  { name: 'LII Wex — Constitutional Law', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/122/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
  { name: 'LII Wex — Criminal Law & Procedure', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/124/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
  { name: 'LII Wex — Employment Law', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/126/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
  { name: 'LII Wex — Family Law', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/128/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
  { name: 'LII Wex — Money & Financial Problems', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/948/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
  { name: 'LII Wex — Civil Procedure', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/120/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
  { name: 'LII Wex — Immigration Law', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/130/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
  { name: 'LII Wex — Intellectual Property', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/132/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
  { name: 'LII Wex — Real Estate Law', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/134/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
  { name: 'LII Wex — Taxation', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/136/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
  { name: 'LII Wex — Administrative Law', siteUrl: LII, feedUrl: `${LII}/taxonomy/term/138/feed`, category: 'legislation', pack: 'legal', publisher: 'cornell-lii' },
];

/** Official federal publications + case law RSS (Tracelaw / GovInfo stack). */
export const FREE_LEGAL_AUTHORITY_FEEDS: LegalFeedSeed[] = [
  { name: 'GovInfo — Public Laws', siteUrl: 'https://www.govinfo.gov/', feedUrl: 'https://www.govinfo.gov/rss/plaw.xml', category: 'legislation', pack: 'legal', publisher: 'govinfo' },
  { name: 'GovInfo — U.S. Code', siteUrl: 'https://www.govinfo.gov/', feedUrl: 'https://www.govinfo.gov/rss/uscode.xml', category: 'legislation', pack: 'legal', publisher: 'govinfo' },
  { name: 'GovInfo — Congressional Bills', siteUrl: 'https://www.govinfo.gov/', feedUrl: 'https://www.govinfo.gov/rss/bills.xml', category: 'legislation', pack: 'legal', publisher: 'govinfo' },
  { name: 'GovInfo — Congressional Reports', siteUrl: 'https://www.govinfo.gov/', feedUrl: 'https://www.govinfo.gov/rss/crpt.xml', category: 'legislation', pack: 'legal', publisher: 'govinfo' },
  { name: 'GovInfo — Congressional Hearings', siteUrl: 'https://www.govinfo.gov/', feedUrl: 'https://www.govinfo.gov/rss/chrg.xml', category: 'legislation', pack: 'legal', publisher: 'govinfo' },
  { name: 'Federal Register', siteUrl: 'https://www.federalregister.gov/', feedUrl: 'https://www.federalregister.gov/api/v1/articles.rss', category: 'legislation', pack: 'legal', publisher: 'government' },
  { name: 'CourtListener — Latest Opinions', siteUrl: 'https://www.courtlistener.com/', feedUrl: 'https://www.courtlistener.com/feeds/latest-opinions.xml', category: 'legislation', pack: 'legal', publisher: 'courtlistener', notes: 'Free Law Project — may rate-limit some egress' },
  { name: 'CourtListener — Oral Arguments', siteUrl: 'https://www.courtlistener.com/', feedUrl: 'https://www.courtlistener.com/feeds/oral-arguments.xml', category: 'legislation', pack: 'legal', publisher: 'courtlistener' },
  { name: 'DOJ News', siteUrl: 'https://www.justice.gov/', feedUrl: 'https://www.justice.gov/feeds/justice-news.xml', category: 'legislation', pack: 'legal', publisher: 'government' },
];

/** Government / court system feeds (may be rate-limited off-VPS). */
export const LEGAL_GOVERNMENT_FEEDS: LegalFeedSeed[] = [
  {
    name: 'US Courts — News',
    siteUrl: 'https://www.uscourts.gov/',
    feedUrl: 'https://www.uscourts.gov/news/rss',
    category: 'legislation',
    pack: 'legal',
    publisher: 'government',
    notes: 'Federal judiciary news RSS — intermittent 503 from some egress IPs',
  },
];

/** Sites to auto-discover RSS when importing the legal pack (fallback if catalog URLs change). */
export const LEGAL_DISCOVERY_SITES = [
  'https://www.jurist.org/',
  'https://www.courthousenews.com/',
  'https://legalnewsfeed.com/',
  'https://www.jdsupra.com/legal-news/rss-law-feeds.aspx',
  'https://www.law.cornell.edu/',
  'https://www.law.cornell.edu/wex',
  'https://www.justia.com/',
  'https://www.findlaw.com/',
  'https://www.courtlistener.com/',
  'https://www.govinfo.gov/',
];

export const LEGAL_FEED_SEEDS: LegalFeedSeed[] = [
  ...LEGAL_PLATFORM_FEEDS,
  ...LAWYERS_AND_SETTLEMENTS_FEEDS.filter(
    (f) => !LEGAL_PLATFORM_FEEDS.some((p) => p.feedUrl === f.feedUrl),
  ),
  ...JDSUPRA_TOPIC_FEEDS.filter(
    (f) => !LEGAL_PLATFORM_FEEDS.some((p) => p.feedUrl === f.feedUrl),
  ),
  ...CORNELL_LII_FEEDS.filter(
    (f) => !LEGAL_PLATFORM_FEEDS.some((p) => p.feedUrl === f.feedUrl),
  ),
  ...FREE_LEGAL_AUTHORITY_FEEDS.filter(
    (f) => !LEGAL_PLATFORM_FEEDS.some((p) => p.feedUrl === f.feedUrl),
  ),
  ...LEGAL_GOVERNMENT_FEEDS,
];

export function filterLegalFeedCatalog(options?: {
  publisher?: string;
  q?: string;
  limit?: number;
}): LegalFeedSeed[] {
  let feeds = [...LEGAL_FEED_SEEDS];
  if (options?.publisher) {
    const p = options.publisher.toLowerCase();
    feeds = feeds.filter((f) => f.publisher === p);
  }
  if (options?.q) {
    const q = options.q.toLowerCase();
    feeds = feeds.filter(
      (f) => f.name.toLowerCase().includes(q) || f.feedUrl.toLowerCase().includes(q),
    );
  }
  const limit = Math.min(options?.limit ?? 200, 500);
  return feeds.slice(0, limit);
}

export function legalFeedToRegistrySeed(feed: LegalFeedSeed) {
  return {
    name: feed.name,
    siteUrl: feed.siteUrl,
    feedUrl: feed.feedUrl,
    category: feed.category,
    discoveredVia: `legal:${feed.publisher}`,
  };
}
