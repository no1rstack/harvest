#!/usr/bin/env python3
"""Import the 125 discovered-but-unregistered RSS feeds into community_feed_sources."""
import json, subprocess, sys, os

TOKEN = '3a1a8161158458555b82dad3633fea90431b00995b83b42d'
FEEDS_API = 'http://127.0.0.1:3020/api/feeds/community/sources'

FEEDS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'discovered-rss-feeds.json')

with open(FEEDS_FILE) as f:
    feeds = json.load(f)

print(f"=== Importing {len(feeds)} discovered RSS feeds ===\n")

ok, skip, err = 0, 0, 0

for feed in feeds:
    feed_url = feed.get('feed_url', '')
    if not feed_url or not feed_url.startswith('http'):
        skip += 1
        continue

    body = json.dumps({
        'feed_url': feed_url,
        'name': feed.get('name', feed_url.split('/')[2]),
        'category': feed.get('category', 'osint'),
        'site_url': feed.get('site_url', ''),
        'discovered_via': 'discovered-rss',
        'enabled': True,
        'auto_pull': True,
        'adaptive_interval_minutes': 15,
    })

    cmd = ['curl', '-s', '-X', 'POST', FEEDS_API,
           '-H', 'Content-Type: application/json',
           '-H', 'X-Collection-Token: {}'.format(TOKEN),
           '-d', body]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = p.communicate(timeout=30)
    resp = stdout.decode('utf-8', errors='replace').strip()

    if 'duplicate' in resp.lower() or '"id"' in resp:
        status = 'DUPLICATE' if 'duplicate' in resp.lower() else 'OK'
        if status == 'OK':
            ok += 1
            print(f"  OK   {feed['name'][:55]}")
        else:
            skip += 1
            print(f"  SKIP {feed['name'][:55]} (already exists)")
    else:
        err += 1
        print(f"  ERR  {feed['name'][:55]} -> {resp[:80]}")

print(f"\n=== Summary: {ok} imported, {skip} skipped (duplicate/invalid), {err} errors ===")
