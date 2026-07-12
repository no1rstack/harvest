import type { Express } from 'express';
import { buildDataCatalog, getTableDetail } from '../data-catalog/buildCatalog.js';
import { getLineageForTable } from '../data-catalog/narratives.js';

export function registerDataCatalogRoutes(app: Express): void {
  app.get('/api/data-catalog', async (_req, res) => {
    try {
      res.json(await buildDataCatalog());
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/data-catalog/lineage/:table', async (req, res) => {
    try {
      const lineage = getLineageForTable(req.params.table);
      if (!lineage) return res.status(404).json({ error: 'No lineage journey for this table' });
      res.json(lineage);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/data-catalog/tables/:database/:table', async (req, res) => {
    try {
      const detail = await getTableDetail(req.params.database, req.params.table);
      if ('error' in detail && detail.error === 'Unknown database') return res.status(404).json(detail);
      res.json(detail);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
