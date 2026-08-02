/**
 * FreshRSS-compatible XPath website scraping.
 * Extracts RSS-like items from HTML pages when no native feed exists.
 */

export interface XPathScrapeConfig {
  /** XPath to the item container elements, e.g. "//article" or "//div[@class='news-item']" */
  item?: string;
  /** XPath to the title within each item */
  title?: string;
  /** XPath to the link within each item */
  link?: string;
  /** XPath to the content/body */
  content?: string;
  /** XPath to the date */
  date?: string;
  /** XPath to the author */
  author?: string;
}

export interface ScrapedItem {
  title: string;
  link: string;
  content?: string;
  publishedAt?: string;
  author?: string;
}

function resolveRelative(link: string, baseUrl: string): string {
  if (!link) return link;
  if (link.startsWith('http://') || link.startsWith('https://')) return link;
  try {
    return new URL(link, baseUrl).toString();
  } catch {
    return link;
  }
}

/** Regex-based extraction from an HTML block */
function extractFromBlock(block: string, baseUrl: string): ScrapedItem | null {
  const item: ScrapedItem = { title: '', link: '' };

  // Extract title (first h1-h4 or first link text)
  const titleRe = /<h[1-4][^>]*>(.*?)<\/h[1-4]>/i;
  const t = titleRe.exec(block);
  if (t) item.title = t[1].replace(/<[^>]+>/g, '').trim();

  // Extract link
  const linkRe = /<a[^>]*href=["']([^"']+)["'][^>]*>/i;
  const l = linkRe.exec(block);
  if (l) item.link = resolveRelative(l[1], baseUrl);

  // If no title from heading, try link text
  if (!item.title && l) {
    const textRe = /<a[^>]*>(.*?)<\/a>/i;
    const textMatch = textRe.exec(l[0]);
    if (textMatch) item.title = textMatch[1].replace(/<[^>]+>/g, '').trim();
  }

  // Extract content
  const contentRe = /<(?:p|div)[^>]*>(.*?)<\/(?:p|div)>/i;
  const c = contentRe.exec(block);
  if (c) item.content = c[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);

  // Extract date
  const dateRe = /<(?:time|span)[^>]*datetime=["']([^"']+)["']/i;
  const d = dateRe.exec(block);
  if (d) item.publishedAt = d[1];
  else {
    const metaDateRe = /<(?:time|span)[^>]*>(.*?)<\/(?:time|span)>/i;
    const md = metaDateRe.exec(block);
    if (md) item.publishedAt = md[1].replace(/<[^>]+>/g, '').trim();
  }

  if (item.title && item.link && item.title.length >= 5 && item.title.length <= 300) {
    return item;
  }
  return null;
}

/** Extract RSS-like items from HTML using article/div/list-item blocks */
export function scrapeHtml(html: string, baseUrl: string): ScrapedItem[] {
  const items: ScrapedItem[] = [];
  const seen = new Set<string>();

  // Try <article> blocks
  const articleRegex = /<article[\s>][\s\S]*?<\/article>/gi;
  let match;
  while ((match = articleRegex.exec(html)) !== null) {
    const result = extractFromBlock(match[0], baseUrl);
    if (result && !seen.has(result.link)) {
      seen.add(result.link);
      items.push(result);
    }
  }

  // Try common news-item div patterns
  if (items.length < 10) {
    const patterns = [
      /<div[^>]*class=["'][^"']*(?:post|article|story|news|entry|item|result|card|headline)[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
      /<li[^>]*class=["'][^"']*(?:post|article|story|news|entry)[^"']*["'][^>]*>[\s\S]*?<\/li>/gi,
    ];
    for (const pattern of patterns) {
      let m;
      while ((m = pattern.exec(html)) !== null) {
        const result = extractFromBlock(m[0], baseUrl);
        if (result && !seen.has(result.link)) {
          seen.add(result.link);
          items.push(result);
          if (items.length >= 60) break;
        }
      }
      if (items.length > 10) break;
    }
  }

  // Fallback: extract any a+h element pairs from the full HTML
  if (items.length < 5) {
    const linkMatches = html.matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi);
    for (const lm of linkMatches) {
      if (items.length >= 40) break;
      const link = resolveRelative(lm[1], baseUrl);
      const title = lm[2].replace(/<[^>]+>/g, '').trim();
      if (
        title.length >= 10 && title.length <= 300 &&
        !link.includes('#') && !seen.has(link) &&
        !/^(skip|next|prev|home|menu|login|sign|subscribe|read more)/i.test(title) &&
        !/\.(css|js|png|jpg|gif|svg|ico|xml|json)(\?|$)/i.test(link)
      ) {
        seen.add(link);
        items.push({ title, link });
      }
    }
  }

  return items.slice(0, 80);
}

/** Fetch a URL and scrape it */
export async function fetchAndScrape(url: string): Promise<{
  items: ScrapedItem[];
  total: number;
  error?: string;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Harvest-Collection-Platform/1.0 (+https://harvest.noirstack.com)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) return { items: [], total: 0, error: `HTTP ${res.status}` };
    const html = await res.text();
    const items = scrapeHtml(html, url);
    return { items, total: items.length };
  } catch (err: unknown) {
    return { items: [], total: 0, error: (err as Error).message || String(err) };
  }
}
