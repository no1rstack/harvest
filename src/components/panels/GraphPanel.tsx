import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, ListTree, RefreshCw } from 'lucide-react';

interface GraphEdge {
  id: string;
  source_entity_type: string;
  source_value: string;
  target_entity_type: string;
  target_value: string;
  relation: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export const GraphPanel: React.FC = () => {
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState('');
  const [runIdFilter, setRunIdFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (sourceFilter.trim()) params.set('source', sourceFilter.trim());
      if (runIdFilter.trim()) params.set('workflow_run_id', runIdFilter.trim());
      const res = await fetch(`/api/collection/graph?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setEdges(body.graph || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, runIdFilter]);

  useEffect(() => { load(); }, [load]);

  const uniqueNodes = Array.from(
    new Map(
      edges.flatMap(e => [
        [e.source_value, e.source_entity_type] as [string, string],
        [e.target_value, e.target_entity_type] as [string, string],
      ]).map(([value, type]) => [`${value}::${type}`, { value, type }])
    ).values()
  );

  return (
    <div className="h-full overflow-auto">
      <div className="p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ListTree size={14} className="text-ink/40"/>
            <span className="text-[10px] uppercase tracking-wider text-ink/40">Knowledge Graph</span>
          </div>
          <button onClick={load} className="text-[10px] text-ink/30 hover:text-ink/50"><RefreshCw size={11} className="inline"/></button>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-2 border border-amber-400/20 bg-amber-400/[0.05] text-amber-200/70 text-[11px]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0"/>{error}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2">
          <input value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="Filter by source…"
            className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/60 flex-1" />
          <input value={runIdFilter} onChange={e => setRunIdFilter(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
            placeholder="Filter by run…"
            className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/60 w-48" />
        </div>

        {loading ? (
          <div className="text-[12px] text-ink/40 p-4">Loading graph...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Nodes */}
            <div className="border border-ink/[0.05] p-3">
              <div className="text-[10px] uppercase tracking-wider text-ink/40 mb-2">Nodes ({uniqueNodes.length})</div>
              <div className="space-y-1 max-h-[60vh] overflow-auto">
                {uniqueNodes.slice(0, 100).map((n, i) => (
                  <div key={i} className="text-[11px] text-ink/60 font-mono truncate">
                    {n.value} <span className="text-ink/30 ml-1">[{n.type}]</span>
                  </div>
                ))}
                {uniqueNodes.length > 100 && <div className="text-[10px] text-ink/30">... +{uniqueNodes.length - 100} more</div>}
                {uniqueNodes.length === 0 && <div className="text-[11px] text-ink/25 italic">No nodes found</div>}
              </div>
            </div>

            {/* Edges */}
            <div className="border border-ink/[0.05] p-3">
              <div className="text-[10px] uppercase tracking-wider text-ink/40 mb-2">Edges ({edges.length})</div>
              <div className="space-y-1.5 max-h-[60vh] overflow-auto">
                {edges.slice(0, 100).map((e, i) => (
                  <div key={e.id || i} className="border border-ink/[0.04] p-2">
                    <div className="text-[11px] text-ink/55 font-mono">
                      {e.source_value} <span className="text-ink/20">→</span> {e.target_value}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-ink/25 uppercase">{e.relation}</span>
                      {e.confidence != null && (
                        <span className="text-[9px] text-ink/20 font-mono">conf {e.confidence.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                ))}
                {edges.length > 100 && <div className="text-[10px] text-ink/30">... +{edges.length - 100} more</div>}
                {edges.length === 0 && <div className="text-[11px] text-ink/25 italic">No edges found — try a collection run first</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
