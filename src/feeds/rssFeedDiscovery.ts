/**
 * RSS/Atom feed discovery from arbitrary URLs.
 * Checks direct feed responses, HTML link rel=alternate, and common feed paths.
 * Inspired by feedfinder-style discovery; curated tool index: https://www.en-na.com/#tools
 */

const USER_AGENT = 'Harvest/1.0 RSS-Discovery (+https://harvest.noirstack.com)';

const COMMON_FEED_PATHS = [
  '/feed',
  '/rss',
  '/rss.xml',
  '/atom.xml',
  '/feed.xml',
  '/index.xml',
  '/feeds/posts/default',
  '/blog/feed',
  '/news/feed',
];

export interface DiscoveredFeed {
  feedUrl: string;
  feedType: 'rss' | 'atom' | 'unknown';
  title?: string;
  discoveredVia: 'direct' | 'html-link' | 'path-probe';
}

export interface FeedDiscoveryResult {
  siteUrl: string;
  inputUrl: string;
  isDirectFeed: boolean;
  feeds: DiscoveredFeed[];
}

function normalizeInputUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('URL is required');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return new URL(withScheme);
}

function originOf(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

function resolveHref(base: URL, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function detectFeedType(text: string, contentType = ''): 'rss' | 'atom' | 'unknown' | null {
  const head = text.slice(0, 4000).trim().toLowerCase();
  const ct = contentType.toLowerCase();
  if (
    ct.includes('application/rss') ||
    ct.includes('application/atom') ||
    ct.includes('application/xml') ||
    ct.includes('text/xml') ||
    head.includes('<rss') ||
    head.includes('<feed')
  ) {
    if (head.includes('<feed')) return 'atom';
    if (head.includes('<rss')) return 'rss';
    return 'unknown';
  }
  if (head.startsWith('<?xml') || head.startsWith('<rss') || head.startsWith('<feed')) {
    if (head.includes('<feed')) return 'atom';
    if (head.includes('<rss')) return 'rss';
    return 'unknown';
  }
  return null;
}

async function fetchResource(
  url: string,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<{ ok: boolean; status: number; text: string; contentType: string }> {
  const res = await fetch(url, {
    method,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8,*/*;q=0.5',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  const contentType = res.headers.get('content-type') || '';
  const text = method === 'HEAD' ? '' : await res.text();
  return { ok: res.ok, status: res.status, text, contentType };
}

function extractFeedsFromHtml(html: string, base: URL): DiscoveredFeed[] {
  const feeds: DiscoveredFeed[] = [];
  const seen = new Set<string>();
  const linkRe = /<link\b([^>]*?)>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null) {
    const attrs = match[1] || '';
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase() || '';
    if (!rel.split(/\s+/).includes('alternate')) continue;
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase() || '';
    if (type && !type.includes('rss') && !type.includes('atom') && !type.includes('xml')) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href) continue;
    const feedUrl = resolveHref(base, href);
    if (!feedUrl || seen.has(feedUrl)) continue;
    seen.add(feedUrl);
    const title = /\btitle\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    feeds.push({
      feedUrl,
      feedType: type.includes('atom') ? 'atom' : type.includes('rss') ? 'rss' : 'unknown',
      title,
      discoveredVia: 'html-link',
    });
  }
  return feeds;
}

async function probeFeedUrl(feedUrl: string, via: DiscoveredFeed['discoveredVia']): Promise<DiscoveredFeed | null> {
  try {
    const res = await fetchResource(feedUrl, 'GET');
    if (!res.ok) return null;
    const feedType = detectFeedType(res.text, res.contentType);
    if (!feedType) return null;
    return { feedUrl, feedType, discoveredVia: via };
  } catch {
    return null;
  }
}

export async function discoverFeedsFromUrl(input: string): Promise<FeedDiscoveryResult> {
  const parsed = normalizeInputUrl(input);
  const siteUrl = originOf(parsed);
  const feeds: DiscoveredFeed[] = [];
  const seen = new Set<string>();

  const addFeed = (feed: DiscoveredFeed) => {
    if (seen.has(feed.feedUrl)) return;
    seen.add(feed.feedUrl);
    feeds.push(feed);
  };

  const initial = await fetchResource(parsed.toString(), 'GET');
  if (!initial.ok) {
    throw new Error(`Could not fetch URL (${initial.status})`);
  }

  const directType = detectFeedType(initial.text, initial.contentType);
  if (directType) {
    addFeed({
      feedUrl: parsed.toString(),
      feedType: directType,
      discoveredVia: 'direct',
    });
    return {
      siteUrl,
      inputUrl: parsed.toString(),
      isDirectFeed: true,
      feeds,
    };
  }

  for (const feed of extractFeedsFromHtml(initial.text, parsed)) {
    const verified = await probeFeedUrl(feed.feedUrl, 'html-link');
    addFeed(verified || feed);
  }

  const basePath = parsed.pathname.replace(/\/$/, '') || '';
  for (const suffix of COMMON_FEED_PATHS) {
    const candidate = `${siteUrl}${basePath}${suffix}`;
    if (seen.has(candidate)) continue;
    const verified = await probeFeedUrl(candidate, 'path-probe');
    if (verified) addFeed(verified);
  }

  for (const suffix of COMMON_FEED_PATHS) {
    const candidate = `${siteUrl}${suffix}`;
    if (seen.has(candidate)) continue;
    const verified = await probeFeedUrl(candidate, 'path-probe');
    if (verified) addFeed(verified);
  }

  return {
    siteUrl,
    inputUrl: parsed.toString(),
    isDirectFeed: false,
    feeds,
  };
}
