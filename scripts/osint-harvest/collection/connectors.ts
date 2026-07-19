/**
 * Connector execution — invoked only via Harvest step API from Cascades nodes.
 */

import { crtshHarvester } from '../harvesters/crtsh.js';
import { dnsHarvester } from '../harvesters/dns.js';
import { rdapHarvester } from '../harvesters/rdap.js';
import { waybackHarvester } from '../harvesters/wayback.js';
import { hackertargetHarvester } from '../harvesters/hackertarget.js';
import { urlhausHarvester } from '../harvesters/urlhaus.js';
import { rssHarvester } from '../harvesters/rss.js';
import { holeheHarvester, sherlockHarvester, maigretHarvester } from '../harvesters/identity-cli.js';
import { undataHarvester } from '../harvesters/undata.js';
import {
  worldbankHarvester,
  datagovHarvester,
  fincenHarvester,
  blockchainHarvester,
  ibanHarvester,
  alephHarvester,
} from '../harvesters/open-data.js';
import { aptnotesHarvester, openskyHarvester } from '../harvesters/transport-threat.js';
import type { Harvester, HarvestFinding } from '../types.js';
import type { CollectionTarget } from '../../../src/collection/types.js';
import { CONNECTOR_VERSION } from '../../../src/collection/executionContext.js';

const ALL_HARVESTERS: Harvester[] = [
  crtshHarvester,
  dnsHarvester,
  rdapHarvester,
  waybackHarvester,
  hackertargetHarvester,
  urlhausHarvester,
  rssHarvester,
  holeheHarvester,
  sherlockHarvester,
  maigretHarvester,
  undataHarvester,
  worldbankHarvester,
  datagovHarvester,
  fincenHarvester,
  blockchainHarvester,
  ibanHarvester,
  alephHarvester,
  aptnotesHarvester,
  openskyHarvester,
];

export const HARVESTER_MAP = new Map(ALL_HARVESTERS.map((h) => [h.id, h]));
export const CONNECTOR_IDS = ALL_HARVESTERS.map((h) => h.id);

export async function runSingleConnector(
  target: CollectionTarget,
  connectorId: string,
  opts: { maxResults?: number; timeoutMs?: number } = {},
): Promise<{
  connector: string;
  connector_version: string;
  findings: HarvestFinding[];
  errors: string[];
  status: 'completed' | 'failed';
  duration_ms: number;
}> {
  const t0 = Date.now();
  const h = HARVESTER_MAP.get(connectorId);
  if (!h) {
    return {
      connector: connectorId,
      connector_version: CONNECTOR_VERSION,
      findings: [],
      errors: [`unknown connector: ${connectorId}`],
      status: 'failed',
      duration_ms: Date.now() - t0,
    };
  }

  const ctx = {
    target: target.value,
    caseId: target.case_id ?? undefined,
    userId: 'collection-platform',
    maxResults: opts.maxResults ?? 100,
    timeoutMs: opts.timeoutMs ?? 20000,
    userAgent: process.env.OSINT_USER_AGENT || 'NoirStack-CollectionPlatform/1.0',
  };

  try {
    const result = await h.run(ctx);
    const errors = result.errors.map((e) => `${connectorId}: ${e}`);
    return {
      connector: connectorId,
      connector_version: CONNECTOR_VERSION,
      findings: result.findings,
      errors,
      status: errors.length && result.findings.length === 0 ? 'failed' : 'completed',
      duration_ms: Date.now() - t0,
    };
  } catch (err) {
    return {
      connector: connectorId,
      connector_version: CONNECTOR_VERSION,
      findings: [],
      errors: [`${connectorId}: ${(err as Error).message}`],
      status: 'failed',
      duration_ms: Date.now() - t0,
    };
  }
}
