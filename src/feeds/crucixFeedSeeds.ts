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

/** ─── Crucix Full Pack: 29 API-based OSINT sources ───
 * Extracted from https://github.com/calesthio/crucix (AGPLv3)
 * These are REST/JSON/CSV APIs rather than RSS — register as discoverable source
 * endpoints with metadata for future API-specific collectors.
 */
export interface CrucixApiSeed {
  name: string; siteUrl: string; feedUrl: string;
  category: string; tier: string; description: string;
  auth: 'none' | 'free_key' | 'oauth' | 'paid';
}

export const CRUCIX_API_SEEDS: CrucixApiSeed[] = [
  // Tier 1: Core OSINT & Geopolitical (11)
  { name: 'GDELT — Global Events', siteUrl: 'https://www.gdeltproject.org', feedUrl: 'https://api.gdeltproject.org/api/v2/doc/doc?query=conflict+OR+military+OR+sanctions&mode=ArtList&maxrecords=75&timespan=24h&format=json&sort=DateDesc', category: 'osint_events', tier: '1-osint', description: 'Global news events, conflict mapping in 100+ languages', auth: 'none' },
  { name: 'OpenSky — Flight Tracking', siteUrl: 'https://opensky-network.org', feedUrl: 'https://opensky-network.org/api/states/all', category: 'aviation', tier: '1-osint', description: 'Real-time ADS-B flight tracking across 6 hotspot regions', auth: 'none' },
  { name: 'NASA FIRMS — Fire Detection', siteUrl: 'https://firms.modaps.eosdis.nasa.gov', feedUrl: 'https://firms.modaps.eosdis.nasa.gov/api/area/csv', category: 'satellite', tier: '1-osint', description: 'Satellite fire/thermal anomaly detection (3hr latency)', auth: 'free_key' },
  { name: 'Maritime/AIS — Vessel Tracking', siteUrl: 'https://aisstream.io', feedUrl: 'https://aisstream.io', category: 'maritime', tier: '1-osint', description: 'Vessel tracking, dark ships, sanctions evasion via AIS', auth: 'free_key' },
  { name: 'Safecast — Radiation Monitoring', siteUrl: 'https://safecast.org', feedUrl: 'https://api.safecast.org/measurements.json', category: 'radiation', tier: '1-osint', description: 'Citizen-science radiation monitoring near 6 nuclear sites', auth: 'none' },
  { name: 'ACLED — Armed Conflict Data', siteUrl: 'https://acleddata.com', feedUrl: 'https://acleddata.com/api/acled/read', category: 'conflict', tier: '1-osint', description: 'Armed conflict events: battles, explosions, protests, riots', auth: 'oauth' },
  { name: 'ReliefWeb — UN Humanitarian', siteUrl: 'https://reliefweb.int', feedUrl: 'https://api.reliefweb.int/v1/disasters', category: 'humanitarian', tier: '1-osint', description: 'UN humanitarian crisis tracking, disaster reports', auth: 'none' },
  { name: 'WHO — Disease Outbreaks', siteUrl: 'https://www.who.int', feedUrl: 'https://ghoapi.azureedge.net/api', category: 'health', tier: '1-osint', description: 'Disease outbreaks and health emergencies', auth: 'none' },
  { name: 'OFAC — Sanctions (SDN)', siteUrl: 'https://sanctionssearch.ofac.treas.gov', feedUrl: 'https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML', category: 'sanctions', tier: '1-osint', description: 'US Treasury SDN sanctions list (XML)', auth: 'none' },
  { name: 'OpenSanctions — Global Sanctions', siteUrl: 'https://www.opensanctions.org', feedUrl: 'https://api.opensanctions.org', category: 'sanctions', tier: '1-osint', description: 'Aggregated global sanctions from 30+ sources', auth: 'none' },
  { name: 'ADS-B Exchange — Military Aviation', siteUrl: 'https://www.adsbexchange.com', feedUrl: 'https://globe.adsbexchange.com/data/aircraft.json', category: 'aviation', tier: '1-osint', description: 'Unfiltered flight tracking including military aircraft', auth: 'paid' },
  // Tier 2: Economic & Financial (7)
  { name: 'FRED — Economic Indicators', siteUrl: 'https://fred.stlouisfed.org', feedUrl: 'https://api.stlouisfed.org/fred/series/observations?series_id=GDP&file_type=json', category: 'economics', tier: '2-economic', description: '22 key indicators: yield curve, CPI, VIX, fed funds, M2', auth: 'free_key' },
  { name: 'US Treasury — Fiscal Data', siteUrl: 'https://fiscaldata.treasury.gov', feedUrl: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/debt_to_penny', category: 'economics', tier: '2-economic', description: 'National debt, yields, fiscal data', auth: 'none' },
  { name: 'BLS — Labor Statistics', siteUrl: 'https://www.bls.gov', feedUrl: 'https://api.bls.gov/publicAPI/v2/timeseries/data/', category: 'economics', tier: '2-economic', description: 'CPI, unemployment, nonfarm payrolls, PPI', auth: 'free_key' },
  { name: 'EIA — Energy Data', siteUrl: 'https://www.eia.gov', feedUrl: 'https://api.eia.gov/v2', category: 'energy', tier: '2-economic', description: 'WTI/Brent crude, natural gas, inventories', auth: 'free_key' },
  { name: 'NY Fed GSCPI', siteUrl: 'https://www.newyorkfed.org', feedUrl: 'https://www.newyorkfed.org/medialibrary/research/interactives/data/gscpi/gscpi_interactive_data.csv', category: 'economics', tier: '2-economic', description: 'Global Supply Chain Pressure Index (CSV)', auth: 'none' },
  { name: 'USAspending — Federal Contracts', siteUrl: 'https://www.usaspending.gov', feedUrl: 'https://api.usaspending.gov/api/v2', category: 'government', tier: '2-economic', description: 'Federal spending and defense contracts', auth: 'none' },
  { name: 'UN Comtrade — Trade Flows', siteUrl: 'https://comtrade.un.org', feedUrl: 'https://comtradeapi.un.org/public/v1/preview', category: 'trade', tier: '2-economic', description: 'Strategic commodity trade flows between major powers', auth: 'none' },
  // Tier 3: Environment, Tech, Social, SIGINT (9)
  { name: 'NOAA/NWS — Weather Alerts', siteUrl: 'https://www.weather.gov', feedUrl: 'https://api.weather.gov/alerts/active', category: 'weather', tier: '3-environment', description: 'Active US weather alerts, watches, and warnings', auth: 'none' },
  { name: 'EPA RadNet — US Radiation', siteUrl: 'https://www.epa.gov/radnet', feedUrl: 'https://enviro.epa.gov/enviro/efservice', category: 'radiation', tier: '3-environment', description: 'US government radiation monitoring network', auth: 'none' },
  { name: 'USPTO Patents', siteUrl: 'https://www.uspto.gov', feedUrl: 'https://search.patentsview.org/api/v1/patent/', category: 'technology', tier: '3-environment', description: 'Patent filings in 7 strategic tech areas', auth: 'none' },
  { name: 'Bluesky — Social Sentiment', siteUrl: 'https://bsky.app', feedUrl: 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts', category: 'social', tier: '3-environment', description: 'Social sentiment from Bluesky AT Protocol', auth: 'none' },
  { name: 'Reddit — Social Sentiment', siteUrl: 'https://www.reddit.com', feedUrl: 'https://oauth.reddit.com', category: 'social', tier: '3-environment', description: 'Social sentiment from key subreddits', auth: 'oauth' },
  { name: 'Telegram — OSINT Channels', siteUrl: 'https://t.me', feedUrl: 'https://t.me/s', category: 'osint', tier: '3-environment', description: '17 curated OSINT/conflict/finance Telegram channels', auth: 'none' },
  { name: 'KiwiSDR — HF Radio Network', siteUrl: 'https://kiwisdr.com', feedUrl: 'https://www.receiverbook.de/map?type=kiwisdr', category: 'sigint', tier: '3-environment', description: 'Global HF radio receiver network (~600 receivers)', auth: 'none' },
  { name: 'CISA-KEV — Exploited Vulns', siteUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog', feedUrl: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', category: 'cybersecurity', tier: '3-environment', description: 'Known exploited vulnerabilities from CISA (JSON)', auth: 'none' },
  { name: 'Cloudflare Radar', siteUrl: 'https://radar.cloudflare.com', feedUrl: 'https://api.cloudflare.com/client/v4/radar', category: 'infrastructure', tier: '3-environment', description: 'Internet traffic, attacks, routing anomalies', auth: 'free_key' },
  // Tier 4: Space & Satellites (1)
  { name: 'CelesTrak — Satellite Tracking', siteUrl: 'https://celestrak.org', feedUrl: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle', category: 'space', tier: '4-space', description: 'Satellite launches, ISS, military constellations, Starlink/OneWeb', auth: 'none' },
  // Tier 5: Live Market Data (1)
  { name: 'Yahoo Finance — Live Markets', siteUrl: 'https://finance.yahoo.com', feedUrl: 'https://query1.finance.yahoo.com/v8/finance/chart/SPY', category: 'markets', tier: '5-markets', description: 'Real-time prices: SPY, QQQ, BTC, Gold, WTI, VIX + 9 more', auth: 'none' },
];
