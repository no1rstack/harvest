/**
 * Wikipedia retrieval — fetch article summaries, infoboxes, revision metadata,
 * categories, and section structure.
 *
 * Uses REST API: https://en.wikipedia.org/api/rest_v1/
 */

import type { WikipediaArticle } from './types';

const WP_REST = 'https://en.wikipedia.org/api/rest_v1';
const WP_API = 'https://en.wikipedia.org/w/api.php';
const USER_AGENT = 'Harvest-Collection-Platform/1.0 (noirstack.com; research@noirstack.com)';

// Type of entity categories we're interested in (taxonomy signal)
const TAXONOMY_CATEGORIES = [
  'organizations', 'companies', 'government', 'politics', 'military',
  'countries', 'cities', 'regions', 'geography',
  'people', 'politicians', 'businesspeople',
  'events', 'conflicts', 'wars', 'terrorism',
  'intelligence', 'espionage', 'cyber',
  'economy', 'trade', 'sanctions', 'crime',
  'technology', 'software', 'hardware', 'networks',
  'health', 'disease', 'pharmaceuticals',
  'energy', 'oil', 'gas', 'mining',
  'law', 'treaties', 'legislation',
];

// ---- Rate limiting ----
let lastWpRequest = 0;
const WP_MIN_DELAY = 100; // ms between Wikipedia API calls

async function wpRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastWpRequest;
  if (elapsed < WP_MIN_DELAY) {
    await new Promise(r => setTimeout(r, WP_MIN_DELAY - elapsed));
  }
  lastWpRequest = Date.now();
}

async function wikipediaApi(params: Record<string, string>): Promise<any> {
  await wpRateLimit();
  const url = new URL(WP_API);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  url.searchParams.set('formatversion', '2');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Wikipedia API error: ${res.status}`);
  return res.json();
}

export async function getPageSummary(title: string): Promise<WikipediaArticle> {
  // Use the page summary endpoint
  const url = `${WP_REST}/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    redirect: 'follow',
  });

  if (!res.ok) throw new Error(`Wikipedia summary error: ${res.status}`);

  const data = await res.json();

  // Check for disambiguation / redirect
  const isDisambig = data.type === 'disambiguation' || data.type === 'standard' && (
    data.title?.startsWith('Category:') || data.title?.startsWith('Template:')
  );

  return {
    pageId: data.pageid || 0,
    title: data.title || title,
    url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    language: 'en',
    extract: data.extract || '',
    extractHtml: data.extract_html,
    sections: [], // summary doesn't include sections
    revisionId: 0,
    lastRevisionTime: data.timestamp || '',
    redirectTarget: data.redirect?.[0]?.to,
    isDisambiguation: isDisambig,
    categories: [],
    thumbnail: data.thumbnail?.source,
    pageImage: data.originalimage?.source,
  };
}

export async function getPageSections(title: string): Promise<Array<{ title: string; level: number; anchor: string }>> {
  const url = `${WP_REST}/page/mobile-sections/${encodeURIComponent(title)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.lead?.sections || data.remaining?.sections || []).map((s: any) => ({
      title: s.line || s.text || '',
      level: s.toclevel || 1,
      anchor: s.anchor || '',
    }));
  } catch {
    return [];
  }
}

export async function getPageCategories(title: string): Promise<string[]> {
  const data = await wikipediaApi({
    action: 'query',
    prop: 'categories',
    titles: title,
    cllimit: '100',
  });
  const pages = data.query?.pages || [];
  const categories: string[] = [];
  for (const page of pages) {
    for (const cat of page.categories || []) {
      const name = cat.title.replace(/^Category:/, '').toLowerCase();
      if (name.startsWith('articles ') || name.startsWith('all articles') ||
          name.includes('with ') || name.includes('pages ') ||
          name.includes('wikipedia ')) continue; // skip maintenance cats
      categories.push(cat.title.replace(/^Category:/, ''));
    }
  }
  return categories.slice(0, 50);
}

export async function getPageInfo(title: string): Promise<{
  pageId: number;
  revisionId: number;
  lastModified: string;
  wordCount: number;
  size: number;
}> {
  const data = await wikipediaApi({
    action: 'query',
    prop: 'info',
    titles: title,
    inprop: 'size|wordcount',
  });
  const page = data.query?.pages?.[0];
  return {
    pageId: page?.pageid || 0,
    revisionId: page?.lastrevid || 0,
    lastModified: page?.touched || '',
    wordCount: page?.wordcount || 0,
    size: page?.length || 0,
  };
}

export async function getInfobox(
  title: string,
): Promise<Record<string, string>> {
  try {
    const data = await wikipediaApi({
      action: 'parse',
      page: title,
      prop: 'text',
      section: '0',
      disabletoc: '1',
      disableeditsection: '1',
    });
    const text: string = data.parse?.text?.['*'] || '';
    const infobox: Record<string, string> = {};

    // Simple regex-based infobox extraction (avoids HTML parser dep)
    // Works for standard {{Infobox ...}} patterns in raw HTML
    const infoboxMatch = text.match(/<table[^>]*infobox[^>]*>([\s\S]*?)<\/table>/i);
    if (!infoboxMatch) return infobox;

    const rows = infoboxMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);
    for (const row of rows) {
      const rowHtml = row[1];
      const th = rowHtml.match(/<th[^>]*>(?:<[^>]+>)*([\s\S]*?)(?:<\/[^>]+>)*<\/th>/i);
      const td = rowHtml.match(/<td[^>]*>(?:<[^>]+>)*([\s\S]*?)(?:<\/[^>]+>)*<\/td>/i);

      if (th && td) {
        const key = th[1].replace(/<[^>]+>/g, '').replace(/&#\d+;/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
        const value = td[1].replace(/<[^>]+>/g, '').replace(/&#\d+;/g, '').trim().replace(/\s+/g, ' ');
        if (key && value && !key.includes('[') && !key.includes('<')) {
          infobox[key] = value;
        }
      }
    }
    return infobox;
  } catch {
    return {};
  }
}

export async function fetchWikipediaArticle(
  title: string,
  fetchDetails: boolean = true,
): Promise<WikipediaArticle> {
  const summary = await getPageSummary(title);

  // If it's a disambiguation or redirect, don't fetch details
  if (summary.redirectTarget || summary.isDisambiguation) {
    return summary;
  }

  if (fetchDetails) {
    const [sections, categories, info, infobox] = await Promise.allSettled([
      getPageSections(title),
      getPageCategories(title),
      getPageInfo(title),
      getInfobox(title),
    ]);

    summary.sections = sections.status === 'fulfilled' ? sections.value : [];
    summary.categories = categories.status === 'fulfilled' ? categories.value : [];
    summary.revisionId = info.status === 'fulfilled' ? info.value.revisionId : 0;
    summary.lastRevisionTime = info.status === 'fulfilled' ? info.value.lastModified : '';
    summary.infobox = infobox.status === 'fulfilled' ? infobox.value : undefined;
    // pageId set from summary already, don't overwrite with info
    if (summary.pageId === 0 && info.status === 'fulfilled') {
      summary.pageId = info.value.pageId;
    }
  }

  return summary;
}

export async function searchWikipediaArticles(query: string, limit: number = 5): Promise<Array<{ title: string; pageId: number; snippet: string }>> {
  const data = await wikipediaApi({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    srprop: 'snippet',
  });
  return (data.query?.search || []).map((r: any) => ({
    title: r.title,
    pageId: r.pageid,
    snippet: r.snippet?.replace(/<[^>]+>/g, '') || '',
  }));
}
