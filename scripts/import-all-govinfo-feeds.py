#!/usr/bin/env python3
"""Import ALL remaining govinfo.gov RSS feeds not yet registered in Harvest."""
import json, subprocess, os, re

TOKEN = '3a1a8161158458555b82dad3633fea90431b00995b83b42d'
API = 'http://127.0.0.1:3020/api/feeds/community/sources'
BASE = 'https://www.govinfo.gov'

# All feeds from https://www.govinfo.gov/feeds
ALL_FEEDS = {}
for path, name, cat in [
    # ── Bills & Statutes ──
    ('/rss/bills.xml', 'Bills', 'legislation'),
    ('/rss/bills-enr.xml', 'Enrolled Bills', 'legislation'),
    ('/rss/plaw.xml', 'Public & Private Laws', 'legislation'),
    ('/rss/comps.xml', 'Statute Compilations', 'legislation'),
    ('/rss/statute.xml', 'Statutes at Large', 'legislation'),
    ('/rss/uscode.xml', 'US Code', 'legislation'),
    # ── Budget & Presidential ──
    ('/rss/budget.xml', 'Budget of the US Government', 'fiscal'),
    ('/rss/dcpd.xml', 'Compilation of Presidential Documents', 'executive'),
    ('/rss/erp.xml', 'Economic Report of the President', 'fiscal'),
    ('/rss/ppp.xml', 'Public Papers of the President', 'executive'),
    # ── Congressional Committee ──
    ('/rss/cprt.xml', 'Committee Prints', 'congress'),
    ('/rss/cdoc.xml', 'Congressional Documents', 'congress'),
    ('/rss/chrg.xml', 'Congressional Hearings', 'congress'),
    ('/rss/crpt.xml', 'Congressional Reports', 'congress'),
    ('/rss/serialset.xml', 'Congressional Serial Set', 'congress'),
    ('/rss/cmr.xml', 'Congressionally Mandated Reports', 'oversight'),
    ('/rss/econi.xml', 'Economic Indicators', 'fiscal'),
    # ── Congressional Rules ──
    ('/rss/hman.xml', 'House Rules and Manual', 'congress'),
    ('/rss/sman.xml', 'Senate Manual', 'congress'),
    # ── Directories ──
    ('/rss/cdir.xml', 'Congressional Directory', 'directory'),
    ('/rss/govman.xml', 'United States Government Manual', 'directory'),
    # ── Executive ──
    ('/rss/gpo-fcc.xml', 'FCC Record', 'regulation'),
    # ── Legislative Agency ──
    ('/rss/gaoreports.xml', 'GAO Reports', 'oversight'),
    # ── Proceedings of Congress ──
    ('/rss/ccal.xml', 'Congressional Calendars', 'congress'),
    ('/rss/crec.xml', 'Congressional Record (daily)', 'congress'),
    ('/rss/crecb.xml', 'Congressional Record (bound)', 'congress'),
    ('/rss/cri.xml', 'Congressional Record Index', 'congress'),
    ('/rss/hob.xml', 'History of Bills', 'congress'),
    ('/rss/hjournal.xml', 'House Journal', 'congress'),
    # ── Regulatory ──
    ('/rss/cfr.xml', 'Code of Federal Regulations', 'regulation'),
    ('/rss/fr.xml', 'Federal Register', 'regulation'),
    ('/rss/lsa.xml', 'List of CFR Sections Affected', 'regulation'),
    ('/rss/pai.xml', 'Privacy Act Issuances', 'regulation'),
    # ── Supreme Court ──
    ('/rss/usreports.xml', 'US Reports (Supreme Court)', 'judicial'),
    # ── Appellate Courts ──
    ('/rss/uscourts-ca1.xml', '1st Circuit', 'judicial'),
    ('/rss/uscourts-ca2.xml', '2nd Circuit', 'judicial'),
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
    ('/rss/uscourts-cadc.xml', 'DC Circuit', 'judicial'),
    # ── National Courts ──
    ('/rss/uscourts-jpml.xml', 'Judicial Panel on Multidistrict Litigation', 'judicial'),
    ('/rss/uscourts-cit.xml', 'Court of International Trade', 'judicial'),
    ('/rss/uscourts-cofc.xml', 'Court of Federal Claims', 'judicial'),
    # ── ALL District Courts (94 districts) ──
    ('/rss/uscourts-akb.xml', 'District Court AK Bankruptcy', 'judicial'),
    ('/rss/uscourts-akd.xml', 'District Court District of Alaska', 'judicial'),
    ('/rss/uscourts-almb.xml', 'District Court AL Middle Bankruptcy', 'judicial'),
    ('/rss/uscourts-almd.xml', 'District Court AL Middle District', 'judicial'),
    ('/rss/uscourts-alnb.xml', 'District Court AL Northern Bankruptcy', 'judicial'),
    ('/rss/uscourts-alnd.xml', 'District Court AL Northern District', 'judicial'),
    ('/rss/uscourts-alsb.xml', 'District Court AL Southern Bankruptcy', 'judicial'),
    ('/rss/uscourts-alsd.xml', 'District Court AL Southern District', 'judicial'),
    ('/rss/uscourts-areb.xml', 'District Court AR Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-ared.xml', 'District Court AR Eastern District', 'judicial'),
    ('/rss/uscourts-arwb.xml', 'District Court AR Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-azb.xml', 'District Court District of Arizona Bankruptcy', 'judicial'),
    ('/rss/uscourts-azd.xml', 'District Court District of Arizona', 'judicial'),
    ('/rss/uscourts-cacb.xml', 'District Court CA Central Bankruptcy', 'judicial'),
    ('/rss/uscourts-caeb.xml', 'District Court CA Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-caed.xml', 'District Court CA Eastern District', 'judicial'),
    ('/rss/uscourts-canb.xml', 'District Court CA Northern Bankruptcy', 'judicial'),
    ('/rss/uscourts-cand.xml', 'District Court CA Northern District', 'judicial'),
    ('/rss/uscourts-casd.xml', 'District Court CA Southern District', 'judicial'),
    ('/rss/uscourts-cob.xml', 'District Court CO Bankruptcy', 'judicial'),
    ('/rss/uscourts-cod.xml', 'District Court District of Colorado', 'judicial'),
    ('/rss/uscourts-ctb.xml', 'District Court CT Bankruptcy', 'judicial'),
    ('/rss/uscourts-ctd.xml', 'District Court District of Connecticut', 'judicial'),
    ('/rss/uscourts-dcb.xml', 'District Court DC Bankruptcy', 'judicial'),
    ('/rss/uscourts-dcd.xml', 'District Court District of Columbia', 'judicial'),
    ('/rss/uscourts-deb.xml', 'District Court DE Bankruptcy', 'judicial'),
    ('/rss/uscourts-ded.xml', 'District Court District of Delaware', 'judicial'),
    ('/rss/uscourts-flmb.xml', 'District Court FL Middle Bankruptcy', 'judicial'),
    ('/rss/uscourts-flnd.xml', 'District Court FL Northern District', 'judicial'),
    ('/rss/uscourts-flsb.xml', 'District Court FL Southern Bankruptcy', 'judicial'),
    ('/rss/uscourts-flsd.xml', 'District Court FL Southern District', 'judicial'),
    ('/rss/uscourts-gamb.xml', 'District Court GA Middle Bankruptcy', 'judicial'),
    ('/rss/uscourts-gamd.xml', 'District Court GA Middle District', 'judicial'),
    ('/rss/uscourts-ganb.xml', 'District Court GA Northern Bankruptcy', 'judicial'),
    ('/rss/uscourts-gand.xml', 'District Court GA Northern District', 'judicial'),
    ('/rss/uscourts-gud.xml', 'District Court District of Guam', 'judicial'),
    ('/rss/uscourts-hib.xml', 'District Court HI Bankruptcy', 'judicial'),
    ('/rss/uscourts-hid.xml', 'District Court District of Hawaii', 'judicial'),
    ('/rss/uscourts-ianb.xml', 'District Court IA Northern Bankruptcy', 'judicial'),
    ('/rss/uscourts-iand.xml', 'District Court IA Northern District', 'judicial'),
    ('/rss/uscourts-idd.xml', 'District Court District of Idaho', 'judicial'),
    ('/rss/uscourts-ilcb.xml', 'District Court IL Central Bankruptcy', 'judicial'),
    ('/rss/uscourts-ilnb.xml', 'District Court IL Northern Bankruptcy', 'judicial'),
    ('/rss/uscourts-ilnd.xml', 'District Court IL Northern District', 'judicial'),
    ('/rss/uscourts-ilsb.xml', 'District Court IL Southern Bankruptcy', 'judicial'),
    ('/rss/uscourts-ilsd.xml', 'District Court IL Southern District', 'judicial'),
    ('/rss/uscourts-insb.xml', 'District Court IN Southern Bankruptcy', 'judicial'),
    ('/rss/uscourts-insd.xml', 'District Court IN Southern District', 'judicial'),
    ('/rss/uscourts-ksd.xml', 'District Court District of Kansas', 'judicial'),
    ('/rss/uscourts-kyeb.xml', 'District Court KY Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-kyed.xml', 'District Court KY Eastern District', 'judicial'),
    ('/rss/uscourts-kywb.xml', 'District Court KY Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-kywd.xml', 'District Court KY Western District', 'judicial'),
    ('/rss/uscourts-laeb.xml', 'District Court LA Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-laed.xml', 'District Court LA Eastern District', 'judicial'),
    ('/rss/uscourts-lamb.xml', 'District Court LA Middle Bankruptcy', 'judicial'),
    ('/rss/uscourts-lamd.xml', 'District Court LA Middle District', 'judicial'),
    ('/rss/uscourts-lawb.xml', 'District Court LA Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-mab.xml', 'District Court MA Bankruptcy', 'judicial'),
    ('/rss/uscourts-mad.xml', 'District Court District of Massachusetts', 'judicial'),
    ('/rss/uscourts-mdb.xml', 'District Court MD Bankruptcy', 'judicial'),
    ('/rss/uscourts-mdd.xml', 'District Court District of Maryland', 'judicial'),
    ('/rss/uscourts-meb.xml', 'District Court ME Bankruptcy', 'judicial'),
    ('/rss/uscourts-med.xml', 'District Court District of Maine', 'judicial'),
    ('/rss/uscourts-mied.xml', 'District Court MI Eastern District', 'judicial'),
    ('/rss/uscourts-miwb.xml', 'District Court MI Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-miwd.xml', 'District Court MI Western District', 'judicial'),
    ('/rss/uscourts-mnb.xml', 'District Court MN Bankruptcy', 'judicial'),
    ('/rss/uscourts-mnd.xml', 'District Court District of Minnesota', 'judicial'),
    ('/rss/uscourts-moeb.xml', 'District Court MO Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-moed.xml', 'District Court MO Eastern District', 'judicial'),
    ('/rss/uscourts-mowb.xml', 'District Court MO Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-mowd.xml', 'District Court MO Western District', 'judicial'),
    ('/rss/uscourts-msnb.xml', 'District Court MS Northern Bankruptcy', 'judicial'),
    ('/rss/uscourts-mtb.xml', 'District Court MT Bankruptcy', 'judicial'),
    ('/rss/uscourts-mtd.xml', 'District Court District of Montana', 'judicial'),
    ('/rss/uscourts-nceb.xml', 'District Court NC Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-ncmd.xml', 'District Court NC Middle District', 'judicial'),
    ('/rss/uscourts-ncwb.xml', 'District Court NC Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-ncwd.xml', 'District Court NC Western District', 'judicial'),
    ('/rss/uscourts-ndb.xml', 'District Court ND Bankruptcy', 'judicial'),
    ('/rss/uscourts-ndd.xml', 'District Court District of North Dakota', 'judicial'),
    ('/rss/uscourts-neb.xml', 'District Court NE Bankruptcy', 'judicial'),
    ('/rss/uscourts-ned.xml', 'District Court District of Nebraska', 'judicial'),
    ('/rss/uscourts-nhb.xml', 'District Court NH Bankruptcy', 'judicial'),
    ('/rss/uscourts-nhd.xml', 'District Court District of New Hampshire', 'judicial'),
    ('/rss/uscourts-njb.xml', 'District Court NJ Bankruptcy', 'judicial'),
    ('/rss/uscourts-njd.xml', 'District Court District of New Jersey', 'judicial'),
    ('/rss/uscourts-nmb.xml', 'District Court NM Bankruptcy', 'judicial'),
    ('/rss/uscourts-nmd.xml', 'District Court District of New Mexico', 'judicial'),
    ('/rss/uscourts-nmid.xml', 'District Court Northern Mariana Islands', 'judicial'),
    ('/rss/uscourts-nvb.xml', 'District Court NV Bankruptcy', 'judicial'),
    ('/rss/uscourts-nyeb.xml', 'District Court NY Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-nyed.xml', 'District Court NY Eastern District', 'judicial'),
    ('/rss/uscourts-nynb.xml', 'District Court NY Northern Bankruptcy', 'judicial'),
    ('/rss/uscourts-nynd.xml', 'District Court NY Northern District', 'judicial'),
    ('/rss/uscourts-nysb.xml', 'District Court NY Southern Bankruptcy', 'judicial'),
    ('/rss/uscourts-nysd.xml', 'District Court NY Southern District', 'judicial'),
    ('/rss/uscourts-nywb.xml', 'District Court NY Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-nywd.xml', 'District Court NY Western District', 'judicial'),
    ('/rss/uscourts-ohnb.xml', 'District Court OH Northern Bankruptcy', 'judicial'),
    ('/rss/uscourts-ohnd.xml', 'District Court OH Northern District', 'judicial'),
    ('/rss/uscourts-ohsb.xml', 'District Court OH Southern Bankruptcy', 'judicial'),
    ('/rss/uscourts-ohsd.xml', 'District Court OH Southern District', 'judicial'),
    ('/rss/uscourts-okeb.xml', 'District Court OK Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-oked.xml', 'District Court OK Eastern District', 'judicial'),
    ('/rss/uscourts-oknb.xml', 'District Court OK Northern Bankruptcy', 'judicial'),
    ('/rss/uscourts-okwb.xml', 'District Court OK Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-okwd.xml', 'District Court OK Western District', 'judicial'),
    ('/rss/uscourts-orb.xml', 'District Court OR Bankruptcy', 'judicial'),
    ('/rss/uscourts-ord.xml', 'District Court District of Oregon', 'judicial'),
    ('/rss/uscourts-paeb.xml', 'District Court PA Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-paed.xml', 'District Court PA Eastern District', 'judicial'),
    ('/rss/uscourts-pamb.xml', 'District Court PA Middle Bankruptcy', 'judicial'),
    ('/rss/uscourts-pamd.xml', 'District Court PA Middle District', 'judicial'),
    ('/rss/uscourts-pawb.xml', 'District Court PA Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-pawd.xml', 'District Court PA Western District', 'judicial'),
    ('/rss/uscourts-prb.xml', 'District Court PR Bankruptcy', 'judicial'),
    ('/rss/uscourts-prd.xml', 'District Court District of Puerto Rico', 'judicial'),
    ('/rss/uscourts-rib.xml', 'District Court RI Bankruptcy', 'judicial'),
    ('/rss/uscourts-rid.xml', 'District Court District of Rhode Island', 'judicial'),
    ('/rss/uscourts-scb.xml', 'District Court SC Bankruptcy', 'judicial'),
    ('/rss/uscourts-sdb.xml', 'District Court SD Bankruptcy', 'judicial'),
    ('/rss/uscourts-sdd.xml', 'District Court District of South Dakota', 'judicial'),
    ('/rss/uscourts-tneb.xml', 'District Court TN Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-tned.xml', 'District Court TN Eastern District', 'judicial'),
    ('/rss/uscourts-tnmb.xml', 'District Court TN Middle Bankruptcy', 'judicial'),
    ('/rss/uscourts-tnmd.xml', 'District Court TN Middle District', 'judicial'),
    ('/rss/uscourts-tnwd.xml', 'District Court TN Western District', 'judicial'),
    ('/rss/uscourts-txed.xml', 'District Court TX Eastern District', 'judicial'),
    ('/rss/uscourts-txnd.xml', 'District Court TX Northern District', 'judicial'),
    ('/rss/uscourts-txsb.xml', 'District Court TX Southern Bankruptcy', 'judicial'),
    ('/rss/uscourts-txsd.xml', 'District Court TX Southern District', 'judicial'),
    ('/rss/uscourts-txwb.xml', 'District Court TX Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-txwd.xml', 'District Court TX Western District', 'judicial'),
    ('/rss/uscourts-utd.xml', 'District Court District of Utah', 'judicial'),
    ('/rss/uscourts-vawb.xml', 'District Court VA Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-vib.xml', 'District Court Virgin Islands Bankruptcy', 'judicial'),
    ('/rss/uscourts-vid.xml', 'District Court District of Virgin Islands', 'judicial'),
    ('/rss/uscourts-vtd.xml', 'District Court District of Vermont', 'judicial'),
    ('/rss/uscourts-waeb.xml', 'District Court WA Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-waed.xml', 'District Court WA Eastern District', 'judicial'),
    ('/rss/uscourts-wawb.xml', 'District Court WA Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-wieb.xml', 'District Court WI Eastern Bankruptcy', 'judicial'),
    ('/rss/uscourts-wiwb.xml', 'District Court WI Western Bankruptcy', 'judicial'),
    ('/rss/uscourts-wiwd.xml', 'District Court WI Western District', 'judicial'),
    ('/rss/uscourts-wvnb.xml', 'District Court WV Northern Bankruptcy', 'judicial'),
    ('/rss/uscourts-wvnd.xml', 'District Court WV Northern District', 'judicial'),
    ('/rss/uscourts-wyb.xml', 'District Court WY Bankruptcy', 'judicial'),
    ('/rss/uscourts-wyd.xml', 'District Court District of Wyoming', 'judicial'),
    # ── Bulk data feeds ──
    ('/rss/bills-bulkdata.xml', 'Bills Bulk Data', 'legislation'),
    ('/rss/billstatus-batch.xml', 'Bill Status Batch', 'legislation'),
    ('/rss/billstatus-bulkdata.xml', 'Bill Status Bulk Data', 'legislation'),
    ('/rss/billsum-bulkdata.xml', 'Bill Summaries Bulk Data', 'legislation'),
    ('/rss/cfr-bulkdata.xml', 'CFR Bulk Data', 'regulation'),
    ('/rss/comps-bulkdata.xml', 'Statute Compilations Bulk', 'legislation'),
    ('/rss/ecfr-bulkdata.xml', 'eCFR Bulk Data', 'regulation'),
    ('/rss/fr-bulkdata.xml', 'Federal Register Bulk Data', 'regulation'),
    ('/rss/govman-bulkdata.xml', 'Government Manual Bulk', 'directory'),
    ('/rss/hman-bulkdata.xml', 'House Manual Bulk', 'congress'),
    ('/rss/pai-bulkdata.xml', 'Privacy Act Issuances Bulk', 'regulation'),
    ('/rss/ppp-bulkdata.xml', 'Presidential Papers Bulk', 'executive'),
    ('/rss/statute-bulkdata.xml', 'Statutes Bulk Data', 'legislation'),
]:
    if path not in ALL_FEEDS:
        ALL_FEEDS[path] = (name, cat)

print(f"=== Importing {len(ALL_FEEDS)} total govinfo.gov feeds ===")
print("(duplicates will be skipped automatically)\n")

ok, skip, err = 0, 0, 0
cats = {}

for path, (name, category) in sorted(ALL_FEEDS.items()):
    feed_url = f"{BASE}{path}"
    body_json = json.dumps({
        'feed_url': feed_url,
        'name': f'US Gov: {name}',
        'category': category,
        'site_url': BASE,
        'enabled': True,
        'auto_pull': True,
        'adaptive_interval_minutes': 1440,
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
    elif '"id"' in resp:
        ok += 1
        cats[category] = cats.get(category, 0) + 1
        if ok % 20 == 0:
            print(f"  ... {ok} imported so far ...")
    else:
        err += 1
        print(f"  ERR  {name[:60]} → {resp[:100]}")

print(f"\n=== Summary: {ok} new, {skip} skipped (already exist), {err} errors ===")
print("\nNew imports by category:")
for c, n in sorted(cats.items()):
    print(f"  {c}: {n}")
