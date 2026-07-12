/**
 * Feed enrichment — entities, keywords, and classification for community/RSS items.
 * Lightweight port of Judicium feedPersistence normalization (no external geo DB).
 */

export interface FeedEnrichment {
  keywords: string[];
  entities: string[];
  entity_count: number;
  word_count: number;
  enriched_at: string;
  source: 'rss' | 'layer' | 'ingest' | 'backfill';
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'been', 'were', 'their',
  'will', 'also', 'into', 'more', 'some', 'they', 'what', 'when', 'which', 'about',
  'after', 'would', 'could', 'said', 'like', 'just', 'over', 'than', 'them', 'then',
  'only', 'other', 'year', 'time', 'people', 'your', 'there', 'these', 'those', 'being',
  'under', 'while', 'where', 'through', 'during', 'before', 'between', 'against',
]);

const KNOWN_ENTITIES: Record<string, string[]> = {
  persons: [
    'president', 'prime minister', 'minister', 'secretary', 'chairman', 'king', 'queen',
    'trump', 'biden', 'putin', 'zelenskyy', 'macron', 'scholz', 'stoltenberg',
    'xi jinping', 'modi', 'blinken', 'lavrov', 'musk', 'netanyahu', 'khamenei',
    'guterres', 'meloni', 'erdogan', 'starmer',
  ],
  orgs: [
    'nato', 'united nations', 'european union', 'pentagon', 'white house',
    'kremlin', 'imf', 'world bank', 'opec', 'asean', 'cia', 'fsb', 'fbi',
    'houthi', 'hezbollah', 'hamas', 'isis', 'taliban', 'microsoft', 'google', 'openai',
  ],
  locations: [
    'ukraine', 'russia', 'china', 'israel', 'gaza', 'iran', 'syria', 'yemen',
    'taiwan', 'korea', 'europe', 'london', 'paris', 'berlin', 'washington', 'beijing',
    'moscow', 'kyiv', 'red sea', 'black sea', 'south china sea',
  ],
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractEntities(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const category of Object.values(KNOWN_ENTITIES)) {
    for (const entity of category) {
      if (lower.includes(entity) && !found.includes(entity)) found.push(entity);
    }
  }
  return found.slice(0, 20);
}

export function extractKeywords(text: string, max = 12): string[] {
  const words = stripHtml(text)
    .toLowerCase()
    .split(/[^a-z0-9+#.-]+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

export function refineCategory(title: string, text: string, feedCategory: string): string {
  const combined = `${title} ${text} ${feedCategory}`.toLowerCase();
  if (/war|conflict|battle|strike|missile|troop|militar|invasion|offensive|combat/i.test(combined)) return 'defense';
  if (/sanction|ofac|restrict|embargo|export control|blacklist|freeze/i.test(combined)) return 'sanctions';
  if (/cyber|hack|vuln|malware|ransom|breach|ddos|phish/i.test(combined)) return 'cyber';
  if (/maritime|ship|naval|vessel|sea|port|fleet|coast guard/i.test(combined)) return 'maritime';
  if (/aviation|airline|aircraft|flight|drone|uav|airbase/i.test(combined)) return 'aviation';
  if (/finance|bank|stock|market|economy|inflation|crypto|trade|gdp/i.test(combined)) return 'finance';
  if (/earthquake|flood|hurricane|typhoon|tsunami|volcano|wildfire|storm|cyclone/i.test(combined)) return 'disaster';
  if (/oil|gas|energy|nuclear|renewable|pipeline|power|electricity/i.test(combined)) return 'energy';
  if (/election|president|parliament|congress|senate|vote|democracy/i.test(combined)) return 'government';
  if (/intel|osint|spy|espionage|reconnaissance|surveillance/i.test(combined)) return 'intelligence';
  return feedCategory || 'news';
}

export function buildFeedEnrichment(
  title: string,
  summary: string,
  source: FeedEnrichment['source'] = 'rss',
): FeedEnrichment {
  const combined = `${title} ${summary}`;
  const entities = extractEntities(combined);
  const keywords = extractKeywords(combined);
  const words = stripHtml(combined).split(/\s+/).filter(Boolean);
  return {
    keywords,
    entities,
    entity_count: entities.length,
    word_count: words.length,
    enriched_at: new Date().toISOString(),
    source,
  };
}

export function enrichCommunityPayload(
  item: { title: string; summary?: string; category?: string; stream?: string; payload?: Record<string, unknown> },
): Record<string, unknown> {
  const enrichment = buildFeedEnrichment(
    item.title,
    item.summary || '',
    item.stream === 'rss' ? 'rss' : 'layer',
  );
  const category = refineCategory(item.title, item.summary || '', item.category || 'News');
  return {
    ...(item.payload || {}),
    enrichment,
    refined_category: category !== (item.category || 'News') ? category : undefined,
  };
}
