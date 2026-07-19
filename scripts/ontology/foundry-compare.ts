#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { createPlatformClient } from '@osdk/client';
import { createConfidentialOauthClient } from '@osdk/oauth';
import { ObjectTypesV2 } from '@osdk/foundry.ontologies';
import { getOntologySnapshot } from '../../src/intelligence/ontology/registry.js';
import { normalizeOntologySnapshot, ontologyComparisonKey } from '../../src/intelligence/ontology/normalize.js';
import { loadOntologyEnvFiles } from './env.js';

interface FoundryObjectTypeSummary {
  apiName: string;
  displayName: string;
  rid: string;
  primaryKey: string;
  titleProperty: string;
  propertyCount: number;
  propertyNames: string[];
}

function requiredEnv(name: string): string {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

async function listAllObjectTypes(baseUrl: string, ontologyRid: string) {
  const clientId = requiredEnv('PALANTIR_CLIENT_ID');
  const clientSecret = requiredEnv('PALANTIR_CLIENT_SECRET');
  const scopes = String(process.env.PALANTIR_SCOPES || 'api:ontologies-read')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const auth = createConfidentialOauthClient(clientId, clientSecret, baseUrl, scopes);
  const platform = createPlatformClient(baseUrl, auth);

  const out: FoundryObjectTypeSummary[] = [];
  let pageToken: string | undefined;
  do {
    const page = await ObjectTypesV2.list(platform, ontologyRid, {
      pageSize: 100,
      pageToken,
    });
    for (const item of page.data) {
      out.push({
        apiName: String(item.apiName),
        displayName: String(item.displayName),
        rid: String(item.rid),
        primaryKey: String(item.primaryKey),
        titleProperty: String(item.titleProperty),
        propertyCount: Object.keys(item.properties || {}).length,
        propertyNames: Object.keys(item.properties || {}).sort(),
      });
    }
    pageToken = page.nextPageToken ? String(page.nextPageToken) : undefined;
  } while (pageToken);

  return out.sort((a, b) => a.apiName.localeCompare(b.apiName));
}

async function main() {
  loadOntologyEnvFiles();
  const baseUrl = requiredEnv('PALANTIR_FOUNDRY_URL').replace(/\/$/, '');
  const ontologyRid = requiredEnv('PALANTIR_ONTOLOGY_RID');
  const local = normalizeOntologySnapshot(getOntologySnapshot());
  const remote = await listAllObjectTypes(baseUrl, ontologyRid);

  const remoteByKey = new Map(remote.map((item) => [ontologyComparisonKey(item.apiName), item]));
  const localByKey = new Map(local.entityTypes.map((item) => [ontologyComparisonKey(item.id), item]));

  const missingInFoundry = local.entityTypes
    .filter((entity) => !remoteByKey.has(ontologyComparisonKey(entity.id)))
    .map((entity) => entity.id);
  const foundryOnly = remote
    .filter((item) => !localByKey.has(ontologyComparisonKey(item.apiName)))
    .map((item) => item.apiName);

  const matched = local.entityTypes
    .map((entity) => {
      const hit = remoteByKey.get(ontologyComparisonKey(entity.id));
      if (!hit) return null;
      return {
        localEntityType: entity.id,
        foundryObjectType: hit.apiName,
        foundryDisplayName: hit.displayName,
        foundryPrimaryKey: hit.primaryKey,
        foundryPropertyCount: hit.propertyCount,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  const report = {
    generatedAt: new Date().toISOString(),
    foundry: {
      baseUrl,
      ontologyRid,
      objectTypeCount: remote.length,
      objectTypes: remote,
    },
    harvest: {
      version: local.version,
      entityTypeCount: local.entityTypes.length,
      entityTypes: local.entityTypes,
    },
    comparison: {
      matched,
      missingInFoundry,
      foundryOnly,
    },
  };

  const outDir = path.resolve('artifacts/ontology');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'foundry-ontology-report.json');
  fs.writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(`[ontology:compare:foundry] wrote ${outFile}`);
  console.log(
    `[ontology:compare:foundry] harvest=${local.entityTypes.length} foundry=${remote.length} matched=${matched.length} missingInFoundry=${missingInFoundry.length} foundryOnly=${foundryOnly.length}`,
  );
}

main().catch((err) => {
  console.error('[ontology:compare:foundry] failed:', err);
  process.exit(1);
});
