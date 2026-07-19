#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';

interface FoundryObjectTypeSummary {
  apiName: string;
  displayName: string;
  rid: string;
  primaryKey: string;
  titleProperty: string;
  propertyCount: number;
  propertyNames: string[];
}

interface HarvestEntityType {
  id: string;
  label: string;
  stix_type: string | null;
  stix_identity_class: string | null;
  identifiers: string[];
}

interface FoundryCompareReport {
  generatedAt: string;
  foundry: {
    baseUrl: string;
    ontologyRid: string;
    objectTypeCount: number;
    objectTypes: FoundryObjectTypeSummary[];
  };
  harvest: {
    version: string;
    entityTypeCount: number;
    entityTypes: HarvestEntityType[];
  };
  comparison: {
    matched: Array<{
      localEntityType: string;
      foundryObjectType: string;
      foundryDisplayName: string;
      foundryPrimaryKey: string;
      foundryPropertyCount: number;
    }>;
    missingInFoundry: string[];
    foundryOnly: string[];
  };
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function overlapScore(left: string[], right: string[]): number {
  const l = new Set(left.map(normalizeKey));
  const r = new Set(right.map(normalizeKey));
  let hits = 0;
  for (const item of l) {
    if (r.has(item)) hits += 1;
  }
  return hits;
}

function bestCandidate(entity: HarvestEntityType, objectTypes: FoundryObjectTypeSummary[]) {
  const targetKey = normalizeKey(entity.id);
  let best: { score: number; objectType: FoundryObjectTypeSummary } | null = null;
  for (const item of objectTypes) {
    let score = 0;
    if (normalizeKey(item.apiName) === targetKey) score += 5;
    if (normalizeKey(item.displayName) === targetKey) score += 4;
    if (normalizeKey(item.displayName) === normalizeKey(entity.label)) score += 3;
    score += overlapScore(entity.identifiers, item.propertyNames) * 2;
    if (!best || score > best.score) best = { score, objectType: item };
  }
  return best && best.score > 0 ? best : null;
}

async function main() {
  const outDir = path.resolve('artifacts/ontology');
  const reportFile = path.join(outDir, 'foundry-ontology-report.json');
  if (!fs.existsSync(reportFile)) {
    throw new Error(`Missing ${reportFile}. Run npm run ontology:compare:foundry first.`);
  }

  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8')) as FoundryCompareReport;
  const foundryByApiName = new Map(report.foundry.objectTypes.map((item) => [item.apiName, item]));

  const matched = report.comparison.matched.map((item) => ({
    harvestEntityType: item.localEntityType,
    foundryObjectType: item.foundryObjectType,
    strategy: 'exactish-match',
    confidence: 'high',
    notes: `Matched by normalized object type name. Foundry primary key: ${item.foundryPrimaryKey}.`,
  }));

  const suggested = report.harvest.entityTypes
    .filter((entity) => report.comparison.missingInFoundry.includes(entity.id))
    .map((entity) => {
      const candidate = bestCandidate(entity, report.foundry.objectTypes);
      return {
        harvestEntityType: entity.id,
        suggestion: candidate
          ? {
              foundryObjectType: candidate.objectType.apiName,
              displayName: candidate.objectType.displayName,
              confidence: candidate.score >= 5 ? 'medium' : 'low',
              score: candidate.score,
              notes: `Identifier overlap: ${entity.identifiers.join(', ') || 'none'} -> ${candidate.objectType.propertyNames.join(', ') || 'none'}`,
            }
          : null,
      };
    });

  const foundryOnly = report.comparison.foundryOnly.map((apiName) => {
    const item = foundryByApiName.get(apiName);
    return {
      foundryObjectType: apiName,
      displayName: item?.displayName || apiName,
      primaryKey: item?.primaryKey || null,
      propertyNames: item?.propertyNames || [],
    };
  });

  const mapping = {
    generatedAt: new Date().toISOString(),
    sourceReport: 'foundry-ontology-report.json',
    foundryOntologyRid: report.foundry.ontologyRid,
    harvestOntologyVersion: report.harvest.version,
    matched,
    suggested,
    foundryOnly,
  };

  const outFile = path.join(outDir, 'foundry-ontology-mapping.json');
  fs.writeFileSync(outFile, `${JSON.stringify(mapping, null, 2)}\n`, 'utf8');
  console.log(`[ontology:map:foundry] wrote ${outFile}`);
  console.log(
    `[ontology:map:foundry] matched=${matched.length} suggested=${suggested.length} foundryOnly=${foundryOnly.length}`,
  );
}

main().catch((err) => {
  console.error('[ontology:map:foundry] failed:', err);
  process.exit(1);
});
