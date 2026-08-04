#!/usr/bin/env python3
"""Extract all unique RSS/Atom feed URLs from WorldMonitor's _feeds.ts and import them into Harvest."""
import re, json, subprocess, sys, os, urllib.parse

FEEDS_TS = os.path.expanduser('~/.cursor/projects/home-hira-gitlab-repos-harvest/agent-tools/2b19e886-f8d9-4bbf-8126-417bc65ee3c2.txt')

# Read the file
with open(FEEDS_TS) as f:
    content = f.read()

# Extract all URL strings from the file
# Pattern: url: 'https://...'  or  url: gn('...')  or url: gnLocale('...')
url_pattern = re.compile(r"url:\s*'(https?://[^']+)'")
gn_pattern = re.compile(r"url:\s*gn\('([^']+)'\)")
gn_locale_pattern = re.compile(r"url:\s*gnLocale\('([^']+)'[^)]*\)")

direct_urls = set(re.findall(url_pattern, content))
gn_urls = set()
gn_locale_urls = set()

for m in re.finditer(r"url:\s*gn\('([^']+)'\)", content):
    q = m.group(1)
    url = 'https://news.google.com/rss/search?q=' + urllib.parse.quote(q, safe='') + '&hl=en-US&gl=US&ceid=US:en'
    gn_urls.add(url)

for m in re.finditer(r"url:\s*gnLocale\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)", content):
    q = m.group(1)
    hl = m.group(2)
    gl = m.group(3)
    ceid = m.group(4)
    url = 'https://news.google.com/rss/search?q=' + urllib.parse.quote(q, safe='') + '&hl=' + hl + '&gl=' + gl + '&ceid=' + ceid
    gn_locale_urls.add(url)

all_urls = sorted(direct_urls | gn_urls | gn_locale_urls)

# Extract name + URL pairs for registration
name_url_pairs = []

# Pattern for direct URLs: { name: 'Name', url: 'https://...' }
direct_pattern = re.compile(r"\{\s*name:\s*'([^']+)',\s*url:\s*'(https?://[^']+)'")
for name, url in re.findall(direct_pattern, content):
    name_url_pairs.append((name, url, 'direct'))

# Pattern for gn() — Google News RSS
gn_pair_pattern = re.compile(r"\{\s*name:\s*'([^']+)',\s*url:\s*gn\('([^']+)'\)")
for name, q in re.findall(gn_pair_pattern, content):
    url = 'https://news.google.com/rss/search?q=' + urllib.parse.quote(q, safe='') + '&hl=en-US&gl=US&ceid=US:en'
    name_url_pairs.append((name, url, 'google-news'))

# Pattern for gnLocale()
gnl_pair_pattern = re.compile(r"\{\s*name:\s*'([^']+)',\s*url:\s*gnLocale\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([^']+)'\)")
for name, q, hl, gl, ceid in re.findall(gnl_pair_pattern, content):
    url = 'https://news.google.com/rss/search?q=' + urllib.parse.quote(q, safe='') + '&hl=' + hl + '&gl=' + gl + '&ceid=' + ceid
    name_url_pairs.append((name, url, 'google-news'))

print(f"Extracted {len(name_url_pairs)} feed entries ({len(set(u for _,u,_ in name_url_pairs))} unique URLs)")
print(f"  Direct RSS/Atom: {sum(1 for _,_,t in name_url_pairs if t=='direct')}")
print(f"  Google News RSS: {sum(1 for _,_,t in name_url_pairs if t=='google-news')}")

# Determine categories from the TS structure
# Categorize by section headers like `politics: [`, `us: [`, etc.
category_pattern = re.compile(r'^\s*(\w[\w-]*):\s*\[', re.MULTILINE)
categories_found = category_pattern.findall(content)
print(f"\nCategories: {categories_found}")

# Map each feed to a category by tracking position in file
feeds_by_category = {}
current_category = None

lines = content.split('\n')
for i, line in enumerate(lines):
    cm = category_pattern.match(line)
    if cm:
        current_category = cm.group(1)
        if current_category not in feeds_by_category:
            feeds_by_category[current_category] = []
    
    dm = re.search(r"url:\s*'(https?://[^']+)'", line)
    gm = re.search(r"url:\s*gn\('([^']+)'\)", line)
    glm = re.search(r"url:\s*gnLocale\('([^']+)'[^)]*\)", line)
    
    if dm and current_category:
        feeds_by_category[current_category].append(dm.group(1))
    elif gm and current_category:
        q = gm.group(1)
        url = 'https://news.google.com/rss/search?q=' + urllib.parse.quote(q, safe='') + '&hl=en-US&gl=US&ceid=US:en'
        feeds_by_category[current_category].append(url)
    elif glm and current_category:
        q = glm.group(1)
        url = 'https://news.google.com/rss/search?q=' + urllib.parse.quote(q, safe='') + '&hl=en-US&gl=US&ceid=US:en'
        feeds_by_category[current_category].append(url)

# Remove non-category keys
for k in list(feeds_by_category.keys()):
    if k in ('name', 'url', 'lang', 'strategicDefault', 'export', 'gn', 'gnLocale'):
        del feeds_by_category[k]

# Add INTEL_SOURCES at the end
intel_feeds = []
intel_pattern = re.compile(r"\{\s*name:\s*'([^']+)',\s*url:\s*'(https?://[^']+)'")
intel_section = content[content.find('INTEL_SOURCES'):]
for name, url in re.findall(intel_pattern, intel_section):
    intel_feeds.append(url)
    name_url_pairs.append((name, url, 'direct'))

feeds_by_category['intel'] = intel_feeds

print(f"\nFeeds by category:")
for cat, urls in sorted(feeds_by_category.items()):
    print(f"  {cat}: {len(urls)} feeds")

# Save the extraction for reference
output = {
    'total_pairs': len(name_url_pairs),
    'unique_urls': len(set(u for _,u,_ in name_url_pairs)),
    'by_category': {k: len(v) for k,v in feeds_by_category.items()},
    'feeds': [{'name': n, 'url': u, 'type': t} for n,u,t in name_url_pairs]
}

out_path = os.path.join(os.path.dirname(__file__), '..', 'data', 'worldmonitor-feeds-extracted.json')
with open(out_path, 'w') as f:
    json.dump(output, f, indent=2)
print(f"\nSaved extraction to {out_path}")
print(f"Ready to import {len(set(u for _,u,_ in name_url_pairs))} unique feeds")
