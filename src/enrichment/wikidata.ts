/**
 * Wikidata resolution — resolve text terms to Q-IDs via the Wikidata REST API.
 * Uses entity search + entity detail endpoints to build canonical records.
 */

import type { WikidataEntity, WikidataResolution } from './types';

const WIKIDATA_BASE = 'https://www.wikidata.org/wiki/Special:EntityData';
const WIKIDATA_SEARCH = 'https://www.wikidata.org/w/api.php';
const USER_AGENT = 'Harvest-Collection-Platform/1.0 (noirstack.com; research@noirstack.com)';
const MIN_REQUEST_DELAY = 120; // ms between Wikidata API calls

let lastRequestTime = 0;

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_DELAY) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_DELAY - elapsed));
  }
  lastRequestTime = Date.now();
}

// Most interesting properties for the intelligence domain
const RELEVANT_PROPERTIES: Record<string, string> = {
  P31: 'instance of',
  P279: 'subclass of',
  P17: 'country',
  P571: 'inception',
  P569: 'date of birth',
  P570: 'date of death',
  P36: 'capital',
  P625: 'coordinate location',
  P740: 'location of formation',
  P1082: 'population',
  P2139: 'total revenue',
  P112: 'founded by',
  P571: 'inception',
  P276: 'location',
  P463: 'member of',
  P530: 'diplomatic relation',
  P1313: 'office held by head of government',
  P1906: 'office held by head of state',
  P1412: 'languages spoken',
  P364: 'original language of work',
  P495: 'country of origin',
  P137: 'operator',
  P355: 'subsidiary',
  P749: 'parent organization',
  P2388: 'office held by head of the organization',
  P2403: 'total assets',
  P286: 'head coach',
  P136: 'genre',
  P127: 'owned by',
  P354: 'political ideology',
  P1142: 'political ideology',
  P1387: 'political alignment',
  P1056: 'product or material produced',
  P452: 'industry',
  P5698: 'inchi',
  P662: 'PubChem CID',
  P232: 'EC number',
  P486: 'MeSH descriptor ID',
  P699: 'DiseasesDB',
};

async function wikidataApi(params: Record<string, string>, retries: number = 3): Promise<any> {
  await rateLimit();
  const url = new URL(WIKIDATA_SEARCH);
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
    });

    if (res.status === 429 && attempt < retries) {
      const delay = Math.min(3000 * Math.pow(2, attempt), 30000);
      console.warn(`[wikidata] 429 rate-limited, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    if (!res.ok) throw new Error(`Wikidata API error: ${res.status} ${res.statusText}`);
    return res.json();
  }
  throw new Error('Wikidata API request failed after retries');
}

async function getEntityData(qid: string): Promise<any> {
  await rateLimit();
  const url = `${WIKIDATA_BASE}/${qid}.json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Wikidata entity error: ${res.status}`);
  return res.json();
}

export async function searchWikidata(term: string, language: string = 'en'): Promise<Array<{ id: string; label: string; description: string; score: number }>> {
  const data = await wikidataApi({
    action: 'wbsearchentities',
    search: term,
    language,
    limit: '8',
    type: 'item',
    props: '', // reduce payload
  });
  return (data.search || []).map((r: any) => ({
    id: r.id,
    label: r.label || r.id,
    description: r.description || '',
    score: r.score || 0,
  }));
}

function resolvePropertyLabel(data: any, pid: string): string {
  return RELEVANT_PROPERTIES[pid] || pid;
}

function resolveValueLabel(data: any, mainsnak: any): string {
  if (!mainsnak) return '';
  const dv = mainsnak.datavalue;
  if (!dv) {
    if (mainsnak.snaktype === 'novalue') return '<no value>';
    if (mainsnak.snaktype === 'somevalue') return '<unknown>';
    return '';
  }
  switch (dv.type) {
    case 'string': return String(dv.value);
    case 'wikibase-entityid': {
      const valueQid = dv.value.id;
      const label = data.entities[valueQid]?.labels?.en?.value;
      return label || valueQid;
    }
    case 'time': return dv.value.time;
    case 'quantity': {
      const q = dv.value;
      return `${q.amount}${q.unit ? ' ' + q.unit.split('/').pop()?.replace(/-/g, ' ') : ''}`;
    }
    case 'globe-coordinate':
      return `${dv.value.latitude}, ${dv.value.longitude}`;
    default: return JSON.stringify(dv.value);
  }
}

export async function resolveWikidataEntity(qid: string): Promise<WikidataEntity> {
  const data = await getEntityData(qid);
  const entity = data.entities[qid];
  if (!entity) throw new Error(`Entity ${qid} not found`);

  const labels = entity.labels || {};
  const label = labels.en?.value || labels[Object.keys(labels)[0]]?.value || qid;
  const descriptions = entity.descriptions || {};
  const description = descriptions.en?.value || Object.values(descriptions)[0]?.value || '';

  // Instance types
  const p31 = entity.claims?.P31 || [];
  const instanceLabels = p31.map((s: any) => {
    const qid = s.mainsnak?.datavalue?.value?.id;
    if (!qid) return '';
    return data.entities[qid]?.labels?.en?.value || data.entities[qid]?.labels?.[Object.keys(data.entities[qid]?.labels || {})[0]]?.value || '';
  }).filter(Boolean);

  // If instance labels are empty, use description from Wikidata
  const effectiveEntityType = instanceLabels.length > 0
    ? instanceLabels.join(', ')
    : description || 'entity';

  // Sitelinks
  const sitelinks: Record<string, string> = {};
  const sitelinksRaw = entity.sitelinks || {};
  for (const [wiki, sl] of Object.entries<any>(sitelinksRaw)) {
    sitelinks[wiki] = sl.title;
  }

  // Wikipedia info
  const enwiki = sitelinksRaw.enwiki;
  const wikipediaPageId = enwiki?.badges?.length ? undefined : undefined; // need entity
  const wikipediaTitle = enwiki?.title;
  const wikipediaUrl = enwiki ? `https://en.wikipedia.org/wiki/${encodeURIComponent(enwiki.title)}` : undefined;

  // Claims extraction
  const claims: WikidataEntity['claims'] = [];
  for (const [pid, stmts] of Object.entries(entity.claims || {})) {
    if (!RELEVANT_PROPERTIES[pid]) continue;
    for (const s of stmts as any[]) {
      const value = resolveValueLabel(data, s.mainsnak);
      const valueId = s.mainsnak?.datavalue?.value?.id;
      if (!value) continue;
      claims.push({
        property: pid,
        propertyLabel: resolvePropertyLabel(data, pid),
        value,
        valueId,
      });
    }
  }

  // Coordinates
  let coordinates: { lat: number; lon: number } | undefined;
  const coords = entity.claims?.P625;
  if (coords?.length) {
    const cv = coords[0].mainsnak?.datavalue?.value;
    if (cv) coordinates = { lat: cv.latitude, lon: cv.longitude };
  }

  // Country
  const country = entity.claims?.P17;
  let countryId: string | undefined;
  let countryLabel: string | undefined;
  if (country?.length) {
    countryId = country[0].mainsnak?.datavalue?.value?.id;
    if (countryId) {
      countryLabel = data.entities[countryId]?.labels?.en?.value || countryId;
    }
  }

  // Inception date
  const inception = entity.claims?.P571;
  const inceptionDate = inception?.[0]?.mainsnak?.datavalue?.value?.time;

  return {
    id: qid,
    label,
    description,
    aliases: (entity.aliases?.en || []).map((a: any) => a.value),
    entityType: effectiveEntityType,
    wikipediaTitle,
    wikipediaUrl,
    sitelinks,
    claims,
    coordinates,
    inceptionDate,
    countryId,
    countryLabel,
    lastModified: entity.modified || new Date().toISOString(),
    wikipediaPageId: undefined, // available via pageprops
  };
}

export async function resolveTermToWikidata(term: string): Promise<WikidataResolution> {
  const results = await searchWikidata(term);

  if (!results.length) {
    return {
      inputTerm: term,
      canonicalLabel: term,
      wikidataId: '',
      entityType: 'unknown',
      resolutionConfidence: 0,
      resolutionEvidence: ['No Wikidata search results.'],
      resolvedAt: new Date().toISOString(),
    };
  }

  const top = results[0];

  // Confidence heuristic based on score gap + label match
  let confidence = top.score / 100; // raw score is 0-100+
  const labelLower = top.label.toLowerCase();
  const termLower = term.toLowerCase();

  if (labelLower === termLower) {
    confidence = Math.min(1, confidence + 0.3);
  } else if (labelLower.includes(termLower) || termLower.includes(labelLower)) {
    confidence = Math.min(1, confidence + 0.1);
  }

  // Boost if top result is much better than second
  if (results.length > 1 && (top.score - results[1].score) > 20) {
    confidence = Math.min(1, confidence + 0.1);
  }

  const evidence: string[] = [
    `Search term: "${term}"`,
    `Top match: ${top.label} (score: ${top.score})`,
    `Description: ${top.description || 'none'}`,
  ];
  if (results.length > 1) {
    evidence.push(`Runner-up: ${results[1].label} (score: ${results[1].score})`);
  }

  return {
    inputTerm: term,
    canonicalLabel: top.label,
    wikidataId: top.id,
    entityType: top.description || 'unknown',
    resolutionConfidence: Math.round(confidence * 100) / 100,
    resolutionEvidence: evidence,
    resolvedAt: new Date().toISOString(),
  };
}
