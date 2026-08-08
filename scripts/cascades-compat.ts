#!/usr/bin/env node
/**
 * cascades-compat — local Cascades API proxy for Harvest development.
 *
 * Provides:
 *   GET  /health                              — health check
 *   GET  /api/workflows                        — list registered workflows
 *   POST /api/workflows                        — register a workflow definition
 *   POST /api/workflows/:id/run                — start a simulated run
 *   GET  /api/runs/:id                         — get run status
 *
 * On run completion, calls Harvest's completion hook.
 */
import express, { Request, Response, RequestHandler } from 'express';
import crypto from 'crypto';

const PORT = parseInt(process.env.CASCADES_COMPAT_PORT || '3100', 10);
const HARVEST_URL = (process.env.HARVEST_API_URL || 'http://127.0.0.1:3020').replace(/\/$/, '');
const INTERNAL_TOKEN = process.env.COLLECTION_INTERNAL_TOKEN || 'dev-token';

interface WorkflowDefinition {
  id: string; name: string; description?: string;
  nodes?: Array<{ id: string; type: string; label: string }>;
  completion_hook?: { url: string; method: string; headers: Record<string,string>; include: string[] };
  createdAt: string;
}

interface SimulatedRun {
  runId: string; workflow_id: string; status: string;
  context: Record<string,unknown>; nodeStatuses: Record<string,string>;
  nodeResults: Record<string,unknown>; error?: string;
  startedAt: string; completedAt?: string;
}

const app = express();
app.use(express.json({ limit: '2mb' }));

const workflows = new Map<string, WorkflowDefinition>();
const runs = new Map<string, SimulatedRun>();

const requireAuth: RequestHandler = (req, res, next) => {
  const token = req.headers['x-collection-token'];
  if (token !== INTERNAL_TOKEN) { res.status(401).json({ error: 'invalid token' }); return; }
  next();
};

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: 'ok', app: 'cascades-compat', engine: 'cascades-compat', environment: 'development', timestamp: new Date().toISOString() });
});

app.get('/api/workflows', (_req, res) => {
  res.json({ workflows: Array.from(workflows.values()).map(w => ({
    id: w.id, name: w.name, description: w.description, status: 'active', createdAt: w.createdAt,
  }))});
});

app.post('/api/workflows', requireAuth, (req, res) => {
  const { id, name, description, nodes, completion_hook } = req.body || {};
  if (!id || !name) { res.status(400).json({ error: 'id and name required' }); return; }
  const wf: WorkflowDefinition = {
    id: String(id), name: String(name), description: description ? String(description) : undefined,
    nodes: nodes || [], completion_hook: completion_hook || undefined, createdAt: new Date().toISOString(),
  };
  workflows.set(wf.id, wf);
  console.log(`[cascades-compat] registered: ${wf.id}`);
  res.status(201).json({ ok: true, workflow: wf });
});

app.post('/api/workflows/:id/run', requireAuth, (req, res) => {
  const wf = workflows.get(req.params.id);
  if (!wf) { res.status(404).json({ error: `workflow not found: ${req.params.id}` }); return; }
  const body = req.body || {};
  const context = (body.context || {}) as Record<string,unknown>;
  const runId = `compat-${Date.now()}-${crypto.randomUUID().slice(0,8)}`;
  const run: SimulatedRun = {
    runId, workflow_id: req.params.id, status: 'running', context,
    nodeStatuses: {}, nodeResults: {}, startedAt: new Date().toISOString(),
  };
  for (const node of (wf.nodes || [])) { run.nodeStatuses[node.id] = 'running'; }
  runs.set(runId, run);

  const delay = Math.min((wf.nodes?.length || 1) * 500 + 2000, 30000);
  setTimeout(async () => {
    for (const node of (wf.nodes || [])) {
      run.nodeStatuses[node.id] = 'completed';
      run.nodeResults[node.id] = { status: 'completed', inserted: Math.floor(Math.random() * 50), skipped: Math.floor(Math.random() * 10) };
    }
    run.status = 'completed'; run.completedAt = new Date().toISOString();

    if (wf.completion_hook) {
      try {
        const hookUrl = wf.completion_hook.url.replace('${HARVEST_API_URL}', HARVEST_URL).replace('${COLLECTION_INTERNAL_TOKEN}', INTERNAL_TOKEN);
        await fetch(hookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Collection-Token': INTERNAL_TOKEN },
          body: JSON.stringify({ runId, run_id: runId, workflow_id: req.params.id, status: run.status, started_at: run.startedAt, completed_at: run.completedAt, nodeResults: run.nodeResults, node_results: run.nodeResults, ...context }),
        });
      } catch (err) { console.warn(`[cascades-compat] hook failed:`, (err as Error).message); }
    }
  }, delay);

  console.log(`[cascades-compat] run ${runId} for ${req.params.id} (~${delay}ms)`);
  res.status(202).json({ runId, run_id: runId, workflow_id: req.params.id, status: 'accepted', executionMode: body.executionMode || 'inline' });
});

app.get('/api/runs/:id', (req, res) => {
  const run = runs.get(req.params.id);
  if (!run) { res.status(404).json({ error: 'not_found' }); return; }
  res.json(run);
});

app.get('/api/runs', (_req, res) => {
  res.json({ runs: Array.from(runs.values()).map(r => ({ runId: r.runId, workflow_id: r.workflow_id, status: r.status, startedAt: r.startedAt, completedAt: r.completedAt })), count: runs.size });
});

app.post('/api/deploy', requireAuth, async (req, res) => {
  const body = req.body;
  const defs = Array.isArray(body) ? body : (body.workflows && Array.isArray(body.workflows) ? body.workflows : []);
  if (!defs.length) { res.status(400).json({ error: 'Expected array or {workflows:[...]}' }); return; }
  let count = 0;
  for (const wf of defs) { if (wf.id && wf.name) { workflows.set(wf.id, { ...wf, createdAt: new Date().toISOString() }); count++; } }
  console.log(`[cascades-compat] deployed ${count} workflows`);
  res.json({ ok: true, deployed: count, workflow_count: workflows.size });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[cascades-compat] port ${PORT} → ${HARVEST_URL}`);
});
