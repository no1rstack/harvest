#!/usr/bin/env python3
"""Register all Politico RSS feeds (rss.politico.com) into Harvest."""

import subprocess, json, sys, time

FEEDS = [
    # Story Categories
    ("Politico Congress",                 "https://rss.politico.com/congress.xml",                "government"),
    ("Politico Health Care",              "https://rss.politico.com/healthcare.xml",              "healthcare"),
    ("Politico Defense",                  "https://rss.politico.com/defense.xml",                  "defense"),
    ("Politico Politics",                 "https://rss.politico.com/politics-news.xml",            "geopolitics"),
    ("Politico Energy & Environment",     "https://rss.politico.com/energy.xml",                   "energy"),
    ("Politico White House",              "https://rss.politico.com/white-house.xml",             "geopolitics"),
    ("Politico Magazine",                 "https://rss.politico.com/magazine.xml",                 "geopolitics"),
    # Newsletters
    ("Politico Playbook",                 "https://rss.politico.com/playbook.xml",                 "geopolitics"),
    ("Politico Morning Tech",             "https://rss.politico.com/morningtech.xml",              "cyber"),
    ("Politico Morning Money",            "https://rss.politico.com/morningmoney.xml",             "finance"),
    ("Politico Pulse",                    "https://rss.politico.com/politicopulse.xml",            "healthcare"),
    ("Politico Huddle",                   "https://rss.politico.com/huddle.xml",                   "government"),
    ("Politico Morning Energy",           "https://rss.politico.com/morningenergy.xml",            "energy"),
    ("Politico Morning Defense",          "https://rss.politico.com/morningdefense.xml",           "defense"),
    ("Politico Influence",                "https://rss.politico.com/politicoinfluence.xml",        "geopolitics"),
    ("Politico Morning Score",            "https://rss.politico.com/morningscore.xml",             "geopolitics"),
    ("Politico Morning Transportation",   "https://rss.politico.com/morningtransportation.xml",    "government"),
    ("Politico Morning Education",        "https://rss.politico.com/morningeducation.xml",         "geopolitics"),
    ("Politico Morning Tax",              "https://rss.politico.com/morningtax.xml",               "finance"),
    ("Politico Morning Agriculture",      "https://rss.politico.com/morningagriculture.xml",       "government"),
    ("Politico Morning Cybersecurity",    "https://rss.politico.com/morningcybersecurity.xml",     "cyber"),
    ("Politico Morning Trade",            "https://rss.politico.com/morningtrade.xml",             "finance"),
]

TOKEN = "3a1a8161158458555b82dad3633fea90431b00995b83b42d"
BASE = "http://127.0.0.1:3020"
ENDPOINT = f"{BASE}/api/feeds/community/sources"

registered = 0
failed = 0

for name, feed_url, category in FEEDS:
    payload = json.dumps({
        "name": name,
        "feed_url": feed_url,
        "site_url": "https://www.politico.com",
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
    if '"id"' in resp or '"source"' in resp:
        print(f"  OK  {name}")
        registered += 1
    elif "duplicate" in resp.lower() or "already" in resp.lower():
        print(f" DUP  {name}")
    else:
        print(f" FAIL {name}: {resp}")
        failed += 1

print(f"\nRegistered {registered}, failed {failed}")
