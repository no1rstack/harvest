#!/usr/bin/env python3
"""Seed collection targets from all active community categories."""
import subprocess, json, time

CATEGORIES = [
    "Sanctions", "geopolitics", "maritime", "defense", "disaster",
    "osint", "government", "intelligence", "law", "finance",
    "health", "energy", "humanrights", "sanctions"
]

ENDPOINT = "http://127.0.0.1:3020/api/feeds/community/expand"

total_seeds = 0
total_targets = 0
total_new = 0

for cat in CATEGORIES:
    p = subprocess.Popen(
        ["curl", "-s", "-X", "POST", ENDPOINT,
         "-H", "Content-Type: application/json",
         "-H", "Origin: http://127.0.0.1:3020",
         "-d", json.dumps({"category": cat, "hours": 168, "enqueue": False,
                           "expand": True, "max_targets": 15})],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    out, _ = p.communicate()
    try:
        r = json.loads(out)
    except:
        print(f"  FAIL {cat}: parse error")
        continue
    
    seeds = len(r.get("seeds", []))
    targets = len(r.get("targets", []))
    new = sum(1 for t in r.get("targets", []) if t.get("created"))
    total_seeds += seeds
    total_targets += targets
    total_new += new
    
    best = [t["value"] for t in r.get("targets", []) if t.get("created")][:4]
    print(f"  {cat:20s}  seeds:{seeds:4d}  targets:{targets:3d}  new:{new:3d}  {best}")
    time.sleep(0.3)

print(f"\nTotal: {total_seeds} seeds → {total_new} new targets ({total_targets} total)")
