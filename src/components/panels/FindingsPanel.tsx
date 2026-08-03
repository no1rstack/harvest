import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw, X, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

interface HarvestFinding {
  id: string; run_id?: string; source: string; entity_type: string;
  value: string; label?: string; title: string; description?: string;
  severity?: string; confidence?: number; product?: string; tags?: string[];
  created_at: string; observed_at?: string; run_target?: string; raw?: unknown;
  workflow_template?: string | null; workflow_run_id?: string | null;
  connector_id?: string | null; target_id?: string | null;
}

interface FindingsData {
  findings: HarvestFinding[];
  total: number; page: number; pages: number;
  bySource: Array<{ source: string; count: number }>;
  byEntityType: Array<{ entity_type: string; count: number }>;
}

const PAGE_SIZE = 50;

const FIELD_LABELS: Record<string, string> = {
  id: 'ID', run_id: 'Run', source: 'Source', entity_type: 'Type',
  value: 'Value', label: 'Label', title: 'Title', description: 'Description',
  severity: 'Severity', confidence: 'Confidence', product: 'Product', tags: 'Tags',
  observed_at: 'Observed', created_at: 'Created', run_target: 'Target',
  workflow_template: 'Workflow', workflow_run_id: 'Workflow Run',
  connector_id: 'Connector', target_id: 'Target ID', raw: 'Raw',
};

const FIELD_ORDER = [
  'value','title','description','label','entity_type','source','product',
  'severity','confidence','run_target','tags','observed_at','created_at',
  'run_id','target_id','workflow_template','workflow_run_id','connector_id',
  'id','raw',
];

function formatFieldValue(f: HarvestFinding, key: string): string {
  const v = (f as any)[key];
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v, null, 2);
  if (key === 'observed_at' || key === 'created_at') return new Date(v).toLocaleString();
  if (key === 'confidence' && typeof v === 'number') return v.toFixed(4);
  return String(v);
}

export const FindingsPanel: React.FC = () => {
  const [data, setData] = useState<FindingsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [source, setSource] = useState('');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<HarvestFinding | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async (pg: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (source) params.set('source', source);
      if (entityType) params.set('entity_type', entityType);
      params.set('page', String(pg));
      params.set('limit', String(PAGE_SIZE));
      const res = await fetch(`/api/harvest/findings?${params}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const json = await res.json();
      setData(json);
      setPage(pg);
      setSelected(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [q, source, entityType]);

  useEffect(() => { load(0); }, []);

  const copyRaw = async () => {
    if (!selected) return;
    await navigator.clipboard.writeText(JSON.stringify(selected, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-3 space-y-3">

        {/* Search bar */}
        <div className="flex flex-wrap items-end gap-2 border border-ink/[0.05] bg-ink/[0.015] p-3">
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40 flex-1 min-w-[10rem]">
            Search
            <input value={q} onChange={e => setQ(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && load(0)}
              placeholder="value, title, label..."
              className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[12px] text-ink/70 normal-case tracking-normal" />
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40">
            Source
            <select value={source} onChange={e => { setSource(e.target.value); setTimeout(() => load(0), 0); }}
              className="bg-noir-bg border border-ink/[0.08] px-2 py-1.5 text-[12px] text-ink/70 normal-case tracking-normal min-w-[8rem]">
              <option value="">All</option>
              {(data?.bySource || []).map(s => <option key={s.source} value={s.source}>{s.source} ({s.count})</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40">
            Type
            <select value={entityType} onChange={e => { setEntityType(e.target.value); setTimeout(() => load(0), 0); }}
              className="bg-noir-bg border border-ink/[0.08] px-2 py-1.5 text-[12px] text-ink/70 normal-case tracking-normal min-w-[8rem]">
              <option value="">All</option>
              {(data?.byEntityType || []).map(t => <option key={t.entity_type} value={t.entity_type}>{t.entity_type} ({t.count})</option>)}
            </select>
          </label>
          <button onClick={() => load(0)} className="px-3 py-1.5 text-[11px] border border-ink/[0.08] text-ink/60 hover:text-ink/80">
            <RefreshCw size={12} className="inline mr-1" />Search
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 p-2 border border-amber-400/20 bg-amber-400/[0.05] text-amber-200/70 text-[11px]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0"/>{error}
          </div>
        )}

        <div className="text-[10px] text-ink/40">{data?.total ?? 0} findings</div>

        {/* Split: table + detail */}
        <div className="flex gap-0 min-h-0">
          {/* Table side */}
          <div className={selected ? 'flex-1 min-w-0 border border-ink/[0.05]' : 'flex-1 border border-ink/[0.05]'}>
            {!data ? (
              <div className="text-[12px] text-ink/40 p-4 text-center">{loading ? 'Loading...' : 'No data'}</div>
            ) : (
              <>
                <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 z-10">
                      <tr className="border-b border-ink/[0.08] text-ink/40 text-[10px] uppercase tracking-wider bg-noir-bg">
                        <th className="text-left p-2">Value</th><th className="text-left p-2">Title</th><th className="text-left p-2">Type</th><th className="text-left p-2">Source</th><th className="text-left p-2">Severity</th><th className="text-left p-2">Conf</th><th className="text-left p-2">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(data.findings || []).map(f => {
                        const date = f.observed_at || f.created_at || '';
                        const isSel = selected?.id === f.id;
                        return (
                          <tr key={f.id}
                            onClick={() => setSelected(isSel ? null : f)}
                            className={
                              'border-b border-ink/[0.03] cursor-pointer transition-colors '
                              + (isSel ? 'bg-ink/[0.06]' : 'hover:bg-ink/[0.02]')
                            }>
                            <td className="p-2 font-mono text-ink/60 max-w-[18rem] truncate">{f.value}</td>
                            <td className="p-2 text-ink/70 max-w-[14rem] truncate">{f.title}</td>
                            <td className="p-2 text-ink/45">{f.entity_type}</td>
                            <td className="p-2 text-ink/45">{f.source}</td>
                            <td className="p-2 text-ink/45">{f.severity || '-'}</td>
                            <td className="p-2 text-ink/45">{f.confidence != null ? f.confidence.toFixed(2) : '-'}</td>
                            <td className="p-2 text-ink/40 whitespace-nowrap">{date ? new Date(date).toLocaleDateString() : '-'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {data.pages > 1 && (
                  <div className="flex items-center justify-between p-2 border-t border-ink/[0.08] text-[11px] text-ink/40 bg-noir-bg">
                    <span>Page {page + 1} of {data.pages}</span>
                    <div className="flex gap-1">
                      <button disabled={page === 0} onClick={() => load(page - 1)} className="px-2 py-0.5 border border-ink/[0.08] disabled:opacity-30">Prev</button>
                      <button disabled={page >= data.pages - 1} onClick={() => load(page + 1)} className="px-2 py-0.5 border border-ink/[0.08] disabled:opacity-30">Next</button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="w-[26rem] shrink-0 border border-ink/[0.08] bg-ink/[0.015] overflow-y-auto max-h-[75vh] ml-2">
              <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-2 border-b border-ink/[0.06] bg-noir-bg">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-ink/40">Finding Detail</span>
                  <span className="text-[10px] font-mono text-ink/20">{selected.id.slice(0, 12)}…</span>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={copyRaw}
                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] border border-ink/[0.08] text-ink/35 hover:text-ink/60">
                    {copied ? <Check size={10} className="text-emerald-400/60"/> : <Copy size={10} />}
                    {copied ? 'Copied' : 'Raw JSON'}
                  </button>
                  <button onClick={() => setSelected(null)}
                    className="p-0.5 text-ink/25 hover:text-ink/50"><X size={13} /></button>
                </div>
              </div>

              <div className="divide-y divide-ink/[0.04]">
                {FIELD_ORDER.map(key => {
                  const label = FIELD_LABELS[key] || key;
                  const val = formatFieldValue(selected, key);
                  if (!val) return null;

                  const isLong = val.length > 120 || val.includes('\n');
                  const isRaw = key === 'raw';

                  return (
                    <div key={key} className="px-3 py-2">
                      <div className="text-[9px] uppercase tracking-wider text-ink/25 mb-1">{label}</div>
                      {isRaw ? (
                        <pre className="text-[10px] font-mono text-ink/50 bg-noir-bg border border-ink/[0.05] p-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{val}</pre>
                      ) : isLong ? (
                        <ExpandableText text={val} />
                      ) : (
                        <div className="text-[11px] text-ink/65 break-all">{val}</div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Navigation */}
              <div className="sticky bottom-0 border-t border-ink/[0.06] bg-noir-bg px-3 py-2 flex items-center justify-between text-[10px]">
                <button
                  onClick={() => {
                    const idx = (data?.findings || []).findIndex(f => f.id === selected.id);
                    if (idx > 0) setSelected(data!.findings[idx - 1]);
                  }}
                  disabled={!data || (data.findings.findIndex(f => f.id === selected.id) <= 0)}
                  className="text-ink/35 hover:text-ink/60 disabled:opacity-20">
                  ← Previous
                </button>
                <span className="text-ink/20">
                  {(data?.findings || []).findIndex(f => f.id === selected.id) + 1} of {data?.findings.length}
                </span>
                <button
                  onClick={() => {
                    const idx = (data?.findings || []).findIndex(f => f.id === selected.id);
                    if (idx >= 0 && idx < (data?.findings || []).length - 1) setSelected(data!.findings[idx + 1]);
                  }}
                  disabled={!data || (data.findings.findIndex(f => f.id === selected.id) >= (data?.findings.length ?? 0) - 1)}
                  className="text-ink/35 hover:text-ink/60 disabled:opacity-20">
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/** Inline expand/collapse for long text fields. */
function ExpandableText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.slice(0, 120);
  const hasMore = text.length > 120;
  return (
    <div>
      <div className="text-[11px] text-ink/65 break-all">
        {open ? text : preview + (hasMore ? '…' : '')}
      </div>
      {hasMore && (
        <button onClick={() => setOpen(!open)}
          className="mt-1 text-[9px] text-ink/30 hover:text-ink/50 flex items-center gap-0.5">
          {open ? <><ChevronUp size={10}/> Collapse</> : <><ChevronDown size={10}/> Show all ({text.length.toLocaleString()} chars)</>}
        </button>
      )}
    </div>
  );
}
