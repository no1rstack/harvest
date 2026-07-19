import type { Express, Request, Response } from 'express';
import { getHarvestPool } from '../../db/harvestPostgres.js';
import { requirePool } from './context.js';
import { listServicesCatalog } from './catalog.js';
import { listFeedDigest, listCommunityItemsRpc, listFeedSourcesRpc } from './handlers/news.js';
import { listEarthquakes } from './handlers/seismology.js';
import { listClimateDisasters } from './handlers/climate.js';
import { listCyberThreats } from './handlers/cyber.js';
import { listAircraftPositions } from './handlers/aviation.js';
import { executeBatch } from './handlers/batch.js';
import { getCommunityStatus, runCommunityPull } from './handlers/platform.js';
import { validationError } from './schemas/errors.js';

function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => void {
  return (req, res) => {
    fn(req, res).catch((err: unknown) => {
      res.status(500).json({ error: (err as Error).message });
    });
  };
}

/**
 * Harvest foundation API — World Monitor layout (/api/<service>/v1/<rpc-name>).
 * Ingestion stays Harvest-owned; Judicium community map may use legacy aliases.
 */
export function registerHarvestV1Routes(app: Express): void {
  // ── News ──
  app.get(
    '/api/news/v1/list-feed-digest',
    asyncHandler(async (req, res) => {
      res.json(await listFeedDigest(getHarvestPool(), req.query));
    }),
  );

  app.get(
    '/api/news/v1/list-community-items',
    asyncHandler(async (req, res) => {
      const pool = requirePool(res);
      if (!pool) return;
      res.json(await listCommunityItemsRpc(pool, req.query));
    }),
  );

  app.get(
    '/api/news/v1/list-feed-sources',
    asyncHandler(async (req, res) => {
      const pool = requirePool(res);
      if (!pool) return;
      res.json(await listFeedSourcesRpc(pool));
    }),
  );

  // ── Seismology ──
  app.get(
    '/api/seismology/v1/list-earthquakes',
    asyncHandler(async (req, res) => {
      res.json(await listEarthquakes(getHarvestPool(), req.query));
    }),
  );

  // ── Climate ──
  app.get(
    '/api/climate/v1/list-climate-disasters',
    asyncHandler(async (req, res) => {
      res.json(await listClimateDisasters(getHarvestPool(), req.query));
    }),
  );

  // ── Cyber ──
  app.get(
    '/api/cyber/v1/list-cyber-threats',
    asyncHandler(async (req, res) => {
      res.json(await listCyberThreats(getHarvestPool(), req.query));
    }),
  );

  // ── Aviation ──
  app.get(
    '/api/aviation/v1/list-aircraft-positions',
    asyncHandler(async (req, res) => {
      res.json(await listAircraftPositions(getHarvestPool(), req.query));
    }),
  );

  // ── Batch ──
  app.post(
    '/api/batch/v1/execute',
    asyncHandler(async (req, res) => {
      const operations = req.body?.operations;
      const result = await executeBatch(operations, getHarvestPool());
      if ('status' in result && result.status !== 200) {
        res.status(result.status).json(result.body);
        return;
      }
      res.json(result);
    }),
  );

  // ── Platform ops ──
  app.get(
    '/api/platform/v1/list-services',
    (_req, res) => {
      res.json(listServicesCatalog());
    },
  );

  app.get(
    '/api/platform/v1/get-community-status',
    asyncHandler(async (_req, res) => {
      res.json(await getCommunityStatus(getHarvestPool()));
    }),
  );

  app.post(
    '/api/platform/v1/run-community-pull',
    asyncHandler(async (req, res) => {
      const which = String(req.body?.which || req.query?.which || 'daily');
      if (!['layers', 'rss', 'daily', 'corpus', 'shared', 'aiid'].includes(which)) {
        res.status(400).json(
          validationError([{ field: 'which', description: 'must be layers, rss, corpus, or daily' }]),
        );
        return;
      }
      res.json(await runCommunityPull(which));
    }),
  );
}
