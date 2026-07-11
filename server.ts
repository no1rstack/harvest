/**
 * Harvest — Collection Platform API + Intelligence Core.
 * Serves harvest.noirstack.com (registry, observations, intelligence v1).
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

for (const file of ['.env.harvest.local', '.env.local', '.env']) {
  const full = path.join(process.cwd(), file);
  if (fs.existsSync(full)) dotenv.config({ path: full, override: false });
}

import {
  registerHarvestAuthRoutes,
  requireHarvestAuth,
  redirectHarvestSurface,
} from './src/routes/harvestAuth.js';
import { registerHarvestRoutes } from './src/routes/harvestRoutes.js';
import { registerCollectionRoutes } from './src/routes/collectionRoutes.js';
import { registerIntelligenceRoutes } from './src/routes/intelligenceRoutes.js';
import { registerPlatformRoutes, bootPlatformScheduler } from './src/routes/platformRoutes.js';
import { registerFeedsRoutes } from './src/routes/feedsRoutes.js';
import { renderMetricsText } from './src/api/metrics.js';

const app = express();
const server = createServer(app);

app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  const allowed = [
    'https://harvest.noirstack.com',
    'http://localhost:3020',
    'http://127.0.0.1:3020',
  ];
  if (origin && (allowed.includes(origin) || origin.endsWith('.noirstack.com'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Collection-Token, X-Request-Id');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', apiLimiter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, product: 'harvest', service: 'collection-platform' });
});

app.get('/metrics', (_req, res) => {
  res.type('text/plain').send(renderMetricsText());
});

app.use('/api/', (err: any, _req: any, res: any, _next: any) => {
  console.error('[harvest] API error:', err?.message || err);
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : (err?.message || 'Unknown error'),
    status,
  });
});

app.use('/api/', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path.startsWith('/api/collection/') || req.path.startsWith('/collection/')) {
    const expected = process.env.COLLECTION_INTERNAL_TOKEN || '';
    const got = String(req.headers['x-collection-token'] || '');
    if (expected && got === expected) return next();
  }
  const origin = req.headers.origin as string | undefined;
  const referer = req.headers.referer as string | undefined;
  const hostOk = (value: string) =>
    value === 'https://harvest.noirstack.com' ||
    value.startsWith('http://localhost:') ||
    value.startsWith('http://127.0.0.1:') ||
    value.endsWith('.noirstack.com');
  if (origin && hostOk(origin)) return next();
  if (referer && hostOk(referer)) return next();
  res.status(403).json({ error: 'CSRF validation failed' });
});

registerHarvestAuthRoutes(app);
app.use(requireHarvestAuth);
app.use(redirectHarvestSurface);
registerHarvestRoutes(app);
registerCollectionRoutes(app);
registerIntelligenceRoutes(app);
registerPlatformRoutes(app);
registerFeedsRoutes(app);

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: ['harvest.noirstack.com', 'localhost', process.env.HOSTNAME || ''].filter(Boolean),
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distAssetsDir = path.resolve('dist/assets');
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const assetMatch = req.path.match(/^\/assets\/([^/]+)$/);
      if (!assetMatch) return next();
      try {
        const files = fs.readdirSync(distAssetsDir);
        const hit = files.find((f) => f.toLowerCase() === assetMatch[1].toLowerCase());
        if (hit) return res.sendFile(path.join(distAssetsDir, hit));
      } catch {
        /* fall through */
      }
      next();
    });
    app.use(express.static('dist'));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      if (/\.(js|mjs|css|woff2?|png|jpe?g|gif|svg|ico|webp|map)$/i.test(req.path)) {
        return res.status(404).type('text/plain').send('Not found');
      }
      res.sendFile(path.resolve('dist/index.html'));
    });
  }

  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3020;
  const BIND_HOST = process.env.HOST || process.env.BIND_HOST || '0.0.0.0';
  server.listen(PORT, BIND_HOST, () => {
    console.log(`[harvest] Collection Platform on http://${BIND_HOST}:${PORT}`);
    bootPlatformScheduler();
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('[harvest] failed to start:', err);
    process.exit(1);
  });
}

export { app, server };
