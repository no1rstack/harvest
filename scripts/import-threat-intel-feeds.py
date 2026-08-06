#!/usr/bin/env python3
"""Import threat intelligence RSS feeds from threat_intel_rss_feeds.csv into Harvest."""
import csv, json, subprocess, os

TOKEN = '3a1a8161158458555b82dad3633fea90431b00995b83b42d'
API = 'http://127.0.0.1:3020/api/feeds/community/sources'

CSV_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         'feeds', 'threat_intel_rss_feeds.csv')

feeds = []
with open(CSV_FILE, 'r') as f:
    reader = csv.DictReader(f)
    for row in reader:
        feed_url = (row.get('Feed', '') or row.get('Subscribe', '')).strip()
        name = row.get('Tool', '').strip()
        category = (row.get('Category') or '').strip().lower()
        # Normalize category names
        if category == 'analysts':
            category = 'analyst-report'
        elif category == 'communities':
            category = 'community'
        elif category == 'governments':
            category = 'government'
        elif category == 'journalists':
            category = 'news-media'
        elif category == 'vendors':
            category = 'vendor-security'
        else:
            category = category or 'threat-intel'
        web = row.get('Web', '').strip()

        if not feed_url or not feed_url.startswith('http'):
            continue

        # Filter out obstracts.com subscribe URLs — they're not feed URLs
        if 'obstracts.com' in feed_url:
            continue
        # Filter out feedburner subscribe/report links
        if '/report/list/' in feed_url:
            continue

        feeds.append({
            'feed_url': feed_url,
            'name': name or feed_url.split('/')[2],
            'category': category,
            'site_url': web,
            'enabled': True,
            'auto_pull': True,
            'adaptive_interval_minutes': 360,  # once daily — these are blog/news feeds
            'discovered_via': 'obstracts-threat-intel',
        })

feeds = list({f['feed_url']: f for f in feeds}.values())  # dedup by URL

print(f"=== Importing {len(feeds)} threat intel RSS feeds ===\n")

ok, skip, err = 0, 0, 0

for feed in feeds:
    body = json.dumps(feed)

    cmd = ['curl', '-s', '-X', 'POST', API,
           '-H', 'Content-Type: application/json',
           '-H', 'X-Collection-Token: {}'.format(TOKEN),
           '-d', body]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = p.communicate(timeout=15)
    resp = stdout.decode('utf-8', errors='replace').strip()

    if 'duplicate' in resp.lower():
        skip += 1
        print(f"  SKIP {feed['name'][:55]} ({feed['category']})")
    elif '"id"' in resp:
        ok += 1
        print(f"  OK   {feed['name'][:55]} ({feed['category']})")
    else:
        err += 1
        print(f"  ERR  {feed['name'][:55]} → {resp[:100]}")

print(f"\n=== Summary: {ok} imported, {skip} skipped (duplicate), {err} errors ===")
print("\nCategories breakdown:")
cats = {}
for f in feeds:
    c = f['category']
    cats[c] = (cats.get(c) or 0) + 1
for c, n in sorted(cats.items()):
    print(f"  {c}: {n}")
