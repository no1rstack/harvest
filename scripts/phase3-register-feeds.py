#!/usr/bin/env python3
"""Phase 3: Register new RSS feeds across technology, defense, science, space, energy, and emerging domains."""

import subprocess, json, time

TOKEN = "3a1a8161158458555b82dad3633fea90431b00995b83b42d"
ENDPOINT = "http://127.0.0.1:3020/api/feeds/community/sources"

# Format: (name, feed_url, site_url, category)
FEEDS = [
    # ── Technology & AI ──
    ("MIT Technology Review",   "https://www.technologyreview.com/feed/",                   "https://www.technologyreview.com",   "technology"),
    ("Ars Technica",            "http://feeds.arstechnica.com/arstechnica/index",            "https://arstechnica.com",            "technology"),
    ("arXiv Computer Science AI","https://rss.arxiv.org/rss/cs.ai",                          "https://arxiv.org",                  "technology"),
    # ── Physics & Science ──
    ("arXiv Physics",           "https://rss.arxiv.org/rss/physics",                         "https://arxiv.org",                  "physics"),
    ("arXiv Quantum Physics",   "https://rss.arxiv.org/rss/quant-ph",                        "https://arxiv.org",                  "physics"),
    ("Nature Journal",          "https://www.nature.com/nature.rss",                         "https://www.nature.com",             "science"),
    ("Science Magazine",        "https://www.science.org/rss/news_current.xml",               "https://www.science.org",            "science"),
    ("Scientific American",     "http://rss.sciam.com/ScientificAmerican-Global",             "https://www.scientificamerican.com", "science"),
    ("Science News",            "https://www.sciencenews.org/feed",                          "https://www.sciencenews.org",        "science"),
    ("Phys.org",                "https://phys.org/rss-feed/",                                "https://phys.org",                   "science"),
    # ── Space & UAP ──
    ("NASA",                    "https://www.nasa.gov/feed/",                                "https://www.nasa.gov",               "space"),
    ("Space.com",               "https://www.space.com/feeds/all",                           "https://www.space.com",              "space"),
    ("The Debrief",             "https://thedebrief.org/feed/",                              "https://thedebrief.org",             "science"),
    # ── Defense & Warfare ──
    ("Defense News",            "https://www.defensenews.com/arc/outboundfeeds/rss/",         "https://www.defensenews.com",         "defense"),
    ("Defense News — Air",      "https://www.defensenews.com/arc/outboundfeeds/rss/category/air/?outputType=xml",       "https://www.defensenews.com", "defense"),
    ("Defense News — Naval",    "https://www.defensenews.com/arc/outboundfeeds/rss/category/naval/?outputType=xml",     "https://www.defensenews.com", "defense"),
    ("Defense News — Land",     "https://www.defensenews.com/arc/outboundfeeds/rss/category/land/?outputType=xml",      "https://www.defensenews.com", "defense"),
    ("Defense News — Space",    "https://www.defensenews.com/arc/outboundfeeds/rss/category/space/?outputType=xml",     "https://www.defensenews.com", "defense"),
    ("Defense News — Global",   "https://www.defensenews.com/arc/outboundfeeds/rss/category/global/?outputType=xml",    "https://www.defensenews.com", "defense"),
    ("Defense News — Industry", "https://www.defensenews.com/arc/outboundfeeds/rss/category/industry/?outputType=xml",  "https://www.defensenews.com", "defense"),
    ("Defense News — Unmanned", "https://www.defensenews.com/arc/outboundfeeds/rss/category/unmanned/?outputType=xml",  "https://www.defensenews.com", "defense"),
    ("Defence Blog",            "https://defence-blog.com/feed/",                           "https://defence-blog.com",           "defense"),
    # ── Energy & Climate ──
    ("EIA Today in Energy",     "https://www.eia.gov/rss/todayinenergy.xml",                 "https://www.eia.gov",                "energy"),
    # ── Agriculture & Food ──
    ("FAO News",                "http://feeds.feedburner.com/FAOnews",                       "https://www.fao.org",                "agriculture"),
    # ── Environment ──
    ("E&E News",                "https://www.eenews.net/feed/",                              "https://www.eenews.net",             "environment"),
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
        print(f"  OK   {category:14s} {name}")
        registered += 1
    elif "duplicate" in resp.lower() or "already" in resp.lower():
        print(f"  DUP  {category:14s} {name}")
        dup += 1
    else:
        print(f"  FAIL {category:14s} {name}: {resp[:100]}")
        failed += 1
    time.sleep(0.2)

print(f"\nRegistered {registered}, duplicates {dup}, failed {failed}")
print("Feeds unreachable (not added): USDA (403), NASS (404), NOAA (403), FDA (404), SAM.gov (auth wall)")
print("Feeds not responding: WTO trade, BIS export controls, transportation.gov, FAA, FEC, NCES, EMA, WHO")
