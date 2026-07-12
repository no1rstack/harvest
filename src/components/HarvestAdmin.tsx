/**
 * Collection Platform ops console — Keycloak-gated registry, observations, and ops.
 * Legacy routes: /api/harvest/*, harvest.noirstack.com
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Radar, RefreshCw, Play, FileText, AlertTriangle, Check, Clock,
  Database, Crosshair, ListTree, Terminal, LogIn, LogOut, Brain, Settings, Layers, Rss,
} from 'lucide-react';
import { ArchitectureExplorer } from './ArchitectureExplorer';
import { FeedIntelligenceExplorer } from './FeedIntelligenceExplorer';
import { cn } from '../types';

interface HarvestAuthState {
  required: boolean;
  authenticated: boolean;
  user?: { sub: string; email?: string; name?: string; preferred_username?: string } | null;
  loginUrl?: string;
  logoutUrl?: string;
}

interface HarvestSummary {
  runs: number;
  findings: number;
  inserted: number;
  running: number;
  failed: number;
  last_run_at?: string | null;
}

interface HarvestRun {
  id: string;
  target: string;
  case_id?: number | null;
  status: string;
  total_findings: number;
  inserted: number;
  skipped: number;
  harvesters?: string[];
  errors?: unknown;
  started_at: string;
  finished_at?: string | null;
}

const CASCADES_DEFAULT = 'http://127.0.0.1:3102';

function cascadesWorkflowUrl(template: string, runId: string, base = CASCADES_DEFAULT) {
  return `${base.replace(/\/$/, '')}/dashboard/workflow/${encodeURIComponent(template)}?runId=${encodeURIComponent(runId)}`;
}

interface HarvestFinding {
  id: string;
  run_id?: string;
  source: string;
  entity_type: string;
  value: string;
  label?: string;
  title: string;
  description?: string;
  severity?: string;
  confidence?: number;
  product?: string;
  tags?: string[];
  created_at: string;
  observed_at?: string;
  run_target?: string;
  raw?: unknown;
  workflow_template?: string | null;
  workflow_version?: string | null;
  workflow_run_id?: string | null;
  node_id?: string | null;
  connector_id?: string | null;
  target_id?: string | null;
}

interface HarvestStatus {
  enabled: boolean;
  summary: HarvestSummary;
  runs: HarvestRun[];
  bySource: Array<{ source: string; count: number }>;
  byEntityType: Array<{ entity_type: string; count: number }>;
  recentFindings: HarvestFinding[];
  daily: {
    startedAt?: string;
    finishedAt?: string;
    products?: string;
    runs?: number;
    failed?: number;
    totalFindings?: number;
    totalInserted?: number;
    totalErrors?: number;
    log?: string;
    dryRun?: boolean;
  } | null;
  job?: { running: boolean; startedAt?: string; lastExit?: number | null; lastLog?: string };
}

const HARVESTERS = ['crtsh', 'dns', 'rdap', 'hackertarget', 'urlhaus', 'rss', 'wayback'] as const;

function statusTone(status: string) {
  if (status === 'completed') return 'text-emerald-400/70 bg-emerald-400/[0.06]';
  if (status === 'running') return 'text-sky-400/70 bg-sky-400/[0.06]';
  return 'text-amber-400/70 bg-amber-400/[0.06]';
}

export const HarvestAdmin: React.FC<{ className?: string }> = ({ className }) => {
  const [auth, setAuth] = useState<HarvestAuthState | null>(null);
  const [tab, setTab] = useState<'ops' | 'findings' | 'registry' | 'graph' | 'intelligence' | 'feeds' | 'platform' | 'architecture'>('findings');
  const [data, setData] = useState<HarvestStatus | null>(null);
  const [targetsText, setTargetsText] = useState('');
  const [targetsDirty, setTargetsDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<{ run: HarvestRun; findings: HarvestFinding[] } | null>(null);
  const [form, setForm] = useState({
    product: 'shared',
    target: '',
    caseId: '',
    strategy: 'passive-domain-standard',
  });

  const [findingsQ, setFindingsQ] = useState('');
  const [findingsSource, setFindingsSource] = useState('');
  const [findingsType, setFindingsType] = useState('');
  const [findingsConnector, setFindingsConnector] = useState('');
  const [findingsProduct, setFindingsProduct] = useState('');
  const [findingsOffset, setFindingsOffset] = useState(0);
  const [findingsTotal, setFindingsTotal] = useState(0);
  const [findingsRows, setFindingsRows] = useState<HarvestFinding[]>([]);
  const [findingsBusy, setFindingsBusy] = useState(false);
  const [selectedFinding, setSelectedFinding] = useState<HarvestFinding | null>(null);
  const [registryRows, setRegistryRows] = useState<Array<{
    id: string; value: string; target_type: string; product: string;
    workflow_template: string; collection_profile?: string | null;
    collection_policy?: string | null; collection_strategy?: string | null;
    frequency: string; priority: number; enabled: boolean;
    owner?: string | null; classification?: string | null; tags?: string[];
    last_collected_at?: string | null; next_collect_at?: string | null;
    last_cascades_run_id?: string | null;
  }>>([]);
  const [registryTotal, setRegistryTotal] = useState(0);
  const [cascadesUrl, setCascadesUrl] = useState(CASCADES_DEFAULT);
  const [findingsWorkflowRunId, setFindingsWorkflowRunId] = useState('');
  const [opsMetrics, setOpsMetrics] = useState<Record<string, unknown> | null>(null);
  const [connectorHealth, setConnectorHealth] = useState<Array<{
    connector: string; status: string; successRate?: number; avgDurationMs?: number;
    lastSuccess?: string; lastError?: string;
  }>>([]);
  const [providers, setProviders] = useState<Array<{
    connector: string; status: string; runs24h: number; failures24h: number;
    observations24h: number; avgDurationMs?: number;
  }>>([]);
  const [strategies, setStrategies] = useState<Array<{
    id: string; name: string; description: string;
    workflow_template: string; profile: string; policy: string; priority: number;
    auto_discover: boolean;
  }>>([]);
  const [catalogWorkflows, setCatalogWorkflows] = useState<Array<{
    id: string; name: string; capabilities: string[];
  }>>([]);
  const [capabilityLabels, setCapabilityLabels] = useState<Record<string, string>>({});
  const [targetForm, setTargetForm] = useState({
    value: '',
    product: 'shared',
    strategy: 'passive-domain-standard',
  });
  const [graphSource, setGraphSource] = useState('');
  const [graphRunId, setGraphRunId] = useState('');
  const [graphEdges, setGraphEdges] = useState<Array<{
    id: string; source_value: string; target_value: string;
    relationship_type: string; target_type: string; confidence?: number;
    workflow_run_id?: string | null; connector_id?: string | null;
  }>>([]);
  const [graphBusy, setGraphBusy] = useState(false);

  const [intelClaims, setIntelClaims] = useState<Array<{ id: string; statement: string; status: string; created_at: string }>>([]);
  const [intelKnowledge, setIntelKnowledge] = useState<Array<{ id: string; kind: string; title: string; status: string }>>([]);
  const [intelEvidence, setIntelEvidence] = useState<Array<{ id: string; title: string; claim_id: string | null; status: string }>>([]);
  const [intelDashboard, setIntelDashboard] = useState<Array<Record<string, unknown>>>([]);
  const [intelBusy, setIntelBusy] = useState(false);
  const [claimDraft, setClaimDraft] = useState('');

  const [platformStatus, setPlatformStatus] = useState<Record<string, unknown> | null>(null);
  const [platformConfig, setPlatformConfig] = useState<Record<string, unknown> | null>(null);
  const [platformBusy, setPlatformBusy] = useState<string | null>(null);

  const loadPlatform = useCallback(async () => {
    setPlatformBusy('load');
    try {
      const [statusRes, configRes] = await Promise.all([
        fetch('/api/harvest/platform/status', { credentials: 'include' }),
        fetch('/api/harvest/platform/config', { credentials: 'include' }),
      ]);
      if (!statusRes.ok) throw new Error(`platform status ${statusRes.status}`);
      if (!configRes.ok) throw new Error(`platform config ${configRes.status}`);
      setPlatformStatus(await statusRes.json());
      const cfgBody = await configRes.json();
      setPlatformConfig(cfgBody.config || cfgBody);
    } catch (e) {
      setError((e as Error).message || 'Failed to load platform config');
    } finally {
      setPlatformBusy(null);
    }
  }, []);

  const savePlatform = useCallback(async () => {
    if (!platformConfig) return;
    setPlatformBusy('save');
    try {
      const res = await fetch('/api/harvest/platform/config', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: platformConfig }),
      });
      if (!res.ok) throw new Error(`save ${res.status}`);
      await loadPlatform();
    } catch (e) {
      setError((e as Error).message || 'Failed to save platform config');
    } finally {
      setPlatformBusy(null);
    }
  }, [platformConfig, loadPlatform]);

  const runPlatformJob = useCallback(async (kind: string) => {
    setPlatformBusy(kind);
    try {
      const res = await fetch(`/api/harvest/platform/run/${kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) throw new Error(`run ${kind} ${res.status}`);
      await loadPlatform();
    } catch (e) {
      setError((e as Error).message || `Failed to run ${kind}`);
    } finally {
      setPlatformBusy(null);
    }
  }, [loadPlatform]);

  const patchPlatform = useCallback((path: string[], value: unknown) => {
    setPlatformConfig((prev) => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as Record<string, unknown>;
      let cursor: Record<string, unknown> = next;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i];
        if (!cursor[key] || typeof cursor[key] !== 'object') cursor[key] = {};
        cursor = cursor[key] as Record<string, unknown>;
      }
      cursor[path[path.length - 1]] = value;
      return next;
    });
  }, []);

  const checkAuth = useCallback(async () => {
    const res = await fetch('/api/harvest/auth/status', { credentials: 'include' });
    if (!res.ok) throw new Error(`auth status ${res.status}`);
    const body = (await res.json()) as HarvestAuthState;
    setAuth(body);
    return body;
  }, []);

  const load = useCallback(async () => {
    try {
      const authState = await checkAuth();
      if (authState.required && !authState.authenticated) {
        setData(null);
        setError(null);
        return;
      }
      const [statusRes, targetsRes] = await Promise.all([
        fetch('/api/harvest/status', { credentials: 'include' }),
        fetch('/api/harvest/targets', { credentials: 'include' }),
      ]);
      if (statusRes.status === 401) {
        window.location.href = '/api/harvest/auth/login';
        return;
      }
      if (!statusRes.ok) throw new Error(`status ${statusRes.status}`);
      setData(await statusRes.json());
      if (targetsRes.ok) {
        const t = await targetsRes.json();
        if (!targetsDirty) setTargetsText(t.content || '');
      }
      setError(null);
    } catch (e) {
      setError((e as Error).message || 'Failed to load harvest status');
    }
  }, [targetsDirty, checkAuth]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const wr = params.get('workflowRunId') || params.get('workflow_run_id') || '';
    const src = params.get('source') || '';
    const node = params.get('nodeId') || params.get('node_id') || '';
    if (wr) {
      setFindingsWorkflowRunId(wr);
      setTab('findings');
    }
    if (src) setFindingsSource(src);
    if (node) {
      /* node filter applied via workflow run id grouping in UI */
    }
    void fetch('/api/harvest/config/public', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.cascadesUrl && setCascadesUrl(String(j.cascadesUrl)));
  }, []);

  useEffect(() => {
    void load();
    const i = setInterval(() => void load(), 15000);
    return () => clearInterval(i);
  }, [load]);

  const findingsLimit = 50;

  const loadRegistry = useCallback(async () => {
    try {
      const res = await fetch('/api/collection/targets?limit=100', { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/api/harvest/auth/login';
        return;
      }
      if (!res.ok) throw new Error(`registry ${res.status}`);
      const body = await res.json();
      setRegistryRows(body.targets || []);
      setRegistryTotal(body.total || 0);
    } catch (e) {
      setError((e as Error).message || 'Failed to load target registry');
    }
  }, []);

  const loadFindings = useCallback(async (offset = findingsOffset) => {
    setFindingsBusy(true);
    try {
      const params = new URLSearchParams({
        limit: String(findingsLimit),
        offset: String(offset),
      });
      if (findingsQ.trim()) params.set('q', findingsQ.trim());
      if (findingsSource) params.set('source', findingsSource);
      if (findingsType) params.set('entityType', findingsType);
      if (findingsConnector) params.set('connector', findingsConnector);
      if (findingsProduct) params.set('product', findingsProduct);
      if (findingsWorkflowRunId.trim()) params.set('workflowRunId', findingsWorkflowRunId.trim());
      const res = await fetch(`/api/harvest/findings?${params}`, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/api/harvest/auth/login';
        return;
      }
      if (!res.ok) throw new Error(`findings ${res.status}`);
      const body = await res.json();
      setFindingsRows(body.findings || []);
      setFindingsTotal(body.total || 0);
      setFindingsOffset(offset);
    } catch (e) {
      setError((e as Error).message || 'Failed to load findings');
    } finally {
      setFindingsBusy(false);
    }
  }, [findingsOffset, findingsQ, findingsSource, findingsType, findingsConnector, findingsProduct, findingsWorkflowRunId]);

  const loadOps = useCallback(async () => {
    try {
      const [metricsRes, healthRes, providersRes] = await Promise.all([
        fetch('/api/collection/ops/metrics', { credentials: 'include' }),
        fetch('/api/collection/connectors/health?sinceHours=24', { credentials: 'include' }),
        fetch('/api/collection/providers', { credentials: 'include' }),
      ]);
      if (metricsRes.ok) setOpsMetrics(await metricsRes.json());
      if (healthRes.ok) {
        const h = await healthRes.json();
        setConnectorHealth(h.connectors || []);
      }
      if (providersRes.ok) {
        const p = await providersRes.json();
        setProviders(p.providers || []);
      }
    } catch (e) {
      setError((e as Error).message || 'Failed to load ops metrics');
    }
  }, []);

  const loadMeta = useCallback(async () => {
    try {
      const [stratRes, catalogRes, capRes] = await Promise.all([
        fetch('/api/collection/strategies', { credentials: 'include' }),
        fetch('/api/collection/catalog', { credentials: 'include' }),
        fetch('/api/collection/capabilities', { credentials: 'include' }),
      ]);
      if (stratRes.ok) {
        const body = await stratRes.json();
        setStrategies(body.strategies || []);
      }
      if (catalogRes.ok) {
        const body = await catalogRes.json();
        setCatalogWorkflows(
          (body.workflows || []).map((w: { id: string; name: string; capabilities?: string[] }) => ({
            id: w.id,
            name: w.name,
            capabilities: w.capabilities || [],
          })),
        );
      }
      if (capRes.ok) {
        const body = await capRes.json();
        const labels: Record<string, string> = {};
        for (const c of body.capabilities || []) {
          if (c.id) labels[c.id] = c.label || c.id;
        }
        setCapabilityLabels(labels);
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  const loadGraph = useCallback(async () => {
    setGraphBusy(true);
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (graphSource.trim()) params.set('source', graphSource.trim());
      if (graphRunId.trim()) params.set('workflow_run_id', graphRunId.trim());
      const res = await fetch(`/api/collection/graph?${params}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`graph ${res.status}`);
      const body = await res.json();
      setGraphEdges(body.graph || []);
    } catch (e) {
      setError((e as Error).message || 'Failed to load collection graph');
    } finally {
      setGraphBusy(false);
    }
  }, [graphSource, graphRunId]);

  const loadIntelligence = useCallback(async () => {
    setIntelBusy(true);
    try {
      const [claimsRes, knowRes, evRes, dashRes] = await Promise.all([
        fetch('/api/intelligence/v1/claims?limit=50', { credentials: 'include' }),
        fetch('/api/intelligence/v1/knowledge?limit=50', { credentials: 'include' }),
        fetch('/api/intelligence/v1/evidence?limit=50', { credentials: 'include' }),
        fetch('/api/intelligence/v1/dashboard/targets', { credentials: 'include' }),
      ]);
      if (claimsRes.ok) {
        const b = await claimsRes.json();
        setIntelClaims(b.claims || []);
      }
      if (knowRes.ok) {
        const b = await knowRes.json();
        setIntelKnowledge(b.knowledge_objects || []);
      }
      if (evRes.ok) {
        const b = await evRes.json();
        setIntelEvidence(b.evidence_bundles || []);
      }
      if (dashRes.ok) {
        const b = await dashRes.json();
        setIntelDashboard(b.targets || []);
      }
    } catch (e) {
      setError((e as Error).message || 'Failed to load intelligence');
    } finally {
      setIntelBusy(false);
    }
  }, []);

  const createClaimFromFinding = useCallback(async () => {
    if (!selectedFinding || !claimDraft.trim()) return;
    setBusy('claim');
    try {
      const res = await fetch('/api/intelligence/v1/claims', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statement: claimDraft.trim(),
          observation_ids: [{ id: selectedFinding.id, role: 'supports' }],
          provenance_ids: [],
        }),
      });
      if (!res.ok) throw new Error(`claim ${res.status}`);
      setClaimDraft('');
      await loadIntelligence();
    } catch (e) {
      setError((e as Error).message || 'Failed to create claim');
    } finally {
      setBusy(null);
    }
  }, [selectedFinding, claimDraft, loadIntelligence]);

  const evaluateClaimById = useCallback(async (claimId: string) => {
    setBusy(`eval-${claimId}`);
    try {
      const res = await fetch(`/api/intelligence/v1/claims/${encodeURIComponent(claimId)}/evaluate`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`evaluate ${res.status}`);
      await loadIntelligence();
    } catch (e) {
      setError((e as Error).message || 'Failed to evaluate claim');
    } finally {
      setBusy(null);
    }
  }, [loadIntelligence]);

  const bundleEvidence = useCallback(async (claimId: string, title: string) => {
    setBusy(`ev-${claimId}`);
    try {
      const res = await fetch('/api/intelligence/v1/evidence', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claim_id: claimId, title }),
      });
      if (!res.ok) throw new Error(`evidence ${res.status}`);
      await loadIntelligence();
    } catch (e) {
      setError((e as Error).message || 'Failed to create evidence bundle');
    } finally {
      setBusy(null);
    }
  }, [loadIntelligence]);

  useEffect(() => {
    if (auth?.authenticated) void loadMeta();
  }, [auth?.authenticated, loadMeta]);

  useEffect(() => {
    if (auth?.authenticated && tab === 'registry') {
      void loadRegistry();
    }
  }, [auth?.authenticated, tab, loadRegistry]);

  useEffect(() => {
    if (auth?.authenticated && tab === 'ops') {
      void loadOps();
    }
  }, [auth?.authenticated, tab, loadOps]);

  useEffect(() => {
    if (auth?.authenticated && tab === 'graph') {
      void loadGraph();
    }
  }, [auth?.authenticated, tab, loadGraph]);

  useEffect(() => {
    if (auth?.authenticated && tab === 'intelligence') {
      void loadIntelligence();
    }
    if (auth?.authenticated && tab === 'platform') {
      void loadPlatform();
    }
  }, [auth?.authenticated, tab, loadIntelligence, loadPlatform]);

  useEffect(() => {
    if (auth?.authenticated && tab === 'findings') {
      void loadFindings(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.authenticated, tab]);

  const openFinding = async (id: string) => {
    try {
      const res = await fetch(`/api/harvest/findings/${encodeURIComponent(id)}`, { credentials: 'include' });
      if (!res.ok) throw new Error(`finding ${res.status}`);
      const body = await res.json();
      setSelectedFinding(body.finding);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (!selectedRun) {
      setRunDetail(null);
      return;
    }
    fetch(`/api/harvest/runs/${encodeURIComponent(selectedRun)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setRunDetail(j))
      .catch(() => setRunDetail(null));
  }, [selectedRun]);

  const saveTargets = async () => {
    setBusy('targets');
    try {
      const res = await fetch('/api/harvest/targets', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: targetsText }),
      });
      if (!res.ok) throw new Error(`save failed (${res.status})`);
      setTargetsDirty(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const triggerRun = async (mode: 'single' | 'daily' | 'daily-dry') => {
    setBusy(mode);
    try {
      const strategy = strategies.find((s) => s.id === form.strategy);
      const res = await fetch(
        mode === 'single' ? '/api/collection/run' : '/api/harvest/daily',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            mode === 'single'
              ? {
                  product: form.product,
                  target: form.target,
                  caseId: form.caseId ? Number(form.caseId) : undefined,
                  collection_strategy: form.strategy,
                  workflow_template: strategy?.workflow_template,
                  collection_profile: strategy?.profile,
                  collection_policy: strategy?.policy,
                  wait: false,
                }
              : { dryRun: mode === 'daily-dry' },
          ),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `trigger failed (${res.status})`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const summaryCards = useMemo(() => {
    const s = data?.summary;
    return [
      { label: 'Runs', value: s?.runs ?? '—' },
      { label: 'Findings', value: s?.findings ?? '—' },
      { label: 'Inserted', value: s?.inserted ?? '—' },
      { label: 'Running', value: s?.running ?? '—' },
      { label: 'Failed', value: s?.failed ?? '—' },
      {
        label: 'Last run',
        value: s?.last_run_at ? new Date(s.last_run_at).toLocaleString() : '—',
        small: true,
      },
    ];
  }, [data]);

  return (
    <div className={cn('min-h-dvh w-screen bg-[#050508] text-ink flex flex-col', className)}>
      <header className="shrink-0 border-b border-ink/[0.06] bg-[#06060A] px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Radar size={18} className="text-ink/55" />
          <div>
            <div className="text-sm font-semibold tracking-wide text-ink/80">Collection Platform</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-ink/40">
              Registry · observations · ops
            </div>
          </div>
          {auth?.authenticated && (
            <div className="ml-4 flex items-center gap-1 border border-ink/[0.08] p-0.5">
              <button
                type="button"
                onClick={() => setTab('findings')}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'findings' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                Findings
              </button>
              <button
                type="button"
                onClick={() => setTab('registry')}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'registry' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                Targets
              </button>
              <button
                type="button"
                onClick={() => setTab('graph')}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'graph' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                Graph
              </button>
              <button
                type="button"
                onClick={() => setTab('intelligence')}
                className={cn(
                  'px-3 py-1.5 text-[11px] uppercase tracking-wider',
                  tab === 'intelligence' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                <Brain size={12} className="inline mr-1.5" />
                Intelligence
              </button>
              <button
                type="button"
                onClick={() => setTab('feeds')}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'feeds' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                <Rss size={12} className="inline mr-1" />
                Feeds
              </button>
              <button
                type="button"
                onClick={() => setTab('ops')}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'ops' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                Ops
              </button>
              <button
                type="button"
                onClick={() => setTab('architecture')}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'architecture' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                <Layers size={12} className="inline mr-1" />
                Architecture
              </button>
              <button
                type="button"
                onClick={() => setTab('platform')}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'platform' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                <Settings size={12} className="inline mr-1" />
                Platform
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          {auth?.user && (
            <span className="text-ink/45 truncate max-w-[14rem]">
              {auth.user.email || auth.user.preferred_username || auth.user.name || auth.user.sub}
            </span>
          )}
          {data?.job?.running && (
            <span className="flex items-center gap-1.5 text-sky-400/70">
              <Clock size={12} className="animate-pulse" /> job running
            </span>
          )}
          <button
            onClick={() => void load()}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-ink/[0.08] text-ink/55 hover:text-ink/80"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          {auth?.authenticated ? (
            <a
              href="/api/harvest/auth/logout"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-ink/[0.08] text-ink/55 hover:text-ink/80"
            >
              <LogOut size={12} /> Logout
            </a>
          ) : (
            <a
              href="/api/harvest/auth/login"
              className="flex items-center gap-1.5 px-3 py-1.5 border border-ink/[0.08] text-ink/55 hover:text-ink/80"
            >
              <LogIn size={12} /> Login
            </a>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6 max-w-[1400px] w-full mx-auto">
        {auth?.required && !auth.authenticated ? (
          <div className="border border-ink/[0.08] bg-ink/[0.02] p-8 max-w-lg mx-auto text-center space-y-4">
            <Radar size={28} className="mx-auto text-ink/40" />
            <h1 className="text-lg text-ink/80">Sign in required</h1>
            <p className="text-[12px] text-ink/45">
              Collection Platform is gated by Keycloak (<span className="text-ink/60">auth.noirstack.com</span>).
            </p>
            <a
              href="/api/harvest/auth/login"
              className="inline-flex items-center gap-2 px-4 py-2 border border-ink/20 text-ink/75 hover:bg-ink/[0.04]"
            >
              <LogIn size={14} /> Continue with Keycloak
            </a>
          </div>
        ) : (
          <>
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 border border-amber-400/20 bg-amber-400/[0.05] text-amber-200/70 text-[12px]">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!data?.enabled && (
          <div className="border border-ink/[0.06] p-4 text-[12px] text-ink/45">
            Postgres not enabled — set <code className="text-ink/60">HARVEST_DATABASE_URL</code> via Infisical
            (<code className="text-ink/60">npm run osint:db:sync -- harvest</code>).
          </div>
        )}

        {tab === 'findings' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-end gap-3 border border-ink/[0.05] bg-ink/[0.015] p-4">
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40 flex-1 min-w-[12rem]">
                Search
                <input
                  value={findingsQ}
                  onChange={(e) => setFindingsQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void loadFindings(0)}
                  placeholder="value, title, label…"
                  className="bg-[#0a0a0f] border border-ink/[0.08] px-3 py-1.5 text-[12px] text-ink/70 normal-case tracking-normal"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40">
                Source
                <select
                  value={findingsSource}
                  onChange={(e) => setFindingsSource(e.target.value)}
                  className="bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-[12px] text-ink/70 normal-case tracking-normal min-w-[9rem]"
                >
                  <option value="">All</option>
                  {(data?.bySource || []).map((s) => (
                    <option key={s.source} value={s.source}>{s.source} ({s.count})</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40">
                Type
                <select
                  value={findingsType}
                  onChange={(e) => setFindingsType(e.target.value)}
                  className="bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-[12px] text-ink/70 normal-case tracking-normal min-w-[9rem]"
                >
                  <option value="">All</option>
                  {(data?.byEntityType || []).map((s) => (
                    <option key={s.entity_type} value={s.entity_type}>{s.entity_type} ({s.count})</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40">
                Connector
                <select
                  value={findingsConnector}
                  onChange={(e) => setFindingsConnector(e.target.value)}
                  className="bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-[12px] text-ink/70 normal-case tracking-normal min-w-[9rem]"
                >
                  <option value="">All</option>
                  {HARVESTERS.map((h) => (
                    <option key={h} value={h}>{h}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40">
                Product
                <select
                  value={findingsProduct}
                  onChange={(e) => setFindingsProduct(e.target.value)}
                  className="bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-[12px] text-ink/70 normal-case tracking-normal min-w-[8rem]"
                >
                  <option value="">All</option>
                  <option value="shared">shared</option>
                  <option value="h3xa">h3xa</option>
                  <option value="judicium">judicium</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40 flex-1 min-w-[12rem]">
                Cascades run
                <input
                  value={findingsWorkflowRunId}
                  onChange={(e) => setFindingsWorkflowRunId(e.target.value)}
                  placeholder="run-…"
                  className="bg-[#0a0a0f] border border-ink/[0.08] px-3 py-1.5 text-[12px] font-mono text-ink/70 normal-case tracking-normal"
                />
              </label>
              <button
                type="button"
                disabled={findingsBusy}
                onClick={() => void loadFindings(0)}
                className="px-3 py-1.5 border border-ink/[0.12] text-[11px] text-ink/70 disabled:opacity-40"
              >
                {findingsBusy ? 'Loading…' : 'Apply'}
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-ink/40">
              <span>
                {findingsTotal} finding{findingsTotal === 1 ? '' : 's'}
                {findingsTotal > 0 && (
                  <> · showing {findingsOffset + 1}–{Math.min(findingsOffset + findingsRows.length, findingsTotal)}</>
                )}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={findingsBusy || findingsOffset <= 0}
                  onClick={() => void loadFindings(Math.max(0, findingsOffset - findingsLimit))}
                  className="px-2 py-1 border border-ink/[0.08] disabled:opacity-30"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={findingsBusy || findingsOffset + findingsLimit >= findingsTotal}
                  onClick={() => void loadFindings(findingsOffset + findingsLimit)}
                  className="px-2 py-1 border border-ink/[0.08] disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            </div>

            <div className="border border-ink/[0.05] bg-ink/[0.015] overflow-hidden">
              <div className="grid grid-cols-[7rem_6rem_5rem_1fr_8rem] gap-2 px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/35">
                <span>Source</span>
                <span>Type</span>
                <span>Product</span>
                <span>Value</span>
                <span className="text-right">Seen</span>
              </div>
              <div className="max-h-[28rem] overflow-y-auto divide-y divide-ink/[0.04]">
                {findingsRows.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => void openFinding(f.id)}
                    className={cn(
                      'w-full grid grid-cols-[6rem_5rem_5rem_5rem_1fr_8rem] gap-2 px-3 py-2 text-left text-[11px] hover:bg-ink/[0.03]',
                      selectedFinding?.id === f.id && 'bg-ink/[0.04]',
                    )}
                  >
                    <span className="text-ink/45 truncate">{f.connector_id || f.source}</span>
                    <span className="text-ink/35 truncate">{f.entity_type}</span>
                    <span className="text-ink/30 truncate">{f.workflow_template || '—'}</span>
                    <span className="text-ink/75 truncate font-mono">{f.value || f.title}</span>
                    <span className="text-ink/25 text-right truncate">
                      {f.created_at ? new Date(f.created_at).toLocaleString() : ''}
                    </span>
                  </button>
                ))}
                {!findingsRows.length && !findingsBusy && (
                  <p className="px-3 py-8 text-center text-[12px] text-ink/30">No findings match</p>
                )}
              </div>
            </div>

            {selectedFinding && (
              <div className="border border-ink/[0.08] bg-ink/[0.02] p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink/40">Finding detail</div>
                    <div className="mt-1 font-mono text-[13px] text-ink/80 break-all">
                      {selectedFinding.value || selectedFinding.title}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedFinding(null)}
                    className="text-[11px] text-ink/40 hover:text-ink/70 shrink-0"
                  >
                    Close
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
                  <div><span className="text-ink/35">Source</span><p className="text-ink/65">{selectedFinding.source}</p></div>
                  <div><span className="text-ink/35">Type</span><p className="text-ink/65">{selectedFinding.entity_type}</p></div>
                  <div><span className="text-ink/35">Product</span><p className="text-ink/65">{selectedFinding.product || '—'}</p></div>
                  <div><span className="text-ink/35">Severity</span><p className="text-ink/65">{selectedFinding.severity || '—'}</p></div>
                  <div><span className="text-ink/35">Confidence</span><p className="text-ink/65">{selectedFinding.confidence ?? '—'}</p></div>
                  <div><span className="text-ink/35">Target</span><p className="text-ink/65">{selectedFinding.run_target || '—'}</p></div>
                  <div><span className="text-ink/35">Run</span><p className="font-mono text-ink/55 truncate">{selectedFinding.run_id || '—'}</p></div>
                  <div><span className="text-ink/35">Created</span><p className="text-ink/55">{selectedFinding.created_at ? new Date(selectedFinding.created_at).toLocaleString() : '—'}</p></div>
                </div>
                {(selectedFinding.workflow_run_id || selectedFinding.workflow_template) && (
                  <div className="border border-ink/[0.06] bg-ink/[0.02] p-3 space-y-2 text-[11px]">
                    <div className="text-[10px] uppercase tracking-wider text-ink/40">Collection provenance</div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div><span className="text-ink/35">Workflow</span><p className="text-ink/65">{selectedFinding.workflow_template || '—'}</p></div>
                      <div><span className="text-ink/35">Version</span><p className="text-ink/65">{selectedFinding.workflow_version || '—'}</p></div>
                      <div><span className="text-ink/35">Node</span><p className="font-mono text-ink/55">{selectedFinding.node_id || '—'}</p></div>
                      <div><span className="text-ink/35">Connector</span><p className="text-ink/65">{selectedFinding.connector_id || '—'}</p></div>
                    </div>
                    {selectedFinding.workflow_run_id && (
                      <a
                        href={cascadesWorkflowUrl(
                          selectedFinding.workflow_template || 'passive-domain-collection',
                          selectedFinding.workflow_run_id,
                          cascadesUrl,
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sky-400/80 hover:text-sky-300 text-[11px]"
                      >
                        Open Cascades run →
                      </a>
                    )}
                  </div>
                )}
                {selectedFinding.title && (
                  <div className="text-[12px] text-ink/60">{selectedFinding.title}</div>
                )}
                {selectedFinding.description && (
                  <div className="text-[12px] text-ink/45 whitespace-pre-wrap">{selectedFinding.description}</div>
                )}
                {selectedFinding.tags && selectedFinding.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {selectedFinding.tags.map((t) => (
                      <span key={t} className="px-1.5 py-0.5 border border-ink/[0.08] text-[10px] text-ink/40">{t}</span>
                    ))}
                  </div>
                )}
                {selectedFinding.raw != null && (
                  <pre className="max-h-48 overflow-auto bg-[#0a0a0f] border border-ink/[0.06] p-3 text-[10px] text-ink/45 font-mono">
                    {JSON.stringify(selectedFinding.raw, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </section>
        )}

        {tab === 'registry' && (
          <section className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink/45">
                <Crosshair size={12} /> Target Registry ({registryTotal})
              </div>
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={async () => {
                  setBusy('seed');
                  try {
                    await fetch('/api/collection/targets/seed', { method: 'POST', credentials: 'include' });
                    await loadRegistry();
                  } finally {
                    setBusy(null);
                  }
                }}
                className="px-3 py-1.5 border border-ink/[0.08] text-[11px] text-ink/55 hover:text-ink/80"
              >
                Sync targets.txt
              </button>
            </div>
            <form
              className="grid grid-cols-1 md:grid-cols-4 gap-2 items-end border border-ink/[0.06] p-3 bg-ink/[0.02]"
              onSubmit={async (e) => {
                e.preventDefault();
                const strategy = strategies.find((s) => s.id === targetForm.strategy);
                if (!targetForm.value.trim()) return;
                setBusy('add-target');
                try {
                  const res = await fetch('/api/collection/targets', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      value: targetForm.value.trim(),
                      product: targetForm.product,
                      collection_strategy: targetForm.strategy,
                      workflow_template: strategy?.workflow_template,
                      collection_profile: strategy?.profile,
                      collection_policy: strategy?.policy,
                      priority: strategy?.priority,
                      origin: 'api',
                    }),
                  });
                  const body = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(body.error || `add target failed (${res.status})`);
                  setTargetForm((f) => ({ ...f, value: '' }));
                  await loadRegistry();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(null);
                }
              }}
            >
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-ink/40">Target value</span>
                <input
                  value={targetForm.value}
                  onChange={(e) => setTargetForm((f) => ({ ...f, value: e.target.value }))}
                  placeholder="noirstack.com"
                  className="w-full bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-[11px] font-mono"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-ink/40">Product</span>
                <input
                  value={targetForm.product}
                  onChange={(e) => setTargetForm((f) => ({ ...f, product: e.target.value }))}
                  className="w-full bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-[11px]"
                />
              </label>
              <label className="space-y-1 md:col-span-2">
                <span className="text-[10px] uppercase tracking-wider text-ink/40">Collection strategy</span>
                <select
                  value={targetForm.strategy}
                  onChange={(e) => setTargetForm((f) => ({ ...f, strategy: e.target.value }))}
                  className="w-full bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-[11px]"
                >
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={Boolean(busy) || !targetForm.value.trim()}
                className="md:col-span-4 px-3 py-1.5 border border-ink/[0.08] text-[11px] text-ink/55 hover:text-ink/80 disabled:opacity-40"
              >
                Add target
              </button>
            </form>
            <div className="overflow-auto max-h-[28rem]">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-ink/40 text-left border-b border-ink/[0.06]">
                    <th className="py-2 pr-2">Value</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Product</th>
                    <th className="py-2 pr-2">Workflow</th>
                    <th className="py-2 pr-2">Strategy</th>
                    <th className="py-2 pr-2">Profile</th>
                    <th className="py-2 pr-2">Policy</th>
                    <th className="py-2 pr-2">Priority</th>
                    <th className="py-2 pr-2">Next</th>
                    <th className="py-2 pr-2">Cascades run</th>
                  </tr>
                </thead>
                <tbody>
                  {registryRows.map((t) => (
                    <tr key={t.id} className="border-b border-ink/[0.04] text-ink/65">
                      <td className="py-2 pr-2 font-mono">{t.value}</td>
                      <td className="py-2 pr-2">{t.target_type}</td>
                      <td className="py-2 pr-2">{t.product}</td>
                      <td className="py-2 pr-2">
                        {catalogWorkflows.find((w) => w.id === t.workflow_template)?.name || t.workflow_template}
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          value={t.collection_strategy || ''}
                          onChange={async (e) => {
                            const strategyId = e.target.value;
                            const strategy = strategies.find((s) => s.id === strategyId);
                            if (!strategy) return;
                            setBusy(`strategy-${t.id}`);
                            try {
                              const res = await fetch(`/api/collection/targets/${encodeURIComponent(t.id)}`, {
                                method: 'PUT',
                                credentials: 'include',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  collection_strategy: strategyId,
                                  workflow_template: strategy.workflow_template,
                                  collection_profile: strategy.profile,
                                  collection_policy: strategy.policy,
                                  priority: strategy.priority,
                                }),
                              });
                              if (!res.ok) {
                                const body = await res.json().catch(() => ({}));
                                throw new Error(body.error || `update failed (${res.status})`);
                              }
                              await loadRegistry();
                            } catch (err) {
                              setError((err as Error).message);
                            } finally {
                              setBusy(null);
                            }
                          }}
                          className="bg-transparent border border-ink/[0.06] text-[10px] max-w-[10rem]"
                        >
                          <option value="">—</option>
                          {strategies.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2 text-ink/50">{t.collection_profile || 'standard'}</td>
                      <td className="py-2 pr-2 text-ink/50">{t.collection_policy || t.frequency || '—'}</td>
                      <td className="py-2 pr-2 text-ink/50">{t.priority ?? '—'}</td>
                      <td className="py-2 pr-2 text-ink/45">{t.next_collect_at ? new Date(t.next_collect_at).toLocaleString() : '—'}</td>
                      <td className="py-2 pr-2">
                        {t.last_cascades_run_id ? (
                          <a
                            href={cascadesWorkflowUrl(t.workflow_template, t.last_cascades_run_id, cascadesUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-sky-400/70 hover:text-sky-300 truncate max-w-[8rem] inline-block"
                          >
                            {t.last_cascades_run_id.slice(0, 14)}…
                          </a>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                  {!registryRows.length && (
                    <tr><td colSpan={11} className="py-6 text-center text-ink/35">No targets — add above or sync targets.txt</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'graph' && (
          <section className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink/45">
                <ListTree size={12} /> Collection Graph ({graphEdges.length})
              </div>
              <button
                type="button"
                disabled={graphBusy}
                onClick={() => void loadGraph()}
                className="text-[10px] text-ink/45 hover:text-ink/70"
              >
                Refresh
              </button>
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-ink/40">Source value</span>
                <input
                  value={graphSource}
                  onChange={(e) => setGraphSource(e.target.value)}
                  placeholder="noirstack.com"
                  className="bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-[11px] font-mono min-w-[12rem]"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] uppercase tracking-wider text-ink/40">Workflow run id</span>
                <input
                  value={graphRunId}
                  onChange={(e) => setGraphRunId(e.target.value)}
                  placeholder="optional"
                  className="bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-[11px] font-mono min-w-[14rem]"
                />
              </label>
              <button
                type="button"
                onClick={() => void loadGraph()}
                disabled={graphBusy}
                className="px-3 py-1.5 border border-ink/[0.08] text-[11px] text-ink/55 hover:text-ink/80"
              >
                Filter
              </button>
            </div>
            <div className="overflow-auto max-h-[32rem]">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-ink/40 text-left border-b border-ink/[0.06]">
                    <th className="py-2 pr-2">Source</th>
                    <th className="py-2 pr-2">Relationship</th>
                    <th className="py-2 pr-2">Target</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Confidence</th>
                    <th className="py-2 pr-2">Run</th>
                  </tr>
                </thead>
                <tbody>
                  {graphEdges.map((edge) => (
                    <tr key={edge.id} className="border-b border-ink/[0.04] text-ink/65">
                      <td className="py-2 pr-2 font-mono">{edge.source_value}</td>
                      <td className="py-2 pr-2 text-ink/50">{edge.relationship_type}</td>
                      <td className="py-2 pr-2 font-mono">{edge.target_value}</td>
                      <td className="py-2 pr-2">{edge.target_type}</td>
                      <td className="py-2 pr-2">{edge.confidence != null ? edge.confidence.toFixed(2) : '—'}</td>
                      <td className="py-2 pr-2 font-mono text-ink/45 truncate max-w-[8rem]">
                        {edge.workflow_run_id ? `${edge.workflow_run_id.slice(0, 12)}…` : '—'}
                      </td>
                    </tr>
                  ))}
                  {!graphEdges.length && (
                    <tr><td colSpan={6} className="py-6 text-center text-ink/35">No graph edges yet — run collection with auto-discover strategies</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'intelligence' && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-ink/45">Intelligence Core — Claims, Knowledge, Evidence</div>
              <button type="button" onClick={() => void loadIntelligence()} disabled={intelBusy} className="text-[10px] text-ink/45 hover:text-ink/70">
                {intelBusy ? 'Loading…' : 'Refresh'}
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-wider text-ink/45">Target dashboard</div>
                <div className="overflow-auto max-h-48">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {intelDashboard.map((t) => (
                        <tr key={String(t.target_value)} className="border-b border-ink/[0.04] text-ink/65">
                          <td className="py-1.5 pr-2 font-mono">{String(t.target_value)}</td>
                          <td className="py-1.5 pr-2">{String(t.observations ?? 0)} obs</td>
                          <td className="py-1.5 text-ink/45">{String(t.graph_edges ?? 0)} edges</td>
                        </tr>
                      ))}
                      {!intelDashboard.length && (
                        <tr><td className="py-4 text-ink/35">Run bootstrap to refresh read models</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3 lg:col-span-2">
                <div className="text-[10px] uppercase tracking-wider text-ink/45">Knowledge objects</div>
                <div className="overflow-auto max-h-48">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-ink/40 text-left border-b border-ink/[0.06]">
                        <th className="py-2 pr-2">Kind</th>
                        <th className="py-2 pr-2">Title</th>
                        <th className="py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {intelKnowledge.map((k) => (
                        <tr key={k.id} className="border-b border-ink/[0.04] text-ink/65">
                          <td className="py-2 pr-2 font-mono text-ink/50">{k.kind}</td>
                          <td className="py-2 pr-2">{k.title}</td>
                          <td className="py-2">{k.status}</td>
                        </tr>
                      ))}
                      {!intelKnowledge.length && (
                        <tr><td colSpan={3} className="py-4 text-center text-ink/35">No knowledge objects yet</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-ink/45">Claims & reasoning</div>
              {selectedFinding && (
                <div className="flex flex-wrap items-end gap-2 border border-ink/[0.06] p-3">
                  <span className="text-[11px] text-ink/50">From finding: <code className="text-ink/70">{selectedFinding.value}</code></span>
                  <input
                    value={claimDraft}
                    onChange={(e) => setClaimDraft(e.target.value)}
                    placeholder="Claim statement…"
                    className="flex-1 min-w-[16rem] bg-[#0a0a0f] border border-ink/[0.08] px-3 py-1.5 text-[12px] text-ink/70"
                  />
                  <button
                    type="button"
                    disabled={busy === 'claim' || !claimDraft.trim()}
                    onClick={() => void createClaimFromFinding()}
                    className="px-3 py-1.5 border border-ink/20 text-[11px] text-ink/70 hover:bg-ink/[0.04]"
                  >
                    Create claim
                  </button>
                </div>
              )}
              <div className="overflow-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-ink/40 text-left border-b border-ink/[0.06]">
                      <th className="py-2 pr-2">Statement</th>
                      <th className="py-2 pr-2">Status</th>
                      <th className="py-2 pr-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intelClaims.map((c) => (
                      <tr key={c.id} className="border-b border-ink/[0.04] text-ink/65">
                        <td className="py-2 pr-2 max-w-md truncate" title={c.statement}>{c.statement}</td>
                        <td className="py-2 pr-2">{c.status}</td>
                        <td className="py-2 pr-2 space-x-2">
                          <button type="button" onClick={() => void evaluateClaimById(c.id)} className="text-ink/50 hover:text-ink/80">Evaluate</button>
                          <button type="button" onClick={() => void bundleEvidence(c.id, `Evidence: ${c.statement.slice(0, 40)}`)} className="text-ink/50 hover:text-ink/80">Bundle</button>
                        </td>
                      </tr>
                    ))}
                    {!intelClaims.length && (
                      <tr><td colSpan={3} className="py-4 text-center text-ink/35">Select a finding and create a claim, or use the API</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-ink/45">Evidence bundles</div>
              <div className="overflow-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-ink/40 text-left border-b border-ink/[0.06]">
                      <th className="py-2 pr-2">Title</th>
                      <th className="py-2 pr-2">Claim</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {intelEvidence.map((e) => (
                      <tr key={e.id} className="border-b border-ink/[0.04] text-ink/65">
                        <td className="py-2 pr-2">{e.title}</td>
                        <td className="py-2 pr-2 font-mono text-ink/45 text-[10px]">{e.claim_id || '—'}</td>
                        <td className="py-2">{e.status}</td>
                      </tr>
                    ))}
                    {!intelEvidence.length && (
                      <tr><td colSpan={3} className="py-4 text-center text-ink/35">Evaluate a claim, then bundle evidence</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {tab === 'feeds' && (
          <section>
            <FeedIntelligenceExplorer />
          </section>
        )}

        {tab === 'architecture' && (
          <section>
            <ArchitectureExplorer />
          </section>
        )}

        {tab === 'platform' && platformConfig && (
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] uppercase tracking-wider text-ink/45">
                Platform — schedulers, feeds, Judicium integration
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void loadPlatform()} disabled={!!platformBusy} className="text-[10px] text-ink/45 hover:text-ink/70">Refresh</button>
                <button type="button" onClick={() => void savePlatform()} disabled={!!platformBusy} className="px-3 py-1 border border-ink/[0.12] text-[11px] text-ink/70 hover:text-ink/90">
                  {platformBusy === 'save' ? 'Saving…' : 'Save config'}
                </button>
              </div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-wider text-ink/45">Collection scheduler</div>
                <label className="flex items-center gap-2 text-[11px] text-ink/60">
                  <input type="checkbox" checked={Boolean((platformConfig.scheduler as Record<string, unknown>)?.enabled)} onChange={(e) => patchPlatform(['scheduler', 'enabled'], e.target.checked)} />
                  Scheduler enabled
                </label>
                <label className="flex items-center gap-2 text-[11px] text-ink/60">
                  <input type="checkbox" checked={Boolean(((platformConfig.scheduler as Record<string, unknown>)?.cascadesDuePull as Record<string, unknown>)?.enabled)} onChange={(e) => patchPlatform(['scheduler', 'cascadesDuePull', 'enabled'], e.target.checked)} />
                  Cascades due pull (passive-domain-collection)
                </label>
                <div className="flex items-center gap-2 text-[11px] text-ink/55">
                  <span>Due interval (min)</span>
                  <input type="number" min={5} className="w-20 bg-ink/[0.04] border border-ink/[0.08] px-2 py-1 font-mono" value={Number(((platformConfig.scheduler as Record<string, unknown>)?.cascadesDuePull as Record<string, unknown>)?.intervalMinutes || 60)} onChange={(e) => patchPlatform(['scheduler', 'cascadesDuePull', 'intervalMinutes'], Number(e.target.value))} />
                </div>
                <label className="flex items-center gap-2 text-[11px] text-ink/60">
                  <input type="checkbox" checked={Boolean(((platformConfig.scheduler as Record<string, unknown>)?.dailyPull as Record<string, unknown>)?.enabled)} onChange={(e) => patchPlatform(['scheduler', 'dailyPull', 'enabled'], e.target.checked)} />
                  Daily pull cycle
                </label>
                <select className="bg-ink/[0.04] border border-ink/[0.08] px-2 py-1 text-[11px]" value={String(((platformConfig.scheduler as Record<string, unknown>)?.dailyPull as Record<string, unknown>)?.mode || 'cascades-due')} onChange={(e) => patchPlatform(['scheduler', 'dailyPull', 'mode'], e.target.value)}>
                  <option value="cascades-due">Cascades due (in-process)</option>
                  <option value="shell">Shell daily-pull.sh</option>
                  <option value="both">Both</option>
                  <option value="disabled">Disabled</option>
                </select>
                <div className="flex flex-wrap gap-2 pt-2">
                  {['cascades-due', 'daily-pull'].map((kind) => (
                    <button key={kind} type="button" disabled={!!platformBusy} onClick={() => void runPlatformJob(kind)} className="flex items-center gap-1 px-2 py-1 border border-ink/[0.1] text-[10px] text-ink/60 hover:text-ink/85">
                      <Play size={10} /> Run {kind}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-wider text-ink/45">Module: Community Feeds</div>
                <div className="text-[10px] text-ink/35 font-mono">community-feeds@1.2.0 · Harvest-owned · Judicium consumes via proxy</div>
                <label className="flex items-center gap-2 text-[11px] text-ink/60">
                  <input type="checkbox" checked={Boolean(((platformConfig.modules as Record<string, unknown>)?.communityFeeds as Record<string, unknown>)?.enabled ?? (platformConfig.communityFeeds as Record<string, unknown>)?.enabled)} onChange={(e) => patchPlatform(['modules', 'communityFeeds', 'enabled'], e.target.checked)} />
                  Feeds worker enabled
                </label>
                <label className="flex items-center gap-2 text-[11px] text-ink/60">
                  <input type="checkbox" checked={Boolean(((platformConfig.modules as Record<string, unknown>)?.communityFeeds as Record<string, unknown>)?.delegateFromJudicium ?? (platformConfig.communityFeeds as Record<string, unknown>)?.delegateFromJudicium)} onChange={(e) => patchPlatform(['modules', 'communityFeeds', 'delegateFromJudicium'], e.target.checked)} />
                  Judicium delegates community pull to Harvest
                </label>
                <label className="flex items-center gap-2 text-[11px] text-ink/60">
                  <input
                    type="checkbox"
                    checked={Boolean(
                      (platformConfig.modules as { communityFeeds?: { enrichment?: { autoOnIngest?: boolean } } })?.communityFeeds?.enrichment?.autoOnIngest ?? true,
                    )}
                    onChange={(e) => patchPlatform(['modules', 'communityFeeds', 'enrichment', 'autoOnIngest'], e.target.checked)}
                  />
                  Enrich keywords on ingest
                </label>
                <label className="flex items-center gap-2 text-[11px] text-ink/60">
                  <input
                    type="checkbox"
                    checked={Boolean(
                      (platformConfig.modules as { communityFeeds?: { expansion?: { enabled?: boolean } } })?.communityFeeds?.expansion?.enabled ?? true,
                    )}
                    onChange={(e) => patchPlatform(['modules', 'communityFeeds', 'expansion', 'enabled'], e.target.checked)}
                  />
                  Keyword expansion API enabled
                </label>
                <label className="flex items-center gap-2 text-[11px] text-ink/60">
                  <input
                    type="checkbox"
                    checked={Boolean(
                      (platformConfig.modules as { communityFeeds?: { expansion?: { defaultEnqueue?: boolean } } })?.communityFeeds?.expansion?.defaultEnqueue,
                    )}
                    onChange={(e) => patchPlatform(['modules', 'communityFeeds', 'expansion', 'defaultEnqueue'], e.target.checked)}
                  />
                  Expansion default-enqueues Cascades
                </label>
                <div className="flex flex-wrap gap-2 pt-2">
                  {['feeds-layers', 'feeds-rss', 'feeds-daily'].map((kind) => (
                    <button key={kind} type="button" disabled={!!platformBusy} onClick={() => void runPlatformJob(kind)} className="flex items-center gap-1 px-2 py-1 border border-ink/[0.1] text-[10px] text-ink/60 hover:text-ink/85">
                      <Play size={10} /> {kind.replace('feeds-', '')}
                    </button>
                  ))}
                  <a href="/api/platform/modules/community-feeds/contract" target="_blank" rel="noreferrer" className="px-2 py-1 border border-ink/[0.1] text-[10px] text-ink/50 hover:text-ink/75">Contract JSON</a>
                </div>
              </div>
            </div>
            <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-ink/45">Judicium env (copy to judicium compose)</div>
              {Boolean((platformStatus?.judicium as Record<string, unknown> | undefined)?.suggestedEnv) && (
                <pre className="text-[10px] font-mono text-ink/45 bg-ink/[0.03] border border-ink/[0.06] p-3 overflow-auto">
                  {JSON.stringify((platformStatus?.judicium as Record<string, unknown>).suggestedEnv, null, 2)}
                </pre>
              )}
            </div>
            {Boolean(platformStatus?.scheduler) && (
              <pre className="text-[10px] font-mono text-ink/45 border border-ink/[0.05] p-3 overflow-auto max-h-48">{JSON.stringify(platformStatus?.scheduler, null, 2)}</pre>
            )}
          </section>
        )}

        {tab === 'ops' && (
          <>
        {opsMetrics && (
          <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {[
              { label: 'Targets enabled', value: (opsMetrics.targets as { enabled?: number })?.enabled ?? '—' },
              { label: 'Due now', value: (opsMetrics.targets as { due?: number })?.due ?? '—' },
              { label: 'Obs today', value: (opsMetrics.observationsPersistedToday as number) ?? '—' },
              { label: 'Findings today', value: (opsMetrics.findings as { today?: number })?.today ?? '—' },
              { label: 'Connector errors', value: (opsMetrics.providerErrors24h as number) ?? '—' },
              { label: 'Healthy connectors', value: `${(opsMetrics.connectorHealth as { healthy?: number })?.healthy ?? 0}/${(opsMetrics.connectorHealth as { total?: number })?.total ?? 0}` },
            ].map((c) => (
              <div key={c.label} className="border border-ink/[0.05] bg-ink/[0.015] p-3">
                <div className="text-[10px] uppercase tracking-wider text-ink/40">{c.label}</div>
                <div className="mt-1 text-xl font-mono font-light text-ink/70">{c.value}</div>
              </div>
            ))}
          </section>
        )}

        <section className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-wider text-ink/45">Connector Health (24h)</div>
            <button type="button" onClick={() => void loadOps()} className="text-[10px] text-ink/45 hover:text-ink/70">Refresh</button>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-ink/40 text-left border-b border-ink/[0.06]">
                  <th className="py-2 pr-2">Connector</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Success</th>
                  <th className="py-2 pr-2">Avg ms</th>
                  <th className="py-2 pr-2">Last success</th>
                </tr>
              </thead>
              <tbody>
                {connectorHealth.map((c) => (
                  <tr key={c.connector} className="border-b border-ink/[0.04] text-ink/65">
                    <td className="py-2 pr-2 font-mono">{c.connector}</td>
                    <td className="py-2 pr-2">{c.status}</td>
                    <td className="py-2 pr-2">{c.successRate != null ? `${c.successRate}%` : '—'}</td>
                    <td className="py-2 pr-2">{c.avgDurationMs ?? '—'}</td>
                    <td className="py-2 pr-2 text-ink/45">{c.lastSuccess ? new Date(c.lastSuccess).toLocaleString() : '—'}</td>
                  </tr>
                ))}
                {!connectorHealth.length && (
                  <tr><td colSpan={5} className="py-4 text-center text-ink/35">No connector events yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-ink/45">Provider Dashboard (24h)</div>
          <div className="overflow-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-ink/40 text-left border-b border-ink/[0.06]">
                  <th className="py-2 pr-2">Provider</th>
                  <th className="py-2 pr-2">Status</th>
                  <th className="py-2 pr-2">Runs</th>
                  <th className="py-2 pr-2">Failures</th>
                  <th className="py-2 pr-2">Observations</th>
                  <th className="py-2 pr-2">Avg ms</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.connector} className="border-b border-ink/[0.04] text-ink/65">
                    <td className="py-2 pr-2 font-mono">{p.connector}</td>
                    <td className="py-2 pr-2">{p.status}</td>
                    <td className="py-2 pr-2">{p.runs24h}</td>
                    <td className="py-2 pr-2">{p.failures24h}</td>
                    <td className="py-2 pr-2">{p.observations24h}</td>
                    <td className="py-2 pr-2">{p.avgDurationMs ?? '—'}</td>
                  </tr>
                ))}
                {!providers.length && (
                  <tr><td colSpan={6} className="py-4 text-center text-ink/35">No provider stats yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {summaryCards.map((c) => (
            <div key={c.label} className="border border-ink/[0.05] bg-ink/[0.015] p-3">
              <div className="text-[10px] uppercase tracking-wider text-ink/40">{c.label}</div>
              <div className={cn('mt-1 text-ink/70', c.small ? 'text-[11px]' : 'text-xl font-mono font-light')}>
                {c.value}
              </div>
            </div>
          ))}
        </section>

        {data?.daily && (
          <section className="border border-ink/[0.05] bg-ink/[0.015] p-4 text-[12px]">
            <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-wider text-ink/45">
              <Database size={12} /> Daily cron summary
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div><span className="text-ink/35">Products</span><p className="font-mono text-ink/65">{data.daily.products || '—'}</p></div>
              <div><span className="text-ink/35">Findings</span><p className="font-mono text-ink/65">{data.daily.totalFindings ?? 0}</p></div>
              <div><span className="text-ink/35">Inserted</span><p className="font-mono text-ink/65">{data.daily.totalInserted ?? 0}</p></div>
              <div><span className="text-ink/35">Failed</span><p className="font-mono text-ink/65">{data.daily.failed ?? 0}</p></div>
              <div><span className="text-ink/35">Window</span><p className="font-mono text-ink/55 text-[11px]">{data.daily.startedAt || '—'} → {data.daily.finishedAt || '—'}</p></div>
            </div>
          </section>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink/45">
              <Play size={12} /> Run collection
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <label className="space-y-1">
                <span className="text-ink/40 text-[10px]">Product</span>
                <select
                  value={form.product}
                  onChange={(e) => setForm((f) => ({ ...f, product: e.target.value }))}
                  className="w-full bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-ink/70"
                >
                  <option value="h3xa">h3xa</option>
                  <option value="judicium">judicium</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-ink/40 text-[10px]">Case ID (optional)</span>
                <input
                  value={form.caseId}
                  onChange={(e) => setForm((f) => ({ ...f, caseId: e.target.value }))}
                  className="w-full bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-ink/70"
                  placeholder="1"
                />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-ink/40 text-[10px]">Target</span>
                <input
                  value={form.target}
                  onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
                  className="w-full bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-ink/70"
                />
              </label>
              <label className="space-y-1 col-span-2">
                <span className="text-ink/40 text-[10px]">Collection strategy</span>
                <select
                  value={form.strategy}
                  onChange={(e) => setForm((f) => ({ ...f, strategy: e.target.value }))}
                  className="w-full bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1.5 text-ink/70 text-[11px]"
                >
                  {strategies.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {strategies.find((s) => s.id === form.strategy)?.description && (
                  <p className="text-[10px] text-ink/35 pt-1">
                    {strategies.find((s) => s.id === form.strategy)?.description}
                  </p>
                )}
              </label>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                disabled={!!busy}
                onClick={() => void triggerRun('single')}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-ink text-canvas text-[11px] font-semibold disabled:opacity-40"
              >
                <Crosshair size={12} /> {busy === 'single' ? 'Starting…' : 'Run target'}
              </button>
              <button
                disabled={!!busy}
                onClick={() => void triggerRun('daily')}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-ink/[0.12] text-[11px] text-ink/70 disabled:opacity-40"
              >
                <Play size={12} /> {busy === 'daily' ? 'Starting…' : 'Run daily pull'}
              </button>
              <button
                disabled={!!busy}
                onClick={() => void triggerRun('daily-dry')}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-ink/[0.08] text-[11px] text-ink/45 disabled:opacity-40"
              >
                <Terminal size={12} /> Dry-run daily
              </button>
            </div>
          </div>

          <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink/45">
                <FileText size={12} /> targets.txt
              </div>
              <button
                disabled={!!busy || !targetsDirty}
                onClick={() => void saveTargets()}
                className="px-3 py-1 border border-ink/[0.1] text-[11px] text-ink/60 disabled:opacity-30"
              >
                {busy === 'targets' ? 'Saving…' : 'Save'}
              </button>
            </div>
            <textarea
              value={targetsText}
              onChange={(e) => {
                setTargetsText(e.target.value);
                setTargetsDirty(true);
              }}
              spellCheck={false}
              className="w-full h-48 bg-[#0a0a0f] border border-ink/[0.08] p-3 font-mono text-[11px] text-ink/65 resize-y"
            />
            <p className="text-[10px] text-ink/35">
              Formats: <code>domain</code> · <code>domain case_id</code> · <code>product domain case_id</code>
            </p>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="border border-ink/[0.05] bg-ink/[0.015] p-4">
            <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-wider text-ink/45">
              <ListTree size={12} /> By source
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {(data?.bySource || []).map((row) => (
                <div key={row.source} className="flex justify-between text-[11px] px-2 py-1 border border-ink/[0.03]">
                  <span className="text-ink/60 truncate">{row.source}</span>
                  <span className="font-mono text-ink/45">{row.count}</span>
                </div>
              ))}
              {!data?.bySource?.length && <p className="text-[11px] text-ink/30">No findings yet</p>}
            </div>
          </div>
          <div className="border border-ink/[0.05] bg-ink/[0.015] p-4">
            <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-wider text-ink/45">
              <ListTree size={12} /> By entity type
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {(data?.byEntityType || []).map((row) => (
                <div key={row.entity_type} className="flex justify-between text-[11px] px-2 py-1 border border-ink/[0.03]">
                  <span className="text-ink/60 truncate">{row.entity_type}</span>
                  <span className="font-mono text-ink/45">{row.count}</span>
                </div>
              ))}
              {!data?.byEntityType?.length && <p className="text-[11px] text-ink/30">No findings yet</p>}
            </div>
          </div>
        </section>

        <section className="border border-ink/[0.05] bg-ink/[0.015] p-4">
          <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-wider text-ink/45">
            <Radar size={12} /> Recent runs
          </div>
          <div className="space-y-1">
            {(data?.runs || []).map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() => setSelectedRun(run.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 border text-left text-[11px]',
                  selectedRun === run.id ? 'border-ink/20 bg-ink/[0.03]' : 'border-ink/[0.03] hover:border-ink/[0.08]',
                )}
              >
                <span className={cn('px-1.5 py-0.5 shrink-0', statusTone(run.status))}>{run.status}</span>
                <span className="font-mono text-ink/70 truncate max-w-[160px]">{run.target}</span>
                {run.case_id != null && <span className="text-ink/35">case #{run.case_id}</span>}
                <span className="text-ink/45">{run.total_findings} found · {run.inserted} in · {run.skipped} skip</span>
                <span className="text-ink/25 ml-auto">{run.started_at ? new Date(run.started_at).toLocaleString() : ''}</span>
              </button>
            ))}
            {!data?.runs?.length && (
              <div className="flex flex-col items-center py-10 text-ink/25">
                <Check size={20} className="mb-2 opacity-40" />
                <p className="text-xs">No harvest runs yet</p>
              </div>
            )}
          </div>
        </section>

        {runDetail && (
          <section className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-ink/45">
                Run {runDetail.run.id}
              </div>
              <button onClick={() => setSelectedRun(null)} className="text-[11px] text-ink/40 hover:text-ink/70">Close</button>
            </div>
            <div className="text-[11px] text-ink/50 font-mono">
              {runDetail.run.target} · {runDetail.run.status} · findings {runDetail.findings.length}
            </div>
            <div className="max-h-72 overflow-y-auto space-y-0.5">
              {runDetail.findings.map((f) => (
                <div key={f.id} className="flex gap-3 px-2 py-1.5 border border-ink/[0.03] text-[11px]">
                  <span className="text-ink/35 w-24 shrink-0 truncate">{f.source}</span>
                  <span className="text-ink/30 w-16 shrink-0">{f.entity_type}</span>
                  <span className="text-ink/70 truncate flex-1">{f.value || f.title}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="border border-ink/[0.05] bg-ink/[0.015] p-4">
          <div className="flex items-center gap-2 mb-3 text-[10px] uppercase tracking-wider text-ink/45">
            Latest findings
          </div>
          <div className="space-y-0.5 max-h-80 overflow-y-auto">
            {(data?.recentFindings || []).map((f) => (
              <div key={f.id} className="flex gap-3 px-2 py-1.5 border border-ink/[0.03] text-[11px]">
                <span className="text-ink/35 w-24 shrink-0 truncate">{f.source}</span>
                <span className="text-ink/30 w-16 shrink-0">{f.entity_type}</span>
                <span className="text-ink/70 truncate flex-1">{f.value || f.title}</span>
                <span className="text-ink/20 ml-auto shrink-0">
                  {f.created_at ? new Date(f.created_at).toLocaleString() : ''}
                </span>
              </div>
            ))}
          </div>
        </section>
          </>
        )}
          </>
        )}
      </main>
    </div>
  );
};

export default HarvestAdmin;
