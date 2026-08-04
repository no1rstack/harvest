#!/usr/bin/env python3
"""Configure free tier API collectors for Harvest from ENNA recommendations."""
import json, subprocess, sys, os

TOKEN = '3a1a8161158458555b82dad3633fea90431b00995b83b42d'
FEEDS_API = 'http://127.0.0.1:3020/api/feeds/community/sources'

FREE_APIS = [
    {'name': 'USGS Earthquakes M4.5+', 'feed_url': 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.atom', 'category': 'natural-disasters', 'note': 'Free, no key'},
    {'name': 'GDACS Disaster Alerts', 'feed_url': 'https://www.gdacs.org/xml/rss.xml', 'category': 'natural-disasters', 'note': 'Free, UN-coordinated'},
    {'name': 'NASA EONET Events', 'feed_url': 'https://eonet.gsfc.nasa.gov/api/v3/events?status=open', 'category': 'natural-disasters', 'note': 'Free'},
    {'name': 'Feodo Tracker (abuse.ch)', 'feed_url': 'https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt', 'category': 'cyber-threat', 'note': 'Free'},
    {'name': 'URLhaus (abuse.ch)', 'feed_url': 'https://urlhaus.abuse.ch/downloads/csv_recent/', 'category': 'cyber-threat', 'note': 'Free'},
    {'name': 'AlienVault OTX Pulses', 'feed_url': 'https://otx.alienvault.com/api/v1/pulses/subscribed?page=1', 'category': 'cyber-threat', 'note': 'Free 10k pulses/day'},
    {'name': 'Ransomware.live Feed', 'feed_url': 'https://ransomware.live/rss.xml', 'category': 'cyber-threat', 'note': 'Free'},
    {'name': 'OpenSky Network ADS-B', 'feed_url': 'https://opensky-network.org/api/states/all', 'category': 'aviation', 'note': 'Free generous tier'},
    {'name': 'CoinGecko Crypto Prices', 'feed_url': 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1', 'category': 'crypto', 'note': 'Free 10-30 calls/min'},
    {'name': 'CelesTrak Satellite TLE', 'feed_url': 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle', 'category': 'space', 'note': 'Free'},
    {'name': 'Open-Meteo Climate ERA5', 'feed_url': 'https://api.open-meteo.com/v1/era5', 'category': 'climate', 'note': 'Free'},
    {'name': 'Polymarket Geopolitical', 'feed_url': 'https://gamma-api.polymarket.com/events?tag=geopolitics', 'category': 'markets', 'note': 'Free'},
    {'name': 'Cloudflare Radar Outages', 'feed_url': 'https://radar.cloudflare.com/outage-center', 'category': 'infrastructure', 'note': 'Free'},
    {'name': 'UN OCHA Humanitarian', 'feed_url': 'https://hapi.humdata.org/api/data', 'category': 'humanitarian', 'note': 'Free'},
    {'name': 'GDELT Global Events', 'feed_url': 'https://api.gdeltproject.org/api/v2/doc/doc?query=protest&mode=artlist&format=rss', 'category': 'conflict', 'note': 'Free, no key'},
]

PAID_FREE_TIER = [
    {'name': 'AviationStack Flights', 'feed_url': 'https://api.aviationstack.com/v1/flights', 'category': 'aviation', 'note': 'FREE TIER: 500 req/month. Set AVIATIONSTACK_API_KEY'},
    {'name': 'ACLED Conflict Data', 'feed_url': 'https://api.acleddata.com/acled/read', 'category': 'conflict', 'note': 'FREE TIER: Registration required. Set ACLED_ACCESS_TOKEN'},
    {'name': 'AbuseIPDB Reputation', 'feed_url': 'https://api.abuseipdb.com/api/v2/blacklist', 'category': 'cyber-threat', 'note': 'FREE TIER: 1,000 lookups/day. Set ABUSEIPDB_API_KEY'},
    {'name': 'ipinfo.io Geolocation', 'feed_url': 'https://ipinfo.io/', 'category': 'infrastructure', 'note': 'FREE TIER: 50,000 req/month. Set IPINFO_API_KEY'},
]

print("=== Registering ENNA Free Tier API Collectors ===\n")

ok, skip = 0, 0

for api in FREE_APIS + PAID_FREE_TIER:
    body = json.dumps({
        'feed_url': api['feed_url'],
        'name': api['name'],
        'category': api['category'],
        'site_url': api['feed_url'].split('/')[2] if api['feed_url'].startswith('http') else '',
        'discovered_via': 'enna-free-tier',
        'enabled': True,
        'auto_pull': True,
    })
    cmd = ['curl', '-s', '-X', 'POST', FEEDS_API, '-H', 'Content-Type: application/json', '-H', 'X-Collection-Token: {}'.format(TOKEN), '-d', body]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = p.communicate(timeout=30)
    resp = stdout.decode('utf-8', errors='replace').strip()
    if p.returncode == 0 and resp and '"error"' not in resp[:200]:
        ok += 1
        print("  + {} [{}]".format(api['name'], api['note']))
    else:
        skip += 1
        # likely duplicate
        status = "duplicate" if "already" in resp.lower() or "duplicate" in resp.lower() else resp[:60]
        if skip <= 3:
            print("  ~ {} ({})".format(api['name'], status))

print("\nDone: {} registered, {} skipped".format(ok, skip))

# Save summary
summary = {
    'worldmonitor_feeds': 369,
    'enna_free_apis': len(FREE_APIS),
    'paid_with_free_tier': len(PAID_FREE_TIER),
    'total': 369 + len(FREE_APIS) + len(PAID_FREE_TIER),
}
with open(os.path.join(os.path.dirname(__file__), '..', 'data', 'free-tier-config.json'), 'w') as f:
    json.dump(summary, f, indent=2)
print("\nSummary saved to data/free-tier-config.json")
