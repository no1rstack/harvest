#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';

interface SuggestedMappingFile {
  generatedAt: string;
  sourceReport: string;
  foundryOntologyRid: string;
  harvestOntologyVersion: string;
  matched: Array<{
    harvestEntityType: string;
    foundryObjectType: string;
    strategy: string;
    confidence: string;
    notes: string;
  }>;
  suggested: Array<{
    harvestEntityType: string;
    suggestion: null | {
      foundryObjectType: string;
      displayName: string;
      confidence: string;
      score: number;
      notes: string;
    };
  }>;
  foundryOnly: Array<{
    foundryObjectType: string;
    displayName: string;
    primaryKey: string | null;
    propertyNames: string[];
  }>;
}

interface CanonicalFoundryMapping {
  version: string;
  generatedAt: string;
  foundryOntologyRid: string;
  harvestOntologyVersion: string;
  entityTypeMappings: Array<{
    harvestEntityType: string;
    foundryObjectType: string;
    status: 'mapped' | 'suggested' | 'unmapped';
    confidence: 'high' | 'medium' | 'low';
    strategy: string;
    notes: string;
  }>;
  foundryUnmappedObjectTypes: Array<{
    foundryObjectType: string;
    displayName: string;
    primaryKey: string | null;
    propertyNames: string[];
  }>;
}

async function main() {
  const mappingFile = path.resolve('artifacts/ontology/foundry-ontology-mapping.json');
  if (!fs.existsSync(mappingFile)) {
    throw new Error(`Missing ${mappingFile}. Run npm run ontology:map:foundry first.`);
  }

  const source = JSON.parse(fs.readFileSync(mappingFile, 'utf8')) as SuggestedMappingFile;

  const entityTypeMappings: CanonicalFoundryMapping['entityTypeMappings'] = [
    ...source.matched.map((row) => ({
      harvestEntityType: row.harvestEntityType,
      foundryObjectType: row.foundryObjectType,
      status: 'mapped' as const,
      confidence: row.confidence as 'high' | 'medium' | 'low',
      strategy: row.strategy,
      notes: row.notes,
    })),
    ...source.suggested.map((row) => {
      if (row.suggestion) {
        return {
          harvestEntityType: row.harvestEntityType,
          foundryObjectType: row.suggestion.foundryObjectType,
          status: 'suggested' as const,
          confidence: row.suggestion.confidence as 'high' | 'medium' | 'low',
          strategy: 'heuristic-identifier-overlap',
          notes: row.suggestion.notes,
        };
      }
      return {
        harvestEntityType: row.harvestEntityType,
        foundryObjectType: '',
        status: 'unmapped' as const,
        confidence: 'low' as const,
        strategy: 'no-candidate',
        notes: 'No Foundry object type candidate scored above zero.',
      };
    }),
  ].sort((a, b) => a.harvestEntityType.localeCompare(b.harvestEntityType));

  const canonical: CanonicalFoundryMapping = {
    version: '1',
    generatedAt: new Date().toISOString(),
    foundryOntologyRid: source.foundryOntologyRid,
    harvestOntologyVersion: source.harvestOntologyVersion,
    entityTypeMappings,
    foundryUnmappedObjectTypes: source.foundryOnly,
  };

  const outFile = path.resolve('src/intelligence/ontology/foundry-canonical-mapping.json');
  fs.writeFileSync(outFile, `${JSON.stringify(canonical, null, 2)}\n`, 'utf8');

  console.log(`[ontology:canonicalize:foundry] wrote ${outFile}`);
  console.log(
    `[ontology:canonicalize:foundry] mapped=${entityTypeMappings.filter((x) => x.status === 'mapped').length} suggested=${entityTypeMappings.filter((x) => x.status === 'suggested').length} unmapped=${entityTypeMappings.filter((x) => x.status === 'unmapped').length}`,
  );
}

main().catch((err) => {
  console.error('[ontology:canonicalize:foundry] failed:', err);
  process.exit(1);
});
