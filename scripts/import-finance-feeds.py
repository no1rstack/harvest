#!/usr/bin/env python3
"""Register verified RSS feeds from financial/crypto/supply-chain sources into Harvest."""

import subprocess, json

FEEDS = [
    ("Business Insider Scotland",      "https://www.insider.co.uk/rss.xml",                       "finance"),
    ("24/7 Wall St",                   "https://247wallst.com/feed/",                              "finance"),
    ("Motley Fool",                    "https://www.fool.com/feeds/index.aspx",                    "finance"),
    ("Yahoo Finance",                  "https://finance.yahoo.com/news/rssindex",                  "finance"),
    ("CryptoProwl",                    "https://www.cryptoprowl.com/rss",                          "crypto"),
    ("FreightWaves",                   "https://www.freightwaves.com/feed",                        "logistics"),
    ("Barchart Main News",             "https://feeds.feedburner.com/barchartnews",                "finance"),
    ("Barchart Financials",            "https://www.barchart.com/news/rss/financials",             "finance"),
    ("Barchart Commodities",           "https://www.barchart.com/news/rss/commodities",            "commodities"),
    ("Barchart Crypto",                "https://www.barchart.com/news/rss/financials/crypto",      "crypto"),
    ("Barchart Equity",                "https://www.barchart.com/news/rss/financials/equity",      "finance"),
]

TOKEN = "3a1a8161158458555b82dad3633fea90431b00995b83b42d"
ENDPOINT = "http://127.0.0.1:3020/api/feeds/community/sources"

registered = 0
dup = 0
failed = 0
skipped = []

for name, feed_url, category in FEEDS:
    payload = json.dumps({
        "name": name,
        "feed_url": feed_url,
        "site_url": feed_url.rsplit("/", 2)[0] if "/" in feed_url else "",
        "category": category,
        "auto_pull": True,
    })
    p = subprocess.Popen(
        ["curl", "-s", "-X", "POST", ENDPOINT,
         "-H", "Content-Type: application/json",
         "-H", f"X-Collection-Token: {TOKEN}",
         "-d", payload],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    out, err = p.communicate()
    resp = out.decode().strip()
    if '"source"' in resp or '"id"' in resp:
        print(f"  OK   {name}")
        registered += 1
    elif "duplicate" in resp.lower() or "already" in resp.lower():
        print(f"  DUP  {name}")
        dup += 1
    else:
        print(f"  FAIL {name}: {resp}")
        failed += 1
        skipped.append(name)

print(f"\nRegistered {registered}, duplicates {dup}, failed {failed}")
if skipped:
    print(f"Not available: {', '.join(skipped)}")
print("Sites without RSS feeds (skipped): telegraph.co.uk (403 paywall), moneywise.com (403), insidermonkey.com (404), moby.co (HTML only)")
