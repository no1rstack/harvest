import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Library, ExternalLink, Hash, Tag, AlertTriangle, Check, Clock } from 'lucide-react';
import { cn } from '../types';

interface EnrichmentStats {
  totalEntities: number;
  totalFacts: number;
  totalSnapshots: number;
  totalChanges: number;
  resolvedEntities: number;
  failedEntities: number;
  entitiesByType: Record<string, number>;
  recentRuns: Array<{ runId: string; startedAt: string; resolved: number; status: string }>;
  recentChanges: Array<{ entity: string; description: string; detectedAt: string; significance: string }>;
}

function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

export function EnrichmentPanel() {
  const [data, setData] = useState<EnrichmentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/enrichment/stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runEnrich = useCallback(async (count: number) => {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await fetch('/api/enrichment/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxCandidates: count, batchSize: 5 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRunResult(`Run complete: ${json.resolved} resolved, ${json.failed} failed, ${json.facts} facts added`);
      setTimeout(() => load(), 1000);
    } catch (e) {
      setRunResult(`Error: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }, [load]);

  if (loading && !data) return <div className="p-8 text-center text-[12px] text-ink/40">Loading enrichment data...</div>;
  if (error) return (
    <div className="border border-ink/[0.08] bg-ink/[0.02] p-8 text-center space-y-3">
      <AlertTriangle size={28} className="mx-auto text-rose-400/60" />
      <p className="text-[13px] text-rose-400/80">{error}</p>
      <button type="button" onClick={load} className="px-3 py-1.5 border border-ink/[0.12] text-[11px] text-ink/70">Retry</button>
    </div>
  );
  if (!data) return null;

  const typeEntries = Object.entries(data.entitiesByType)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  return (
    <section className="h-full overflow-y-auto space-y-6 px-2 pb-8">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold tracking-wide text-ink/75">Wiki Enrichment</div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-ink/35">
            {fmt(data.totalEntities)} entities · {fmt(data.totalFacts)} facts · {fmt(data.totalSnapshots)} snapshots
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 border border-ink/[0.08] text-ink/50 hover:text-ink/75 text-[11px]">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Resolved Entities', value: data.totalEntities, icon: Library, cls: 'text-sky-400/70' },
          { label: 'Facts Extracted', value: data.totalFacts, icon: Hash, cls: 'text-emerald-400/70' },
          { label: 'Snapshots', value: data.totalSnapshots, icon: Clock, cls: 'text-violet-400/70' },
          { label: 'Changes Detected', value: data.totalChanges, icon: Tag, cls: 'text-amber-400/70' },
        ].map(c => (
          <div key={c.label} className="border border-ink/[0.06] p-4">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink/35 mb-1">
              <c.icon size={12} className={c.cls} />
              {c.label}
            </div>
            <div className={cn('text-2xl font-mono font-light', c.cls)}>{fmt(c.value)}</div>
          </div>
        ))}
      </div>

      {/* Enrich now */}
      <div className="border border-ink/[0.06] p-4 space-y-3">
        <div className="text-[10px] uppercase tracking-wider text-ink/40">Pull from Wikimedia</div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            disabled={running}
            onClick={() => runEnrich(100)}
            className="px-3 py-1.5 border border-ink/[0.10] text-[11px] text-ink/60 hover:text-ink/80 disabled:opacity-40"
          >
            {running ? 'Running...' : 'Enrich 100'}
          </button>
          <button
            type="button"
            disabled={running}
            onClick={() => runEnrich(300)}
            className="px-3 py-1.5 border border-ink/[0.10] text-[11px] text-ink/60 hover:text-ink/80 disabled:opacity-40"
          >
            {running ? 'Running...' : 'Enrich 300'}
          </button>
          <span className="text-[10px] text-ink/30">
            Wikidata & Wikipedia — rate-limited, ~120ms per entity
          </span>
        </div>
        {runResult && (
          <div className="text-[11px] text-ink/60 bg-ink/[0.03] px-3 py-2">{runResult}</div>
        )}
      </div>

      {/* Entity type breakdown */}
      {typeEntries.length > 0 && (
        <div className="border border-ink/[0.06] overflow-hidden">
          <div className="px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/40">
            Entity Types
          </div>
          <div className="grid grid-cols-5 text-[11px]">
            {typeEntries.map(([type, count]) => (
              <div key={type} className="p-2.5 border-r border-ink/[0.04] last:border-r-0 border-b border-ink/[0.04]">
                <div className="text-ink/50 truncate" title={type}>{type || 'unknown'}</div>
                <div className="text-ink/25 font-mono text-[10px]">{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent runs */}
      {data.recentRuns.length > 0 && (
        <div className="border border-ink/[0.06] overflow-hidden">
          <div className="px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/40">
            Recent Enrichment Runs
          </div>
          <div className="divide-y divide-ink/[0.04]">
            {data.recentRuns.map((run) => (
              <div key={run.runId} className="px-3 py-2 flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2">
                  {run.status === 'completed' ? <Check size={10} className="text-emerald-400/60" /> : <Clock size={10} className="text-amber-400/60" />}
                  <span className="text-ink/50 font-mono text-[10px]">{run.runId.slice(0, 20)}...</span>
                </div>
                <div className="flex items-center gap-4 text-[10px]">
                  <span className="text-ink/30">{new Date(run.startedAt).toLocaleString()}</span>
                  <span className="text-sky-400/60">+{run.resolved} entities</span>
                  <span className={run.status === 'completed' ? 'text-emerald-400/50' : 'text-amber-400/50'}>{run.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent changes */}
      {data.recentChanges.length > 0 && (
        <div className="border border-ink/[0.06] overflow-hidden">
          <div className="px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/40">
            Recent Wikipedia Changes
          </div>
          <div className="divide-y divide-ink/[0.04]">
            {data.recentChanges.map((ch, i) => (
              <div key={i} className="px-3 py-2 text-[11px]">
                <div className="flex items-center gap-2">
                  <ExternalLink size={10} className="text-ink/30" />
                  <span className="text-ink/60 font-medium">{ch.entity}</span>
                  <span className={cn(
                    'text-[9px] px-1.5 py-0.5',
                    ch.significance === 'high' ? 'bg-rose-400/10 text-rose-400/70' :
                    ch.significance === 'medium' ? 'bg-amber-400/10 text-amber-400/70' :
                    'bg-ink/[0.04] text-ink/40'
                  )}>
                    {ch.significance}
                  </span>
                </div>
                <div className="text-ink/35 mt-0.5 text-[10px]">{ch.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
