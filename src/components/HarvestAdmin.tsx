/**
 * Collection Platform ops console — Keycloak-gated registry, observations, and ops.
 * Legacy routes: /api/harvest/*, harvest.noirstack.com
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Radar, RefreshCw, Play, FileText, AlertTriangle, Check, Clock,
  Database, Crosshair, ListTree, Terminal, LogIn, LogOut, Brain, Settings, Layers, Rss,
  Sun, Moon, Globe, BookOpen,
} from 'lucide-react';
import { HarvestDockview, useDockviewPanels, type DockPanel } from './HarvestDockview';
import type { DockviewApi } from 'dockview-react';
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

const HARVESTERS = [
  'crtsh',
  'dns',
  'rdap',
  'hackertarget',
  'urlhaus',
  'rss',
  'wayback',
  'holehe',
  'sherlock',
  'maigret',
] as const;

function statusTone(status: string) {
  if (status === 'completed') return 'text-emerald-400/70 bg-emerald-400/[0.06]';
  if (status === 'running') return 'text-sky-400/70 bg-sky-400/[0.06]';
  return 'text-amber-400/70 bg-amber-400/[0.06]';
}

export const HarvestAdmin: React.FC<{ className?: string }> = ({ className }) => {
  const [auth, setAuth] = useState<HarvestAuthState | null>(null);
  const [tab, setTab] = useState<'ops' | 'findings' | 'registry' | 'graph' | 'intelligence' | 'feeds' | 'platform' | 'architecture' | 'sources' | 'enrichment' | 'rss-sources'>('findings');
  const [dockviewApi, setDockviewApi] = useState<DockviewApi | null>(null);
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
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('harvest-theme');
      if (stored === 'light' || stored === 'dark') return stored;
    }
    return 'dark';
  });

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem('harvest-theme', next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }, [theme]);

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

  // ─── Dockview: panel registry & inline components ───────────
  const PANELS: DockPanel[] = [
    { id: 'findings', name: 'Findings', component: 'findings' },
    { id: 'registry', name: 'Targets', component: 'registry' },
    { id: 'graph', name: 'Graph', component: 'graph' },
    { id: 'intelligence', name: 'Intelligence', component: 'intelligence' },
    { id: 'feeds', name: 'Feeds', component: 'feeds' },
    { id: 'ops', name: 'Ops', component: 'ops' },
    { id: 'architecture', name: 'Architecture', component: 'architecture' },
    { id: 'platform', name: 'Platform', component: 'platform' },
    { id: 'sources', name: 'Sources', component: 'sources' },
    { id: 'enrichment', name: 'Enrichment', component: 'enrichment' },
    { id: 'rss-sources', name: 'RSS Sources', component: 'rss-sources' },
  ];

  const { openPanel } = useDockviewPanels(dockviewApi, PANELS);

  if (!auth) {
    return (
      <div className={"flex items-center justify-center min-h-dvh bg-noir-bg text-ink/40 text-[13px]"}>…</div>
    );
  }

  return (
    <div className={cn('min-h-dvh w-screen bg-noir-bg text-ink flex flex-col', className)}>
      <header className="shrink-0 border-b border-ink/[0.06] bg-noir-surface px-6 py-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="/logo.svg" alt="Collection Platform" className="h-6 w-6" />
          <div>
            <div className="text-sm font-semibold tracking-wide text-ink/80">Collection Platform</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-ink/40">
              Registry · observations · ops
            </div>
          </div>
          {(!auth?.required || auth?.authenticated) && (
            <div className="ml-4 flex items-center gap-1 border border-ink/[0.08] p-0.5">
              <button
                type="button"
                onClick={() => { setTab('findings'); openPanel('findings'); }}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'findings' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                Findings
              </button>
              <button
                type="button"
                onClick={() => { setTab('registry'); openPanel('registry'); }}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'registry' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                Targets
              </button>
              <button
                type="button"
                onClick={() => { setTab('graph'); openPanel('graph'); }}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'graph' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                Graph
              </button>
              <button
                type="button"
                onClick={() => { setTab('intelligence'); openPanel('intelligence'); }}
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
                onClick={() => { setTab('feeds'); openPanel('feeds'); }}
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
                onClick={() => { setTab('ops'); openPanel('ops'); }}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'ops' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                Ops
              </button>
              <button
                type="button"
                onClick={() => { setTab('architecture'); openPanel('architecture'); }}
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
                onClick={() => { setTab('platform'); openPanel('platform'); }}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'platform' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                <Settings size={12} className="inline mr-1" />
                Platform
              </button>
              <button
                type="button"
                onClick={() => { setTab('sources'); openPanel('sources'); }}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'sources' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                <Globe size={12} className="inline mr-1" />
                Sources
              </button>
              <button
                type="button"
                onClick={() => { setTab('enrichment'); openPanel('enrichment'); }}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'enrichment' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                <BookOpen size={12} className="inline mr-1" />
                Enrichment
              </button>
              <button
                type="button"
                onClick={() => { setTab('rss-sources'); openPanel('rss-sources'); }}
                className={cn(
                  'px-3 py-1 text-[11px]',
                  tab === 'rss-sources' ? 'bg-ink/[0.08] text-ink/80' : 'text-ink/40 hover:text-ink/65',
                )}
              >
                <Rss size={12} className="inline mr-1" />
                RSS Sources
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
            type="button"
            onClick={toggleTheme}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-ink/[0.08] text-ink/55 hover:text-ink/80"
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
          </button>
          <button
            onClick={() => void load()}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-ink/[0.08] text-ink/55 hover:text-ink/80"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          {auth?.required && (auth?.authenticated ? (
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
          ))}
        </div>
      </header>

      <HarvestDockview
        className="flex-1"
        panels={PANELS}
        onReady={setDockviewApi}
        defaultOpen={['findings']}
      />
    </div>
  );
};

export default HarvestAdmin;
