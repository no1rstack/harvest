#!/usr/bin/env python3
"""Import US government RSS feeds from govinfo.gov into Harvest.
Focuses on legislation, regulations, courts, GAO, and Congressional Record.
Bulk data feeds provide structured XML/JSON downloads of entire collections.
"""
import json, subprocess, os

TOKEN = '3a1a8161158458555b82dad3633fea90431b00995b83b42d'
API = 'http://127.0.0.1:3020/api/feeds/community/sources'

# Tier 1: High-signal feeds for OSINT, governance, financial crime
TIER1_FEEDS = {
    # Legislation
    '/rss/bills.xml': ('Bills (new legislation)', 'legislation'),
    '/rss/bills-enr.xml': ('Enrolled Bills', 'legislation'),
    '/rss/plaw.xml': ('Public & Private Laws', 'legislation'),
    '/rss/uscode.xml': ('US Code updates', 'legislation'),
    '/rss/statute.xml': ('Statutes at Large', 'legislation'),
    # Congressional
    '/rss/crec.xml': ('Congressional Record (daily)', 'congress'),
    '/rss/crecb.xml': ('Congressional Record (bound)', 'congress'),
    '/rss/cri.xml': ('Congressional Record Index', 'congress'),
    '/rss/chrg.xml': ('Congressional Hearings', 'congress'),
    '/rss/crpt.xml': ('Congressional Reports', 'congress'),
    '/rss/cdoc.xml': ('Congressional Documents', 'congress'),
    '/rss/cprt.xml': ('Committee Prints', 'congress'),
    '/rss/hob.xml': ('History of Bills', 'congress'),
    '/rss/ccal.xml': ('Congressional Calendars', 'congress'),
    '/rss/hjournal.xml': ('House Journal', 'congress'),
    # Regulatory
    '/rss/fr.xml': ('Federal Register', 'regulation'),
    '/rss/cfr.xml': ('Code of Federal Regulations', 'regulation'),
    '/rss/lsa.xml': ('List of CFR Sections Affected', 'regulation'),
    # Budget & Executive
    '/rss/budget.xml': ('Budget of the US Government', 'fiscal'),
    '/rss/erp.xml': ('Economic Report of the President', 'fiscal'),
    '/rss/dcpd.xml': ('Compilation of Pres. Documents', 'executive'),
    '/rss/ppp.xml': ('Public Papers of the President', 'executive'),
    '/rss/econi.xml': ('Economic Indicators', 'fiscal'),
    # Oversight
    '/rss/gaoreports.xml': ('GAO Reports', 'oversight'),
    '/rss/govman.xml': ('US Government Manual', 'directory'),
    '/rss/cdir.xml': ('Congressional Directory', 'directory'),
    # Court opinions (circuit + key district)
    '/rss/usreports.xml': ('US Supreme Court Reports', 'judicial'),
}

# Tier 2: All US court RSS feeds (district + circuit courts)
# District court opinions can surface sanctions, fraud, FCPA cases
COURT_DISTRICTS = [
    ('/rss/uscourts-cadc.xml', 'DC Circuit', 'judicial'),
    ('/rss/uscourts-ca1.xml', '1st Circuit', 'judicial'),
    ('/rss/uscourts-ca2.xml', '2nd Circuit (NY/CT/VT)', 'judicial'),
    ('/rss/uscourts-ca3.xml', '3rd Circuit', 'judicial'),
    ('/rss/uscourts-ca4.xml', '4th Circuit', 'judicial'),
    ('/rss/uscourts-ca5.xml', '5th Circuit', 'judicial'),
    ('/rss/uscourts-ca6.xml', '6th Circuit', 'judicial'),
    ('/rss/uscourts-ca7.xml', '7th Circuit', 'judicial'),
    ('/rss/uscourts-ca8.xml', '8th Circuit', 'judicial'),
    ('/rss/uscourts-ca9.xml', '9th Circuit', 'judicial'),
    ('/rss/uscourts-ca10.xml', '10th Circuit', 'judicial'),
    ('/rss/uscourts-ca11.xml', '11th Circuit', 'judicial'),
    ('/rss/uscourts-ca13.xml', 'Federal Circuit', 'judicial'),
    ('/rss/uscourts-cit.xml', 'Court of Intl Trade', 'judicial'),
    ('/rss/uscourts-cofc.xml', 'Court of Federal Claims', 'judicial'),
    # Key financial districts
    ('/rss/uscourts-nysb.xml', 'SDNY Bankruptcy', 'judicial'),
    ('/rss/uscourts-nysd.xml', 'SDNY District', 'judicial'),
    ('/rss/uscourts-nyeb.xml', 'EDNY District', 'judicial'),
    ('/rss/uscourts-dcd.xml', 'DC District', 'judicial'),
    ('/rss/uscourts-ded.xml', 'Delaware District', 'judicial'),  # corp law
    ('/rss/uscourts-deb.xml', 'Delaware Bankruptcy', 'judicial'),
    ('/rss/uscourts-ilnd.xml', 'ND Illinois', 'judicial'),
    ('/rss/uscourts-cand.xml', 'ND California', 'judicial'),
    ('/rss/uscourts-cacb.xml', 'CD California Bankruptcy', 'judicial'),
    ('/rss/uscourts-txsb.xml', 'SD Texas Bankruptcy', 'judicial'),
    ('/rss/uscourts-txsd.xml', 'SD Texas District', 'judicial'),
    ('/rss/uscourts-flsb.xml', 'SD Florida Bankruptcy', 'judicial'),
    ('/rss/uscourts-flsd.xml', 'SD Florida District', 'judicial'),
    ('/rss/uscourts-mad.xml', 'Massachusetts District', 'judicial'),
    ('/rss/uscourts-paed.xml', 'ED Pennsylvania', 'judicial'),
]

# Tier 3: Bulk data feeds (entire collections as XML/JSON, slow-changing)
BULKDATA_FEEDS = {
    '/rss/bills-bulkdata.xml': ('Bills Bulk Data', 'legislation'),
    '/rss/billstatus-bulkdata.xml': ('Bill Status Bulk Data', 'legislation'),
    '/rss/billsum-bulkdata.xml': ('Bill Summaries Bulk Data', 'legislation'),
    '/rss/cfr-bulkdata.xml': ('CFR Bulk Data', 'regulation'),
    '/rss/ecfr-bulkdata.xml': ('eCFR Bulk Data', 'regulation'),
    '/rss/fr-bulkdata.xml': ('Federal Register Bulk Data', 'regulation'),
    '/rss/comps-bulkdata.xml': ('US Code Compilations Bulk', 'legislation'),
    '/rss/statute-bulkdata.xml': ('Statutes Bulk Data', 'legislation'),
    '/rss/ppp-bulkdata.xml': ('Pres. Papers Bulk Data', 'executive'),
    '/rss/govman-bulkdata.xml': ('Gov Manual Bulk Data', 'directory'),
    '/rss/hman-bulkdata.xml': ('House Manual Bulk Data', 'congress'),
    '/rss/pai-bulkdata.xml': ('Privacy Act Issuances Bulk', 'regulation'),
}

BASE = 'https://www.govinfo.gov'

all_feeds = {}
all_feeds.update(TIER1_FEEDS)
for path, name, cat in COURT_DISTRICTS:
    all_feeds[path] = (name, cat)
all_feeds.update(BULKDATA_FEEDS)

# Dedup
deduped = {}
for path, (name, cat) in all_feeds.items():
    if path not in deduped:
        deduped[path] = (name, cat)

print(f"=== Importing {len(deduped)} govinfo.gov RSS feeds ===\n")

ok, skip, err = 0, 0, 0

for path, (name, category) in sorted(deduped.items()):
    feed_url = f"{BASE}{path}"
    body_json = json.dumps({
        'feed_url': feed_url,
        'name': f'US Gov: {name}',
        'category': category,
        'site_url': BASE,
        'enabled': True,
        'auto_pull': True,
        'adaptive_interval_minutes': 1440,  # daily — gov docs publish slowly
        'discovered_via': 'govinfo-rss',
    })

    cmd = ['curl', '-s', '-X', 'POST', API,
           '-H', 'Content-Type: application/json',
           '-H', f'X-Collection-Token: {TOKEN}',
           '-d', body_json]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = p.communicate(timeout=15)
    resp = stdout.decode('utf-8', errors='replace').strip()

    if 'duplicate' in resp.lower():
        skip += 1
        print(f"  SKIP {name[:55]} ({category})")
    elif '"id"' in resp:
        ok += 1
        print(f"  OK   {name[:55]} ({category})")
    else:
        err += 1
        print(f"  ERR  {name[:55]} → {resp[:100]}")

print(f"\n=== Summary: {ok} imported, {skip} skipped, {err} errors ===")

cats = {}
for path, (name, cat) in deduped.items():
    cats[cat] = cats.get(cat, 0) + 1
print("\nBy category:")
for c, n in sorted(cats.items()):
    print(f"  {c}: {n}")
