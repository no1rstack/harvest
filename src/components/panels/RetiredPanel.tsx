import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Archive, AlertTriangle, XCircle, Power, Clock, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { cn } from '../../types';

interface DeadSource {
  name: string;
  domain: string;
  category: string;
  source_type: string;
  access_method: string;
  registration: string;
}

interface RetiredTarget {
  id: string;
  target_type: string;
  value: string;
  product: string;
  workflow_template: string;
  priority: number;
  origin: string;
  last_collected_at: string | null;
  last_used_cascades_run_id: string | null;
  disabled_at: string | null;
  reason: string;
}

interface RetiredFeed {
  id: string;
  name: string;
  feed_url: string;
  category: string;
  discovered_via: string;
  last_ok_at: string | null;
  last_error: string | null;
  updated_at: string | null;
  reason: string;
}

interface RetiredPolicy {
  id: string;
  name: string;
  workflow_template: string;
  schedule_mode: string;
  schedule_value: string;
  description: string;
  reason: string;
}

interface DeprecatedWorkflow {
  workflow: string;
  total: number;
  active: number;
  inactive: number;
}

interface RetiredData {
  summary: {
    deadCliTools: number;
    disabledTargets: number;
    disabledFeeds: number;
    disabledPolicies: number;
    deprecatedWorkflows: number;
    total: number;
  };
  deadCliTools: DeadSource[];
  disabledTargets: RetiredTarget[];
  disabledFeeds: RetiredFeed[];
  disabledPolicies: RetiredPolicy[];
  deprecatedWorkflows: DeprecatedWorkflow[];
}

function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function ago(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}

const SECTION_ICONS: Record<string, React.ReactNode> = {
  deadCliTools: <XCircle size={14} className="text-rose-400/60" />,
  disabledTargets: <Power size={14} className="text-amber-400/60" />,
  disabledFeeds: <Power size={14} className="text-amber-400/60" />,
  disabledPolicies: <Power size={14} className="text-amber-400/60" />,
  deprecatedWorkflows: <Clock size={14} className="text-slate-400/60" />,
};

const SECTION_LABELS: Record<string, string> = {
  deadCliTools: 'Dead CLI Tools',
  disabledTargets: 'Disabled Collection Targets',
  disabledFeeds: 'Disabled/Inactive Feed Sources',
  disabledPolicies: 'Disabled Collection Policies',
  deprecatedWorkflows: 'Deprecated Workflows (no active targets)',
};

export const RetiredPanel: React.FC = () => {
  const [data, setData] = useState<RetiredData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/retired');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      // Auto-expand sections with items
      const autoExpand: Record<string, boolean> = {};
      for (const [key, val] of Object.entries(json.summary)) {
        if (key !== 'total' && (val as number) > 0) autoExpand[key] = true;
      }
      setExpanded(autoExpand);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggle = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  const exportRetired = useCallback(() => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `retired-artifacts-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [data]);

  if (loading && !data) return <div className="h-full overflow-auto p-8 text-center text-[12px] text-ink/40">Loading retired artifacts...</div>;
  if (error) return (
    <div className="h-full overflow-auto p-8">
      <div className="border border-ink/[0.08] bg-ink/[0.02] p-8 text-center space-y-3">
        <AlertTriangle size={28} className="mx-auto text-rose-400/60" />
        <p className="text-[13px] text-rose-400/80">{error}</p>
        <button type="button" onClick={load} className="px-3 py-1.5 border border-ink/[0.12] text-[11px] text-ink/70">Retry</button>
      </div>
    </div>
  );
  if (!data) return null;

  const sections: Array<{ key: string; count: number; items: any[] }> = [
    { key: 'deadCliTools', count: data.summary.deadCliTools, items: data.deadCliTools },
    { key: 'disabledTargets', count: data.summary.disabledTargets, items: data.disabledTargets },
    { key: 'disabledFeeds', count: data.summary.disabledFeeds, items: data.disabledFeeds },
    { key: 'disabledPolicies', count: data.summary.disabledPolicies, items: data.disabledPolicies },
    { key: 'deprecatedWorkflows', count: data.summary.deprecatedWorkflows, items: data.deprecatedWorkflows },
  ];

  return (
    <div className="h-full overflow-auto">
      <section className="space-y-6 px-2 pb-8">
        {/* header */}
        <div className="flex items-center justify-between pt-2">
          <div>
            <div className="text-sm font-semibold tracking-wide text-ink/75">Retired Artifacts</div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-ink/35">
              {fmt(data.summary.total)} retired &middot; preserved for audit
            </div>
          </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={exportRetired} className="flex items-center gap-1.5 px-3 py-1.5 border border-ink/[0.08] text-ink/50 hover:text-ink/75 text-[11px]">
            <Download size={12} /> Export
          </button>
          <button type="button" onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 border border-ink/[0.08] text-ink/50 hover:text-ink/75 text-[11px]">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-5 gap-3">
          {sections.map(({ key, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              className={cn(
                'border p-3 text-left transition-colors',
                expanded[key]
                  ? 'border-ink/[0.10] bg-ink/[0.04]'
                  : 'border-ink/[0.06] bg-ink/[0.015] hover:bg-ink/[0.03]',
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">{SECTION_ICONS[key]}</div>
              <div className="text-[22px] font-mono font-semibold text-ink/70">
                {count}
              </div>
              <div className="text-[9px] uppercase tracking-wider text-ink/35 mt-0.5">
                {key === 'deadCliTools' ? 'Dead CLI' : key === 'disabledTargets' ? 'Targets' : key === 'disabledFeeds' ? 'Feeds' : key === 'disabledPolicies' ? 'Policies' : 'Workflows'}
              </div>
            </button>
          ))}
        </div>

        {/* Detail sections */}
        <div className="space-y-3">
          {sections.map(({ key, count, items }) => (
            <div key={key} className="border border-ink/[0.06] overflow-hidden">
              <button
                type="button"
                onClick={() => toggle(key)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-ink/[0.02] hover:bg-ink/[0.04] text-left"
              >
                <div className="flex items-center gap-2">
                  {SECTION_ICONS[key]}
                  <span className="text-[12px] font-medium text-ink/65">{SECTION_LABELS[key]}</span>
                  <span className="text-[10px] text-ink/30 font-mono">({count})</span>
                </div>
                {expanded[key] ? <ChevronDown size={14} className="text-ink/30" /> : <ChevronRight size={14} className="text-ink/30" />}
              </button>

              {expanded[key] && (
                <div className="divide-y divide-ink/[0.04] max-h-[24rem] overflow-y-auto">
                  {items.length === 0 && (
                    <div className="px-4 py-8 text-center text-[11px] text-ink/30">
                      <Archive size={20} className="mx-auto mb-2 text-ink/15" />
                      No retired artifacts in this category
                    </div>
                  )}

                  {/* Dead CLI Tools */}
                  {key === 'deadCliTools' && items.map((item: DeadSource, i: number) => (
                    <div key={i} className="px-4 py-3 text-[11px] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-ink/60">{item.name}</span>
                        <span className="text-[10px] uppercase tracking-wider text-rose-400/60">Dead</span>
                      </div>
                      <div className="text-ink/30">
                        {item.domain} &middot; {item.source_type} &middot; {item.category}
                      </div>
                      <div className="text-ink/25">{item.registration}</div>
                    </div>
                  ))}

                  {/* Disabled Targets */}
                  {key === 'disabledTargets' && items.map((item: RetiredTarget) => (
                    <div key={item.id} className="px-4 py-3 text-[11px] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-ink/60 truncate max-w-md" title={item.value}>{item.value}</span>
                        <span className="text-[10px] text-ink/25">{ago(item.disabled_at)}</span>
                      </div>
                      <div className="text-ink/30">
                        <span className="uppercase text-[10px] text-ink/25 mr-1">{item.target_type}</span>
                        {item.product} &middot; {item.workflow_template} &middot; priority {item.priority}
                      </div>
                      <div className="text-amber-400/50 text-[10px]">
                        {item.reason}
                        {item.last_collected_at && <span className="text-ink/25 ml-1">(last: {ago(item.last_collected_at)})</span>}
                      </div>
                    </div>
                  ))}

                  {/* Disabled Feeds */}
                  {key === 'disabledFeeds' && items.map((item: RetiredFeed) => (
                    <div key={item.id} className="px-4 py-3 text-[11px] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-ink/60 truncate max-w-md">{item.name}</span>
                        <span className="text-[10px] text-ink/25">{ago(item.updated_at)}</span>
                      </div>
                      <div className="text-ink/30 text-[10px] truncate max-w-lg" title={item.feed_url}>
                        {item.feed_url}
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-ink/25 text-[10px]">{item.category}</span>
                        {item.discovered_via && <span className="text-ink/20 text-[10px]">via {item.discovered_via}</span>}
                      </div>
                      <div className="text-amber-400/50 text-[10px]">
                        {item.reason}
                        {item.last_error && item.last_ok_at && <span className="text-rose-400/40 ml-2">error: {item.last_error.slice(0, 60)}</span>}
                        {item.last_error && !item.last_ok_at && <span className="text-rose-400/60 ml-2">broken: {item.last_error.slice(0, 60)}</span>}
                      </div>
                    </div>
                  ))}

                  {/* Disabled Policies */}
                  {key === 'disabledPolicies' && items.map((item: RetiredPolicy) => (
                    <div key={item.id} className="px-4 py-3 text-[11px] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-ink/60">{item.name}</span>
                        <span className="text-[10px] text-ink/25">{item.id}</span>
                      </div>
                      <div className="text-ink/30">
                        {item.workflow_template} &middot; {item.schedule_mode}: {item.schedule_value}
                      </div>
                      {item.description && <div className="text-ink/25">{item.description}</div>}
                      <div className="text-amber-400/50 text-[10px]">{item.reason}</div>
                    </div>
                  ))}

                  {/* Deprecated Workflows */}
                  {key === 'deprecatedWorkflows' && items.map((item: DeprecatedWorkflow) => (
                    <div key={item.workflow} className="px-4 py-3 text-[11px] space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-ink/60">{item.workflow}</span>
                        <span className="text-[10px] text-slate-400/60">Deprecated</span>
                      </div>
                      <div className="text-ink/30">
                        {item.total} total targets: {item.active} active, {item.inactive} disabled
                      </div>
                      <div className="text-slate-400/50 text-[10px]">
                        All {item.total} targets disabled — workflow no longer in active use
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* footer note */}
        <div className="text-center text-[10px] text-ink/20 py-4">
          All retired artifacts preserved for audit trail — none have been deleted from the database.
        </div>
      </section>
    </div>
  );
};
