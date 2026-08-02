/**
 * Pre-built FreshRSS-compatible XPath scraping configurations for websites
 * lacking native RSS feeds. Each entry defines item extraction rules.
 */

export interface FreshRssScrapeConfig {
  name: string;
  siteUrl: string;
  pageUrl: string;
  category: string;
  config: {
    item: string;
    title: string;
    link: string;
    content?: string;
    date?: string;
  };
}

export function freshRssConfigToFeedSeed(cfg: FreshRssScrapeConfig) {
  return {
    name: cfg.name,
    siteUrl: cfg.siteUrl,
    feedUrl: cfg.pageUrl,
    category: cfg.category,
    discoveredVia: 'freshrss-xpath',
    scrapeConfig: cfg.config,
  };
}

export const FRESHRSS_SCRAPE_CONFIGS: FreshRssScrapeConfig[] = [
  {
    name: 'Bloomberg -- Markets',
    siteUrl: 'https://www.bloomberg.com',
    pageUrl: 'https://www.bloomberg.com/markets',
    category: 'financial',
    config: { item: '//div[contains(@class,"storyList")]/div', title: './/a[contains(@class,"headline")]/text()', link: './/a[contains(@class,"headline")]/@href', date: './/time/@datetime' },
  },
  {
    name: 'Reuters -- World',
    siteUrl: 'https://www.reuters.com',
    pageUrl: 'https://www.reuters.com/world/',
    category: 'news',
    config: { item: '//article', title: './/h3|.//h2//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'Financial Times',
    siteUrl: 'https://www.ft.com',
    pageUrl: 'https://www.ft.com/',
    category: 'financial',
    config: { item: '//article', title: './/a[contains(@class,"headline")]//text()', link: './/a[contains(@class,"headline")]/@href', date: './/time/@datetime' },
  },
  {
    name: 'BBC News -- World',
    siteUrl: 'https://www.bbc.com',
    pageUrl: 'https://www.bbc.com/news/world',
    category: 'news',
    config: { item: '//div[contains(@class,"gs-c-promo")]', title: './/h3//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'Al Jazeera -- News',
    siteUrl: 'https://www.aljazeera.com',
    pageUrl: 'https://www.aljazeera.com/news/',
    category: 'news',
    config: { item: '//article', title: './/h3//text()|.//h2//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'The Economist',
    siteUrl: 'https://www.economist.com',
    pageUrl: 'https://www.economist.com/',
    category: 'analysis',
    config: { item: '//article', title: './/h3|.//h2//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'OFAC Sanctions Search',
    siteUrl: 'https://sanctionssearch.ofac.treas.gov',
    pageUrl: 'https://sanctionssearch.ofac.treas.gov/',
    category: 'sanctions',
    config: { item: '//tr[td]', title: './/td[1]//text()', link: './/a/@href', content: './/td[position()>1]//text()' },
  },
  {
    name: 'FATF -- Publications',
    siteUrl: 'https://www.fatf-gafi.org',
    pageUrl: 'https://www.fatf-gafi.org/en/publications.html',
    category: 'regulatory',
    config: { item: '//article', title: './/h3//text()|.//a//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'UN SC -- Press Releases',
    siteUrl: 'https://www.un.org',
    pageUrl: 'https://press.un.org/en/content/security-council/press-release',
    category: 'diplomacy',
    config: { item: '//article|//div[contains(@class,"views-row")]', title: './/h3//text()|.//a//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'NATO -- Newsroom',
    siteUrl: 'https://www.nato.int',
    pageUrl: 'https://www.nato.int/cps/en/natohq/news.htm',
    category: 'security',
    config: { item: '//article|//div[contains(@class,"item")]', title: './/h3//text()|.//a//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'World Bank -- News',
    siteUrl: 'https://www.worldbank.org',
    pageUrl: 'https://www.worldbank.org/en/news',
    category: 'development',
    config: { item: '//article|//div[contains(@class,"news-item")]', title: './/h3//text()|.//a//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'IMF -- News',
    siteUrl: 'https://www.imf.org',
    pageUrl: 'https://www.imf.org/en/News',
    category: 'financial',
    config: { item: '//article|//div[contains(@class,"item")]', title: './/h3//text()|.//a//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'ICIJ -- Investigations',
    siteUrl: 'https://www.icij.org',
    pageUrl: 'https://www.icij.org/investigations/',
    category: 'investigation',
    config: { item: '//article', title: './/h2//text()|.//h3//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'OCCRP -- Daily',
    siteUrl: 'https://www.occrp.org',
    pageUrl: 'https://www.occrp.org/en/daily',
    category: 'investigation',
    config: { item: '//article|//div[contains(@class,"post")]', title: './/h3//text()|.//a//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'SIPRI -- Publications',
    siteUrl: 'https://www.sipri.org',
    pageUrl: 'https://www.sipri.org/publications',
    category: 'security',
    config: { item: '//article|//div[contains(@class,"publication")]', title: './/h3//text()|.//a//text()', link: './/a/@href', date: './/time/@datetime' },
  },
  {
    name: 'BIS -- Press Releases',
    siteUrl: 'https://www.bis.org',
    pageUrl: 'https://www.bis.org/press/index.htm',
    category: 'financial',
    config: { item: '//tr[@class and td]', title: './/td[contains(@class,"title")]//text()', link: './/a/@href', date: './/td[contains(@class,"date")]//text()' },
  },
  {
    name: 'ECB -- Press',
    siteUrl: 'https://www.ecb.europa.eu',
    pageUrl: 'https://www.ecb.europa.eu/press/pr/date/html/index.en.html',
    category: 'financial',
    config: { item: '//article|//div[contains(@class,"category")]', title: './/h3//text()|.//a//text()', link: './/a/@href', date: './/time/@datetime' },
  },
];
