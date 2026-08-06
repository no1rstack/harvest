#!/usr/bin/env python3
"""Register RSS feeds from downloaded XML files in the feeds/ directory."""
import json, subprocess, os

TOKEN = '3a1a8161158458555b82dad3633fea90431b00995b83b42d'
API = 'http://127.0.0.1:3020/api/feeds/community/sources'

feeds = [
    # From XML <title> / filename inspection
    {
        "name": "FinanceFeeds",
        "feed_url": "https://financefeeds.com/feed/",
        "category": "finance",
        "site_url": "https://financefeeds.com",
    },
    {
        "name": "Investing.com — Analysis",
        "feed_url": "https://www.investing.com/rss/analysis.rss",
        "category": "finance",
        "site_url": "https://www.investing.com",
    },
    {
        "name": "Investing.com — Most Popular",
        "feed_url": "https://www.investing.com/rss/news_286.rss",
        "category": "finance",
        "site_url": "https://www.investing.com",
    },
    {
        "name": "Investing.com — Editors Picks",
        "feed_url": "https://www.investing.com/rss/news_290.rss",
        "category": "finance",
        "site_url": "https://www.investing.com",
    },
    {
        "name": "Investing.com — Market Overview",
        "feed_url": "https://www.investing.com/rss/market_overview.rss",
        "category": "markets",
        "site_url": "https://www.investing.com",
    },
    {
        "name": "Investing.com — Stocks Analysis",
        "feed_url": "https://www.investing.com/rss/stock_Markets.rss",
        "category": "stocks",
        "site_url": "https://www.investing.com",
    },
]

print(f"=== Registering {len(feeds)} feeds ===\n")
ok, skip, err = 0, 0, 0

for feed in feeds:
    body = json.dumps({
        "feed_url": feed["feed_url"],
        "name": feed["name"],
        "category": feed.get("category", "osint"),
        "site_url": feed.get("site_url", ""),
        "enabled": True,
        "auto_pull": True,
        "adaptive_interval_minutes": 360,  # once a day initially — adaptive will tune
    })

    cmd = [
        "curl", "-s", "-w", "\n%{http_code}", "-X", "POST", API,
        "-H", "Content-Type: application/json",
        "-H", f"X-Collection-Token: {TOKEN}",
        "-d", body,
    ]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = p.communicate(timeout=15)
    output = stdout.decode("utf-8", errors="replace").strip()
    lines = output.rsplit("\n", 1)
    resp = lines[0] if len(lines) > 1 else output
    status_code = lines[1] if len(lines) > 1 else "?"

    if "duplicate" in resp.lower():
        skip += 1
        print(f"  SKIP {feed['name'][:55]} (already exists)")
    elif '"id"' in resp or '"ok"' in resp:
        ok += 1
        print(f"  OK   {feed['name'][:55]}")
    else:
        err += 1
        print(f"  ERR  {feed['name'][:55]} → {resp[:100]}")

print(f"\n=== Summary: {ok} registered, {skip} skipped, {err} errors ===")
