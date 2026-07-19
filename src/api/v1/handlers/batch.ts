import type { Pool } from 'pg';
import { HARVEST_BATCH_ALLOWLIST } from '../catalog.js';
import { validationError } from '../schemas/errors.js';
import { listFeedDigest, listCommunityItemsRpc, listFeedSourcesRpc } from './news.js';
import { listEarthquakes } from './seismology.js';
import { listClimateDisasters } from './climate.js';
import { listCyberThreats } from './cyber.js';
import { listAircraftPositions } from './aviation.js';
import { getCommunityStatus } from './platform.js';
import { listServicesCatalog } from '../catalog.js';

export interface BatchOperation {
  id?: string;
  path: string;
}

export interface BatchOperationResult {
  id: string;
  status: number;
  body?: Record<string, unknown>;
  error?: string;
}

export interface ExecuteBatchResponse {
  results: BatchOperationResult[];
  succeeded: number;
  failed: number;
}

function parsePath(path: string): { pathname: string; query: Record<string, string> } {
  const url = new URL(path, 'http://harvest.local');
  const query: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) query[k] = v;
  return { pathname: url.pathname, query };
}

async function dispatchGet(
  pathname: string,
  query: Record<string, string>,
  pool: Pool | null,
): Promise<{ status: number; body?: Record<string, unknown>; error?: string }> {
  try {
    switch (pathname) {
      case '/api/news/v1/list-feed-digest':
        return { status: 200, body: (await listFeedDigest(pool, query)) as unknown as Record<string, unknown> };
      case '/api/news/v1/list-community-items': {
        if (!pool) return { status: 503, error: 'no_database' };
        return {
          status: 200,
          body: (await listCommunityItemsRpc(pool, query)) as unknown as Record<string, unknown>,
        };
      }
      case '/api/news/v1/list-feed-sources': {
        if (!pool) return { status: 503, error: 'no_database' };
        return {
          status: 200,
          body: (await listFeedSourcesRpc(pool)) as unknown as Record<string, unknown>,
        };
      }
      case '/api/seismology/v1/list-earthquakes':
        return {
          status: 200,
          body: (await listEarthquakes(pool, query)) as unknown as Record<string, unknown>,
        };
      case '/api/climate/v1/list-climate-disasters':
        return {
          status: 200,
          body: (await listClimateDisasters(pool, query)) as unknown as Record<string, unknown>,
        };
      case '/api/cyber/v1/list-cyber-threats':
        return {
          status: 200,
          body: (await listCyberThreats(pool, query)) as unknown as Record<string, unknown>,
        };
      case '/api/aviation/v1/list-aircraft-positions':
        return {
          status: 200,
          body: (await listAircraftPositions(pool, query)) as unknown as Record<string, unknown>,
        };
      case '/api/platform/v1/get-community-status':
        return {
          status: 200,
          body: (await getCommunityStatus(pool)) as unknown as Record<string, unknown>,
        };
      case '/api/platform/v1/list-services':
        return { status: 200, body: listServicesCatalog() as unknown as Record<string, unknown> };
      default:
        return { status: 404, error: 'unknown_path' };
    }
  } catch (err: unknown) {
    return { status: 500, error: (err as Error).message };
  }
}

export async function executeBatch(
  operations: BatchOperation[],
  pool: Pool | null,
): Promise<ExecuteBatchResponse | { status: number; body: unknown }> {
  if (!Array.isArray(operations) || operations.length < 1) {
    return {
      status: 400,
      body: validationError([{ field: 'operations', description: 'at least one operation required' }]),
    };
  }
  if (operations.length > 20) {
    return {
      status: 400,
      body: validationError([{ field: 'operations', description: 'maximum 20 operations per batch' }]),
    };
  }

  const results: BatchOperationResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const id = op.id || String(i);
    const rawPath = String(op.path || '').trim();
    if (!rawPath) {
      results.push({ id, status: 0, error: 'invalid_path' });
      failed += 1;
      continue;
    }

    const { pathname, query } = parsePath(rawPath);
    if (pathname.startsWith('/api/batch/')) {
      results.push({ id, status: 0, error: 'nested_batch' });
      failed += 1;
      continue;
    }
    if (!HARVEST_BATCH_ALLOWLIST.has(pathname)) {
      results.push({ id, status: 0, error: 'invalid_path' });
      failed += 1;
      continue;
    }

    const out = await dispatchGet(pathname, query, pool);
    if (out.status >= 200 && out.status < 300) {
      succeeded += 1;
      results.push({ id, status: out.status, body: out.body });
    } else {
      failed += 1;
      results.push({ id, status: out.status || 0, error: out.error, body: out.body });
    }
  }

  return { results, succeeded, failed };
}
