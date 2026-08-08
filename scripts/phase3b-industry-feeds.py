#!/usr/bin/env python3
"""Register industry vertical RSS feeds across aerospace, automotive, telecom, finance, media, AI/cloud."""

import subprocess, json, time

TOKEN = "3a1a8161158458555b82dad3633fea90431b00995b83b42d"
ENDPOINT = "http://127.0.0.1:3020/api/feeds/community/sources"

FEEDS = [
    # ── Defense & Aerospace ──
    ("Aviation Week",              "https://www.aviationweek.com/rss.xml",                       "https://www.aviationweek.com",           "aerospace"),
    ("Aviation Today",             "https://www.aviationtoday.com/feed/",                        "https://www.aviationtoday.com",          "aerospace"),
    ("Federal Times",              "https://www.federaltimes.com/arc/outboundfeeds/rss/",         "https://www.federaltimes.com",           "government"),
    # ── Government & Policy ──
    ("Federal Register (GovInfo)", "https://www.govinfo.gov/feeds/fr.xml",                       "https://www.govinfo.gov",                "government"),
    ("Federal Register API",       "https://www.federalregister.gov/api/v1/documents.rss",        "https://www.federalregister.gov",        "government"),
    # ── Automotive & Mobility ──
    ("Gasgoo Auto (Market)",       "https://autonews.gasgoo.com/api/rss?ClassId=2",              "https://autonews.gasgoo.com",            "automotive"),
    ("Gasgoo Auto (EV)",           "https://autonews.gasgoo.com/api/rss?ClassId=7",              "https://autonews.gasgoo.com",            "automotive"),
    # ── Logistics & Supply Chain (already have FreightWaves, adding) ──
    # (FreightWaves already registered in finance feeds)
    # ── Finance & Insurance ──
    ("CNBC Top News",              "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", "https://www.cnbc.com", "finance"),
    ("Fortune Magazine",           "https://fortune.com/feed/",                                   "https://fortune.com",                    "finance"),
    ("Business Insider",           "https://www.businessinsider.com/rss",                         "https://www.businessinsider.com",        "finance"),
    # ── Telecommunications ──
    ("Light Reading",              "https://www.lightreading.com/rss.xml",                        "https://www.lightreading.com",           "telecom"),
    # ── Media & Entertainment ──
    ("Variety",                    "https://variety.com/feed/",                                   "https://variety.com",                    "media"),
    ("The Hollywood Reporter",     "https://www.hollywoodreporter.com/feed/",                      "https://www.hollywoodreporter.com",      "media"),
    # ── Artificial Intelligence & Cloud ──
    ("AWS News Blog",              "https://aws.amazon.com/blogs/aws/feed/",                      "https://aws.amazon.com/blogs/aws",       "ai-cloud"),
    ("Google Cloud Blog",          "https://cloudblog.withgoogle.com/rss/",                       "https://cloud.google.com/blog",          "ai-cloud"),
    ("GCP AI Platform Releases",   "https://cloud.google.com/feeds/aiplatform-release-notes.xml", "https://cloud.google.com",                "ai-cloud"),
    # ── Cybersecurity & Surveillance ──
    # (Already well-covered: BleepingComputer, Krebs, CISA, CrowdStrike, Recorded Future, etc.)
    # ── Technology ──
    ("CNN Money Tech",             "http://rss.cnn.com/rss/money_technology.rss",                  "https://www.cnn.com",                    "technology"),
    ("CyberNetSec Threat Intel",   "https://cyber.netsecops.io/rss-feed.xml",                      "https://cyber.netsecops.io",             "cyber-threat"),
]

registered = 0
dup = 0
failed = 0

for name, feed_url, site_url, category in FEEDS:
    payload = json.dumps({
        "name": name,
        "feed_url": feed_url,
        "site_url": site_url,
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
    out, _ = p.communicate()
    resp = out.decode().strip()
    if '"source"' in resp or '"id"' in resp:
        print(f"  OK   {category:16s} {name}")
        registered += 1
    elif "duplicate" in resp.lower() or "already" in resp.lower():
        print(f"  DUP  {category:16s} {name}")
        dup += 1
    else:
        print(f"  FAIL {category:16s} {name}: {resp[:120]}")
        failed += 1
    time.sleep(0.2)

print(f"\nRegistered {registered}, duplicates {dup}, failed {failed}")
print("Skipped (HTML-only or blocked): InsideEVs, Bloomberg, Forbes, Dow Jones, FierceWireless (defunct)")
