#!/usr/bin/env python3
"""Import all WorldMonitor feeds into Harvest's community_feed_sources."""
import json, subprocess, sys, time, os

TOKEN = '3a1a8161158458555b82dad3633fea90431b00995b83b42d'
API = 'http://127.0.0.1:3020/api/feeds/community/sources'

# Read extracted feeds
extracted_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'worldmonitor-feeds-extracted.json')
with open(extracted_path) as f:
    data = json.load(f)

feeds = data['feeds']
total = len(feeds)
print("Importing {} feeds from WorldMonitor...".format(total))

ok, err, skipped = 0, 0, 0
seen_urls = set()

for i, feed in enumerate(feeds):
    url = feed['url']
    name = feed['name']
    
    if url in seen_urls:
        skipped += 1
        continue
    seen_urls.add(url)
    
    category = 'worldmonitor'
    
    body = json.dumps({
        'feed_url': url,
        'name': name,
        'category': category,
        'site_url': url.split('/')[2] if url.startswith('http') else '',
        'discovered_via': 'worldmonitor-pack',
        'enabled': True,
        'auto_pull': True,
    })
    
    cmd = [
        'curl', '-s', '-X', 'POST', API,
        '-H', 'Content-Type: application/json',
        '-H', 'X-Collection-Token: {}'.format(TOKEN),
        '-d', body,
    ]
    
    try:
        p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = p.communicate(timeout=30)
        resp = stdout.decode('utf-8', errors='replace').strip()
        if p.returncode == 0 and resp and '"error"' not in resp[:200]:
            ok += 1
        elif 'already exists' in resp.lower() or 'duplicate' in resp.lower():
            skipped += 1
        else:
            err += 1
            if err <= 3:
                print("  Error on [{}]: {}".format(name, resp[:120]))
    except Exception as e:
        err += 1
        if err <= 3:
            print("  Exception on [{}]: {}".format(name, e))
    
    if (i + 1) % 50 == 0:
        print("  Progress: {}/{} -- ok={} err={} skipped={}".format(i+1, total, ok, err, skipped))

print("\nDone: {} imported, {} errors, {} skipped/duplicates".format(ok, err, skipped))
