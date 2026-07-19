#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { getHarvestPool } from '../../src/db/harvestPostgres.js';
import { getOntologySnapshot, hydrateOntologyFromPool } from '../../src/intelligence/ontology/registry.js';
import { normalizeOntologySnapshot } from '../../src/intelligence/ontology/normalize.js';
import { loadOntologyEnvFiles } from './env.js';

async function main() {
  loadOntologyEnvFiles();
  const pool = getHarvestPool();
  if (pool) {
    try {
      await hydrateOntologyFromPool(pool);
    } catch {
      /* fall back to in-memory seed */
    }
  }

  const normalized = normalizeOntologySnapshot(getOntologySnapshot());
  const outDir = path.resolve('artifacts/ontology');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'harvest-ontology.json');
  fs.writeFileSync(outFile, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');

  console.log(`[ontology:export] wrote ${outFile}`);
  console.log(
    `[ontology:export] entityTypes=${normalized.entityTypes.length} aliases=${normalized.entityAliases.length} observableTypes=${normalized.observableTypes.length}`,
  );
}

main().catch((err) => {
  console.error('[ontology:export] failed:', err);
  process.exit(1);
});
