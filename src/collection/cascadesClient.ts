import crypto from 'crypto';
/**
 * Thin client — enqueue collection workflows on Cascades (sole execution engine).
 */

export interface CascadesRunSubmission {
  runId: string;
  workflow_id: string;
  status: string;
  executionMode?: string;
}

export interface CascadesRunDetail {
  runId: string;
  workflowId: string;
  status: string;
  nodeStatuses?: Record<string, string>;
  nodeResults?: Record<string, unknown>;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

function cascadesBaseUrl(): string {
  if (!process.env.CASCADES_API_URL) throw new Error('CASCADES_API_URL is required (set in Infisical)');
  return process.env.CASCADES_API_URL.replace(/\/$/, '');
}

function safeLogMeta(path: string, status: number, requestId: string): string {
  const host = new URL(cascadesBaseUrl()).host;
  return `collection_api_host=${host} path=${path} status=${status} request_id=${requestId}`;
}

export async function submitCascadesWorkflow(
  workflowId: string,
  context: Record<string, unknown>,
  opts: { idempotencyKey?: string; actor?: string; dryRun?: boolean } = {},
): Promise<CascadesRunSubmission> {
  const requestId = crypto.randomUUID();
  const path = `/api/workflows/${workflowId}/run`;
  const url = `${cascadesBaseUrl()}${path}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = process.env.COLLECTION_INTERNAL_TOKEN?.trim();
  if (token) headers['X-Collection-Token'] = token;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      context: { ...context, dryRun: Boolean(opts.dryRun) },
      actor: opts.actor || 'harvest-scheduler',
      executionMode: 'inline',
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${safeLogMeta(path, res.status, requestId)} body=${text.slice(0, 200)}`);
  }

  const body = (await res.json()) as Record<string, unknown>;
  return {
    runId: String(body.runId || body.run_id),
    workflow_id: String(body.workflow_id || workflowId),
    status: String(body.status || 'accepted'),
    executionMode: body.executionMode ? String(body.executionMode) : undefined,
  };
}

export async function getCascadesRun(runId: string): Promise<CascadesRunDetail | null> {
  const requestId = crypto.randomUUID();
  const path = `/api/runs/${runId}`;
  const res = await fetch(`${cascadesBaseUrl()}${path}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(safeLogMeta(path, res.status, requestId));
  }
  const body = (await res.json()) as Record<string, unknown>;
  return {
    runId: String(body.runId || runId),
    workflowId: String(body.workflowId || ''),
    status: String(body.status || ''),
    nodeStatuses: body.nodeStatuses as Record<string, string> | undefined,
    nodeResults: body.nodeResults as Record<string, unknown> | undefined,
    error: body.error ? String(body.error) : undefined,
    startedAt: body.startedAt ? String(body.startedAt) : undefined,
    completedAt: body.completedAt ? String(body.completedAt) : undefined,
  };
}

export async function waitForCascadesRun(
  runId: string,
  opts: { timeoutMs?: number; pollMs?: number } = {},
): Promise<CascadesRunDetail> {
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const pollMs = opts.pollMs ?? 3_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const run = await getCascadesRun(runId);
    if (!run) throw new Error(`Cascades run not found: ${runId}`);
    if (['completed', 'failed', 'cancelled', 'completed_with_warnings'].includes(run.status)) {
      return run;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Cascades run timeout run_id=${runId}`);
}

// ── Discovery & Observability ──

export interface CascadesWorkflowSummary {
  id: string;
  name: string;
  description?: string;
  status?: string;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface CascadesStatus {
  connected: boolean;
  url: string;
  health?: unknown;
  error?: string;
  workflowCount: number;
  workflows: CascadesWorkflowSummary[];
}

const cascadesFetch = async (path: string, init?: RequestInit): Promise<Response> => {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> || {}) };
  const token = process.env.COLLECTION_INTERNAL_TOKEN?.trim();
  if (token) headers['X-Collection-Token'] = token;
  return fetch(`${cascadesBaseUrl()}${path}`, { ...init, headers, signal: AbortSignal.timeout(10_000) });
};

export async function listCascadesWorkflows(): Promise<CascadesWorkflowSummary[]> {
  try {
    const res = await cascadesFetch('/api/workflows');
    if (!res.ok) return [];
    const body = (await res.json()) as { workflows?: Array<Record<string, unknown>> };
    const list = body.workflows ?? [];
    return list.map((w: Record<string, unknown>) => ({
      id: String(w.id || w.workflowId || w.workflow_id || ''),
      name: String(w.name || w.display_name || w.id || ''),
      description: w.description ? String(w.description) : undefined,
      status: w.status ? String(w.status) : undefined,
      version: typeof w.version === 'number' ? w.version : undefined,
      createdAt: w.createdAt ? String(w.createdAt) : undefined,
      updatedAt: w.updatedAt ? String(w.updatedAt) : undefined,
    }));
  } catch {
    return [];
  }
}

export async function fetchCascadesStatus(): Promise<CascadesStatus> {
  const url = cascadesBaseUrl();
  const result: CascadesStatus = { connected: false, url, workflowCount: 0, workflows: [] };

  try {
    const healthRes = await cascadesFetch('/health');
    if (!healthRes.ok) {
      result.error = `health HTTP ${healthRes.status}`;
      return result;
    }
    result.health = await healthRes.json().catch(() => undefined);
    result.connected = true;
  } catch (err: unknown) {
    result.error = (err as Error).message;
    return result;
  }

  const workflows = await listCascadesWorkflows();
  result.workflows = workflows;
  result.workflowCount = workflows.length;
  return result;
}
