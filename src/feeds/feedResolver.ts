/**
 * FeedResolver — broken-feed recovery + proactive feed discovery.
 *
 * When a configured feed URL fails, the resolver takes the site/domain and tries, in order:
 *   1. Fetch the broken URL directly → is it actually a valid feed?
 *   2. Fetch the parent/root website → inspect HTML <head>
 *      for <link rel="alternate" type="application/rss+xml" …>
 *   3. Probe conventional endpoints: /feed, /feed/, /rss, /rss.xml,
 *      /feed.xml, /atom.xml, /index.xml, /?feed=rss2
 *   4. Follow redirects → validate returned XML
 *   5. Score candidates → return best
 */

const USER_AGENT = 'Harvest/1.0 FeedResolver (+https://harvest.noirstack.com)';
const FETCH_TIMEOUT_MS = 15_000;

// ── types ────────────────────────────────────────────────────────────────

export interface FeedCandidate {
  feedUrl: string;
  feedType: 'rss' | 'atom' | 'rdf' | 'unknown';
  title?: string;
  itemCount: number;
  newestItemDate?: string;
  siteUrl: string;
  discoveredVia: 'direct' | 'html-link' | 'path-probe' | 'redirect';
  score: number;
  scoreReasons: string[];
  error?: string;
  isViable: boolean;
}

export interface FeedRepairResult {
  originalUrl: string;
  siteUrl: string;
  resolutionMethod: 'autodiscovery' | 'path-probe' | 'none';
  candidates: FeedCandidate[];
  best: FeedCandidate | null;
  autoRepairEligible: boolean;
  suggestion: 'auto-repair' | 'recommend' | 'show-only' | 'none';
}

export interface DiscoverResult {
  siteUrl: string;
  inputUrl: string;
  isDirectFeed: boolean;
  feeds: Array<{
    feedUrl: string;
    feedType: FeedCandidate['feedType'];
    title?: string;
    itemCount: number;
    newestItemDate?: string;
    discoveredVia: FeedCandidate['discoveredVia'];
    score: number;
    scoreReasons: string[];
  }>;
}

// ── helpers ──────────────────────────────────────────────────────────────

function originOf(u: { protocol: string; host: string }): string {
  return `${u.protocol}//${u.host}`;
}

function resolveHref(base: URL, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function sameHost(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.hostname.replace(/^www\./, '') === ub.hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}

// ── feed detection ────────────────────────────────────────────────────────

function detectFeedMeta(
  text: string,
  contentType: string,
): { feedType: FeedCandidate['feedType']; title?: string; itemCount: number; newestItemDate?: string } | null {
  const head = text.slice(0, 8000).trim();
  const ct = contentType.toLowerCase();
  const lowerHead = head.toLowerCase();

  // Quick HTML rejection — if it starts like an HTML page, it's NOT a feed
  if (lowerHead.startsWith('<!doctype') || lowerHead.startsWith('<html') || /^<\s*html/i.test(head)) {
    return null;
  }

  // Content-type signals
  const xmlContentTypes = ['application/rss+xml', 'application/atom+xml', 'application/xml', 'text/xml'];
  const hasValidContentType = xmlContentTypes.some((t) => ct.includes(t));

  // XML structure detection
  let feedType: FeedCandidate['feedType'] = 'unknown';

  if (lowerHead.includes('<rss') || lowerHead.includes('<rdf:rdf') || lowerHead.includes('<rdf')) {
    feedType = 'rss';
    if (lowerHead.includes('xmlns:rdf') || lowerHead.includes('<rdf:rdf')) feedType = 'rdf';
  } else if (lowerHead.includes('<feed')) {
    feedType = 'atom';
  } else if (hasValidContentType && (head.startsWith('<?xml') || lowerHead.includes('<?xml'))) {
    feedType = 'unknown';
  } else if (!hasValidContentType && !lowerHead.includes('<?xml')) {
    return null; // Not XML at all
  }

  if (feedType === 'unknown' && !hasValidContentType) {
    return null;
  }

  // Title extraction
  let title: string | undefined;
  const channelTitle = /<title[^>]*>([^<]*)<\/title>/i;
  const titleMatch = channelTitle.exec(head.slice(0, 2000));
  if (titleMatch) title = titleMatch[1].trim() || undefined;

  // Item/entry count
  let itemCount = 0;
  if (feedType === 'rss' || feedType === 'rdf') {
    const itemMatches = lowerHead.match(/<item[\s>]/gi);
    itemCount = itemMatches ? itemMatches.length : 0;
  } else {
    const entryMatches = lowerHead.match(/<entry[\s>]/gi);
    itemCount = entryMatches ? entryMatches.length : 0;
  }

  // Newest pubDate
  let newestItemDate: string | undefined;
  if (feedType === 'rss' || feedType === 'rdf') {
    const pubMatch = /<pubdate[^>]*>([^<]*)<\/pubdate>/i.exec(head);
    if (pubMatch) newestItemDate = pubMatch[1].trim();
  } else {
    const updatedMatch = /<updated[^>]*>([^<]*)<\/updated>/i.exec(head);
    if (updatedMatch) newestItemDate = updatedMatch[1].trim();
  }

  return { feedType, title, itemCount, newestItemDate };
}

function isStale(newestItemDate?: string): boolean {
  if (!newestItemDate) return false;
  try {
    const d = new Date(newestItemDate).getTime();
    const yearMs = 365 * 24 * 60 * 60 * 1000;
    return Date.now() - d > yearMs;
  } catch {
    return false;
  }
}

// ── scoring ───────────────────────────────────────────────────────────────

function scoreCandidate(
  candidate: FeedCandidate,
  siteUrl: string,
): FeedCandidate {
  const reasons: string[] = [];
  let score = 0;

  // +50 HTML explicitly advertises feed
  if (candidate.discoveredVia === 'html-link') {
    score += 50;
    reasons.push('HTML autodiscovery link found');
  }

  // +20 valid RSS/Atom/RDF XML
  if (candidate.feedType !== 'unknown') {
    score += 20;
    reasons.push(`valid ${candidate.feedType.toUpperCase()} XML`);
  }

  // +10 same hostname
  if (sameHost(candidate.feedUrl, siteUrl)) {
    score += 10;
    reasons.push('same hostname');
  }

  // +10 contains recent entries
  if (candidate.itemCount > 0 && !isStale(candidate.newestItemDate)) {
    score += 10;
    reasons.push(`${candidate.itemCount} entries, recent publication`);
  } else if (candidate.itemCount > 0) {
    score += 5;
    reasons.push(`${candidate.itemCount} entries`);
  }

  // +5 has title
  if (candidate.title) reasons.push(`title: "${candidate.title}"`);

  // -20 redirects to unrelated domain
  if (candidate.discoveredVia === 'redirect' && !sameHost(candidate.feedUrl, siteUrl)) {
    score -= 20;
    reasons.push('redirects to unrelated domain');
  }

  // -20 zero entries
  if (candidate.itemCount === 0) {
    score -= 20;
    reasons.push('no items found');
  }

  // -30 stale for >1 year
  if (isStale(candidate.newestItemDate)) {
    score -= 30;
    reasons.push('stale — no recent publications');
  }

  // -15 unrecognized format
  if (candidate.feedType === 'unknown') {
    score -= 15;
    reasons.push('unrecognized feed format');
  }

  return { ...candidate, score, scoreReasons: reasons };
}

// ── HTTP fetch ────────────────────────────────────────────────────────────

async function fetchResource(
  url: string,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<{ ok: boolean; status: number; text: string; contentType: string; finalUrl: string }> {
  const res = await fetch(url, {
    method,
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8,*/*;q=0.5',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const contentType = res.headers.get('content-type') || '';
  const text = method === 'HEAD' ? '' : await res.text();
  return { ok: res.ok, status: res.status, text, contentType, finalUrl: res.url };
}

// ── autodiscovery from HTML ──────────────────────────────────────────────

interface DiscoveredFeedRef {
  feedUrl: string;
  feedType: FeedCandidate['feedType'];
  title?: string;
  discoveredVia: FeedCandidate['discoveredVia'];
}

const CONVENTIONAL_PATHS = [
  '/feed',
  '/rss',
  '/feed.xml',
  '/rss.xml',
  '/atom.xml',
  '/index.xml',
  '/?feed=rss2',
  '/feeds/posts/default',
  '/blog/feed',
  '/news/feed',
  '/news/rss',
  '/category/feed',
];

function extractFeedsFromHtml(html: string, base: URL): DiscoveredFeedRef[] {
  const feeds: DiscoveredFeedRef[] = [];
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

// ── probe a URL for feed content ──────────────────────────────────────────

async function probeUrl(
  url: string,
  siteUrl: string,
  discoveredVia: FeedCandidate['discoveredVia'],
): Promise<FeedCandidate | null> {
  try {
    const res = await fetchResource(url);
    if (!res.ok) return null;

    const meta = detectFeedMeta(res.text, res.contentType);
    if (!meta) return null;

    const finalUrl = res.finalUrl !== url ? res.finalUrl : url;

    const candidate: FeedCandidate = {
      feedUrl: finalUrl,
      feedType: meta.feedType,
      title: meta.title,
      itemCount: meta.itemCount,
      newestItemDate: meta.newestItemDate,
      siteUrl,
      discoveredVia: res.finalUrl !== url ? 'redirect' : discoveredVia,
      score: 0,
      scoreReasons: [],
      isViable: true,
    };

    return scoreCandidate(candidate, siteUrl);
  } catch {
    return null;
  }
}

// ── main resolver ─────────────────────────────────────────────────────────

export async function resolveFeed(
  inputUrl: string,
): Promise<FeedRepairResult> {
  const parsed = (() => {
    const trimmed = inputUrl.trim();
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme);
  })();

  const siteUrl = originOf(parsed);
  const candidates: FeedCandidate[] = [];

  // Step 1: Try fetching the input URL directly as a feed
  {
    const direct = await probeUrl(parsed.toString(), siteUrl, 'direct');
    if (direct) {
      direct.isViable = direct.feedType !== 'unknown';
      candidates.push(direct);
    }
  }

  // Step 2: Fetch the parent/root website, inspect HTML
  let htmlDiscovered = false;
  {
    try {
      const siteRes = await fetchResource(siteUrl);
      if (siteRes.ok) {
        const discovered = extractFeedsFromHtml(siteRes.text, new URL(siteUrl));
        for (const d of discovered) {
          const probed = await probeUrl(d.feedUrl, siteUrl, 'html-link');
          if (probed) {
            probed.isViable = true;
            candidates.push(probed);
            htmlDiscovered = true;
          }
        }
      }
    } catch {
      // parent site fetch failed; continue to path probing
    }
  }

  // Step 3: Probe conventional endpoints
  if (!htmlDiscovered || candidates.length === 0) {
    const seen = new Set(candidates.map((c) => c.feedUrl));
    const basePath = parsed.pathname.replace(/\/[^/]*$/, '').replace(/\/$/, '') || '';

    // Paths relative to the base path first
    for (const suffix of CONVENTIONAL_PATHS) {
      const candidate = `${siteUrl}${basePath}${suffix}`;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const probed = await probeUrl(candidate, siteUrl, 'path-probe');
      if (probed) {
        probed.isViable = true;
        candidates.push(probed);
      }
    }

    // Then root-level paths
    for (const suffix of CONVENTIONAL_PATHS) {
      const candidate = `${siteUrl}${suffix}`;
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const probed = await probeUrl(candidate, siteUrl, 'path-probe');
      if (probed) {
        probed.isViable = true;
        candidates.push(probed);
      }
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Deduplicate by feedUrl, keeping the highest-scored entry
  const seen = new Map<string, FeedCandidate>();
  for (const c of candidates) {
    const existing = seen.get(c.feedUrl);
    if (!existing || c.score > existing.score) {
      seen.set(c.feedUrl, c);
    }
  }
  const deduped = Array.from(seen.values()).sort((a, b) => b.score - a.score);

  const best = deduped.length > 0 ? deduped[0] : null;

  let suggestion: FeedRepairResult['suggestion'] = 'none';
  let autoRepairEligible = false;

  if (best) {
    if (best.score >= 90) {
      autoRepairEligible = true;
      suggestion = 'auto-repair';
    } else if (best.score >= 70) {
      suggestion = 'recommend';
    } else {
      suggestion = 'show-only';
    }
  }

  return {
    originalUrl: parsed.toString(),
    siteUrl,
    resolutionMethod:
      htmlDiscovered ? 'autodiscovery' :
      deduped.length > 0 ? 'path-probe' :
      'none',
    candidates: deduped,
    best,
    autoRepairEligible,
    suggestion,
  };
}

// ── proactive discovery ───────────────────────────────────────────────────

export async function discoverFeeds(url: string): Promise<DiscoverResult> {
  const parsed = (() => {
    const trimmed = url.trim();
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withScheme);
  })();

  const siteUrl = originOf(parsed);
  const candidates: Array<{
    feedUrl: string;
    feedType: FeedCandidate['feedType'];
    title?: string;
    itemCount: number;
    newestItemDate?: string;
    discoveredVia: FeedCandidate['discoveredVia'];
    score: number;
    scoreReasons: string[];
  }> = [];

  // Check if the URL itself is a direct feed
  {
    const direct = await probeUrl(parsed.toString(), siteUrl, 'direct');
    if (direct) {
      candidates.push({
        feedUrl: direct.feedUrl,
        feedType: direct.feedType,
        title: direct.title,
        itemCount: direct.itemCount,
        newestItemDate: direct.newestItemDate,
        discoveredVia: direct.discoveredVia,
        score: direct.score,
        scoreReasons: direct.scoreReasons,
      });
      return {
        siteUrl,
        inputUrl: parsed.toString(),
        isDirectFeed: true,
        feeds: candidates,
      };
    }
  }

  // Try HTML autodiscovery from site root
  try {
    const siteRes = await fetchResource(siteUrl);
    if (siteRes.ok) {
      const discovered = extractFeedsFromHtml(siteRes.text, new URL(siteUrl));
      for (const d of discovered) {
        const probed = await probeUrl(d.feedUrl, siteUrl, 'html-link');
        if (probed) {
          candidates.push({
            feedUrl: probed.feedUrl,
            feedType: probed.feedType,
            title: probed.title,
            itemCount: probed.itemCount,
            newestItemDate: probed.newestItemDate,
            discoveredVia: probed.discoveredVia,
            score: probed.score,
            scoreReasons: probed.scoreReasons,
          });
        }
      }
    }
  } catch {
    // continue to path probing
  }

  // Probe conventional paths
  if (candidates.length === 0) {
    const seenUrls = new Set(candidates.map((c) => c.feedUrl));
    for (const suffix of CONVENTIONAL_PATHS) {
      const candidateUrl = `${siteUrl}${suffix}`;
      if (seenUrls.has(candidateUrl)) continue;
      seenUrls.add(candidateUrl);
      const probed = await probeUrl(candidateUrl, siteUrl, 'path-probe');
      if (probed) {
        candidates.push({
          feedUrl: probed.feedUrl,
          feedType: probed.feedType,
          title: probed.title,
          itemCount: probed.itemCount,
          newestItemDate: probed.newestItemDate,
          discoveredVia: probed.discoveredVia,
          score: probed.score,
          scoreReasons: probed.scoreReasons,
        });
      }
    }
  }

  // Deduplicate by feedUrl
  const dedupMap = new Map<string, typeof candidates[0]>();
  for (const c of candidates) {
    const existing = dedupMap.get(c.feedUrl);
    if (!existing || c.score > existing.score) {
      dedupMap.set(c.feedUrl, c);
    }
  }

  return {
    siteUrl,
    inputUrl: parsed.toString(),
    isDirectFeed: false,
    feeds: Array.from(dedupMap.values()),
  };
}

// ── repair flow ───────────────────────────────────────────────────────────

export interface RepairInput {
  feedUrl: string;
  siteUrl: string;
}

export async function repairFeed(
  input: RepairInput,
): Promise<FeedRepairResult> {
  let result = await resolveFeed(input.feedUrl);

  // If nothing found at the feed URL, try the site root
  if (result.suggestion === 'none' && input.siteUrl) {
    result = await resolveFeed(input.siteUrl);
  }

  return result;
}
