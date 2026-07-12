/**
 * Keyword expansion for collection seeding — drives threat-feed / RSS harvest targets.
 */

export interface ExpandedKeyword {
  term: string;
  source: string;
  confidence: number;
}

const COLLECTION_TEMPLATES: Record<string, string[]> = {
  sanctions: ['{term} sanctions list', '{term} OFAC SDN', '{term} EU consolidated list', '"{term}" site:treasury.gov'],
  cyber: ['{term} vulnerability', '{term} malware', '{term} ransomware', '{term} CVE'],
  defense: ['{term} military', '{term} conflict', '{term} weapons'],
  intelligence: ['{term} osint', '{term} investigation', '{term} surveillance'],
  default: ['"{term}"', '{term} news', '{term} report'],
};

const DOMAIN_ALIASES: Record<string, string[]> = {
  sanctions: ['restrictions', 'embargo', 'designations'],
  ransomware: ['extortion', 'encryption', 'lockbit'],
  malware: ['trojan', 'backdoor', 'rat'],
  vessel: ['ship', 'tanker', 'maritime'],
};

function templateExpand(term: string, goal?: string): string[] {
  const templates = COLLECTION_TEMPLATES[goal || ''] || COLLECTION_TEMPLATES.default;
  return templates.map((t) => t.replace(/\{term\}/g, term));
}

function aliasExpand(term: string): string[] {
  const lower = term.toLowerCase();
  const out: string[] = [];
  for (const [key, aliases] of Object.entries(DOMAIN_ALIASES)) {
    if (lower.includes(key)) {
      for (const alias of aliases) out.push(lower.replace(key, alias));
    }
    for (const alias of aliases) {
      if (lower.includes(alias)) out.push(lower.replace(alias, key));
    }
  }
  return out;
}

function operatorExpand(term: string): string[] {
  return [
    `"${term}"`,
    `${term} site:gov`,
    `${term} filetype:pdf`,
    `site:opensanctions.org ${term}`,
  ];
}

export function expandKeywordsForCollection(
  seeds: string[],
  options?: { goal?: string; maxPerSeed?: number; includeOperators?: boolean },
): ExpandedKeyword[] {
  const maxPerSeed = options?.maxPerSeed ?? 8;
  const seen = new Set<string>();
  const results: ExpandedKeyword[] = [];

  const add = (term: string, source: string, confidence: number) => {
    const normalized = term.trim().toLowerCase();
    if (!normalized || normalized.length < 3 || seen.has(normalized)) return;
    seen.add(normalized);
    results.push({ term: term.trim(), source, confidence });
  };

  for (const seed of seeds) {
    const base = seed.trim();
    if (!base) continue;
    add(base, 'seed', 1);

    let count = 0;
    for (const t of templateExpand(base, options?.goal)) {
      if (++count > maxPerSeed) break;
      add(t, 'template', 0.85);
    }
    for (const t of aliasExpand(base)) {
      if (++count > maxPerSeed) break;
      add(t, 'alias', 0.75);
    }
    if (options?.includeOperators !== false) {
      for (const t of operatorExpand(base)) {
        if (++count > maxPerSeed) break;
        add(t, 'operator', 0.7);
      }
    }
  }

  return results;
}

export function goalFromCategory(category?: string): string | undefined {
  const c = (category || '').toLowerCase();
  if (c.includes('sanction')) return 'sanctions';
  if (c.includes('cyber')) return 'cyber';
  if (c.includes('defense')) return 'defense';
  if (c.includes('osint') || c.includes('intel')) return 'intelligence';
  return undefined;
}
