import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Search, Globe, Rss, AlertTriangle, Database, Box, XCircle, CheckCircle, Clock, Play, Zap } from 'lucide-react';
import { cn } from '../types';

/* --- Data shapes matching the new /api/source-inventory response --- */

interface StreamInfo { items: number; latest: string; }
interface SourceItem { name: string; feed_url: string; last_ok_at: string | null; last_error: string | null; items: number; }
interface ErrorSource { name: string; feed_url: string; error: string; }
interface NoRssMethod { method: string; count: number; sources: Array<{ name: string; domain: string; priority: string }>; }
interface AcqCategory { category: string; rss: number; scraping: number; api: number; pageDiff: number; total: number; }
interface PipelineReality {
  catalog: { total: number; working: number; rssRegistered: number };
  reality: {
    acquisition: { working: number; errored: number; neverPulled: number };
    parse: { working: number; empty: number };
    persist: { communityItems: number };
    findings: { total: number; runs: number };
  };
}

interface SourceInventoryData {
  generatedAt: string;
  catalogTotal: number;
  dbConnected: boolean;
  feedsRegistered: number;
  feedsPulled: number;
  feedsNeverPulled: number;
  feedsErrored: number;
  feedsWithItems: number;
  feedsEmpty: number;
  streams: Record<string, StreamInfo>;
  totalCommunityItems: number;
  totalFindings: number;
  totalRuns: number;
  sourceItems: SourceItem[];
  erroredSources: ErrorSource[];
  noRssBreakdown: NoRssMethod[];
  topDuplicates?: Array<{ domain: string; count: number }>;
  duplicateDomainCount?: number;
  duplicateEntryCount?: number;
  categoryAcquisition: AcqCategory[];
  pipelineReality: PipelineReality;
}

/* --- helpers --- */
function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString();
}
function pct(n: number, total: number): string {
  if (!total) return '0%';
  return ((n / total) * 100).toFixed(1) + '%';
}

/* --- colours for feed health --- */
function feedTone(s: SourceItem): { cls: string; label: string } {
  if (s.items > 0) return { cls: 'text-emerald-400/70', label: 'Items' };
  if (s.last_ok_at && !s.last_error) return { cls: 'text-sky-400/70', label: 'Pulled' };
  if (s.last_error && !s.last_ok_at) return { cls: 'text-rose-400/70', label: 'Error' };
  return { cls: 'text-ink/30', label: 'Never' };
}

/* ================================================================ */

export function SourceInventoryPanel() {
  const [data, setData] = useState<SourceInventoryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rssSearch, setRssSearch] = useState('');
  const [rssFilter, setRssFilter] = useState<'all' | 'items' | 'pulled' | 'errored' | 'never'>('all');
  const [noRssOpen, setNoRssOpen] = useState<string | null>(null);
  const [view, setView] = useState<'overview' | 'rss' | 'no-rss' | 'pipeline' | 'errored' | 'category'>('overview');

  const [bridgeBusy, setBridgeBusy] = useState(false);
  const [bridgeResult, setBridgeResult] = useState<string | null>(null);
  const [bridgeStream, setBridgeStream] = useState('');
  const [bridgeLimit, setBridgeLimit] = useState(500);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/source-inventory');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, []);

  const doBridge = useCallback(async () => {
    setBridgeBusy(true);
    setBridgeResult(null);
    try {
      const res = await fetch('/api/source-inventory/bridge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream: bridgeStream || undefined, limit: bridgeLimit }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setBridgeResult(json.message);
      // Reload the inventory to show updated numbers
      setTimeout(() => load(), 500);
    } catch (e) {
      setBridgeResult(`Error: ${(e as Error).message}`);
    } finally {
      setBridgeBusy(false);
    }
  }, [bridgeStream, bridgeLimit, load]);

  useEffect(() => { void load(); }, [load]);

  const autoRetired = useRef(false);
  useEffect(() => {
    if (!data || data.feedsErrored <= 20 || autoRetired.current) return;
    autoRetired.current = true;
    fetch('/api/retired/retire-broken-feeds', { method: 'POST' })
      .then(() => load())
      .catch(() => { autoRetired.current = false; });
  }, [data?.feedsErrored, load]);

  const filteredSources = useMemo(() => {
    if (!data?.sourceItems) return [];
    let rows = data.sourceItems;
    if (rssSearch) {
      const q = rssSearch.toLowerCase();
      rows = rows.filter(s => s.name.toLowerCase().includes(q) || (s.feed_url || '').toLowerCase().includes(q));
    }
    if (rssFilter === 'items') rows = rows.filter(s => s.items > 0);
    else if (rssFilter === 'pulled') rows = rows.filter(s => s.last_ok_at && !s.last_error);
    else if (rssFilter === 'errored') rows = rows.filter(s => s.last_error && !s.last_ok_at);
    else if (rssFilter === 'never') rows = rows.filter(s => !s.last_ok_at && !s.last_error);
    return rows;
  }, [data, rssSearch, rssFilter]);

  /* ---- loading / error states ---- */
  if (loading && !data) return <div className="p-8 text-center text-[12px] text-ink/40">Loading source inventory...</div>;
  if (error) return (
    <div className="border border-ink/[0.08] bg-ink/[0.02] p-8 text-center space-y-3">
      <AlertTriangle size={28} className="mx-auto text-rose-400/60" />
      <p className="text-[13px] text-rose-400/80">{error}</p>
      <button type="button" onClick={load} className="px-3 py-1.5 border border-ink/[0.12] text-[11px] text-ink/70">Retry</button>
    </div>
  );
  if (!data) return null;

  const total = data.catalogTotal;

  /* ======== HEADER + SUMMARY CARDS ======== */
  return (
    <section className="h-full overflow-y-auto space-y-6 px-2 pb-8">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold tracking-wide text-ink/75">Source Inventory</div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-ink/35">
            {fmt(total)} catalogued · {fmt(data.feedsRegistered)} registered · {fmt(data.feedsPulled)} pulled · {fmt(data.feedsWithItems)} producing
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 border border-ink/[0.08] p-0.5">
            {(['overview','rss','no-rss','pipeline','errored','category'] as const).map(v => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={cn('px-2.5 py-1 text-[10px]', view===v?'bg-ink/[0.08] text-ink/70':'text-ink/35 hover:text-ink/55')}>
                {v==='overview'?'Overview'
                  :v==='rss'?`RSS (${data.feedsRegistered})`
                  :v==='no-rss'?'No RSS'
                  :v==='pipeline'?'Pipeline'
                  :v==='errored'?`Errors (${data.feedsErrored})`
                  :`Categories`}
              </button>
            ))}
          </div>
          <button type="button" onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 border border-ink/[0.08] text-ink/50 hover:text-ink/75 text-[11px]">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* --- summary stat cards --- */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label:'Catalog Total', value: total, icon: Globe, sub: 'harvest.md entries' },
          { label:'Feed Sources', value: data.feedsRegistered, icon: Rss, sub: `in community_feed_sources` },
          { label:'Pulled OK', value: data.feedsPulled, icon: CheckCircle, sub: `${pct(data.feedsPulled, data.feedsRegistered)} of registered` },
          { label:'Producing', value: data.feedsWithItems, icon: Box, sub: `${fmt(data.totalCommunityItems)} items total` },
          { label:'Errored', value: data.feedsErrored, icon: XCircle, sub: 'feed pull failed' },
          { label:'Never Pulled', value: data.feedsNeverPulled, icon: Clock, sub: 'registered, untouched' },
        ].map(s => (
          <div key={s.label} className="border border-ink/[0.06] bg-ink/[0.015] p-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink/35 mb-1">
              <s.icon size={10} />{s.label}
            </div>
            <div className="text-lg font-mono text-ink/70">{fmt(s.value)}</div>
            <div className="text-[9px] text-ink/25">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ---- CRITICAL WARNING BAR if findings empty ---- */}
      {data.totalFindings === 0 && data.totalCommunityItems > 0 && (
        <>
        <div className="border border-rose-500/20 bg-rose-500/[0.04] px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-rose-400/60 shrink-0 mt-0.5" />
          <div className="text-[11px] text-rose-400/80">
            <span className="font-semibold">Pipeline stalled.</span> {fmt(data.totalCommunityItems)} items exist in community_items, but osint_harvest_findings has <strong>0</strong> records and osint_harvest_runs has <strong>0</strong> runs. The ingestion pipeline is not producing findings. Collection targets, Cascades workflows, or the finder step need attention.
          </div>
        </div>

        {/* Bridge section */}
        <div className="border border-emerald-500/20 bg-emerald-500/[0.03] p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-emerald-400/70" />
            <span className="text-[10px] uppercase tracking-wider text-emerald-400/70">Direct Bridge — bypass Cascades</span>
          </div>
          <div className="text-[11px] text-ink/45">Convert community_items directly to osint_harvest_findings. Select a stream or bridge all.</div>
          <div className="flex items-end gap-3 flex-wrap">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40">
              Stream
              <select value={bridgeStream} onChange={e => setBridgeStream(e.target.value)}
                className="bg-noir-bg border border-ink/[0.08] px-2 py-1.5 text-[12px] text-ink/70 min-w-[8rem]">
                <option value="">All streams</option>
                {Object.keys(data.streams).map(s => <option key={s} value={s}>{s} ({fmt(data.streams[s].items)})</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40">
              Limit
              <input type="number" value={bridgeLimit} onChange={e => setBridgeLimit(Math.min(5000, Math.max(1, Number(e.target.value)||500)))}
                className="bg-noir-bg border border-ink/[0.08] px-2 py-1.5 text-[12px] text-ink/70 w-20 font-mono" />
            </label>
            <button type="button" disabled={bridgeBusy} onClick={doBridge}
              className="flex items-center gap-1.5 px-4 py-1.5 border border-emerald-400/30 text-emerald-400/80 hover:bg-emerald-400/[0.06] text-[11px] disabled:opacity-40">
              <Play size={12} /> {bridgeBusy ? 'Bridging...' : `Bridge to Findings`}
            </button>
          </div>
          {bridgeResult && (
            <div className={cn('text-[11px] px-2 py-1', bridgeResult.startsWith('Error') ? 'text-rose-400/70 bg-rose-400/[0.04]' : 'text-emerald-400/70 bg-emerald-400/[0.04]')}>
              {bridgeResult}
            </div>
          )}
        </div>
        </>
      )}

      {/* ======== OVERVIEW ======== */}
      {view === 'overview' && (
        <>
          {/* Feed health bar */}
          <div className="border border-ink/[0.06] bg-ink/[0.015] overflow-hidden">
            <div className="px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/40">
              Feed Source Health
            </div>
            <div className="p-3 grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { cls:'bg-emerald-400/20', label:'Producing items', count: data.feedsWithItems },
                { cls:'bg-sky-400/20', label:'Pulled (empty)', count: data.feedsEmpty },
                { cls:'bg-rose-400/20', label:'Errored', count: data.feedsErrored },
                { cls:'bg-ink/[0.05]', label:'Never pulled', count: data.feedsNeverPulled },
              ].map(r => (
                <div key={r.label} className="flex items-center gap-2">
                  <div className={cn('w-2 h-2 shrink-0', r.cls)} />
                  <span className="text-[10px] text-ink/50">{r.label}</span>
                  <span className="text-[11px] font-mono text-ink/70 ml-auto">{r.count}</span>
                </div>
              ))}
            </div>
            {/* bar */}
            <div className="px-3 pb-3">
              <div className="h-1.5 flex overflow-hidden border border-ink/[0.06]">
                {data.feedsWithItems>0 && <div className="bg-emerald-400/40" style={{width: pct(data.feedsWithItems, data.feedsRegistered)}} />}
                {data.feedsEmpty>0 && <div className="bg-sky-400/40" style={{width: pct(data.feedsEmpty, data.feedsRegistered)}} />}
                {data.feedsErrored>0 && <div className="bg-rose-400/40" style={{width: pct(data.feedsErrored, data.feedsRegistered)}} />}
                {data.feedsNeverPulled>0 && <div className="bg-ink/[0.08]" style={{width: pct(data.feedsNeverPulled, data.feedsRegistered)}} />}
              </div>
            </div>
          </div>

          {/* Stream producers */}
          {Object.keys(data.streams).length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-ink/35">Active Streams ({Object.keys(data.streams).length})</div>
              <div className="border border-ink/[0.06] overflow-hidden">
                <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/35">
                  <span>Stream</span><span className="text-right">Items</span><span className="text-right">Latest</span>
                </div>
                <div className="divide-y divide-ink/[0.04]">
                  {Object.entries(data.streams).map(([name, info]) => (
                    <div key={name} className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-2 text-[11px]">
                      <span className="text-ink/55 capitalize">{name}</span>
                      <span className="text-emerald-400/60 text-right font-mono">{fmt(info.items)}</span>
                      <span className="text-ink/30 text-right">{info.latest ? new Date(info.latest).toLocaleString() : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

        </>
      )}

      {/* ======== RSS (REAL DATABASE STATE) ======== */}
      {view === 'rss' && (
        <div className="space-y-3">
          <div className="flex gap-3 flex-wrap">
            <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-ink/40 flex-1 min-w-[12rem]">
              Search
              <input value={rssSearch} onChange={e => setRssSearch(e.target.value)} placeholder="name or feed URL…"
                className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[12px] text-ink/70 normal-case tracking-normal" />
            </label>
            <div className="flex items-end gap-0.5">
              {(['all','items','pulled','errored','never'] as const).map(f => (
                <button key={f} type="button" onClick={() => setRssFilter(f)}
                  className={cn('px-2 py-1.5 text-[10px] border border-ink/[0.08]',
                    rssFilter===f ? 'bg-ink/[0.06] text-ink/70' : 'text-ink/35 hover:text-ink/55')}>
                  {f==='all'?`All (${data.feedsRegistered})`:f==='items'?`Items (${data.feedsWithItems})`:f==='pulled'?`Pulled`:f==='errored'?`Errored (${data.feedsErrored})`:`Never (${data.feedsNeverPulled})`}
                </button>
              ))}
            </div>
          </div>
          <div className="text-[10px] uppercase tracking-wider text-ink/35">{filteredSources.length} matching</div>
          <div className="border border-ink/[0.06] overflow-hidden">
            <div className="grid grid-cols-[1fr_4rem_8rem] gap-2 px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/35">
              <span>Source</span><span className="text-right">Items</span><span>Status</span>
            </div>
            <div className="max-h-[50rem] overflow-y-auto divide-y divide-ink/[0.04]">
              {filteredSources.map(s => {
                const t = feedTone(s);
                return (
                  <div key={s.name + (s.feed_url||'')} className="grid grid-cols-[1fr_4rem_8rem] gap-2 px-3 py-2 text-[11px]">
                    <span className="text-ink/55 truncate" title={s.feed_url||''}>{s.name}</span>
                    <span className={cn('text-right font-mono', s.items>0?'text-emerald-400/60':'text-ink/25')}>{s.items>0?fmt(s.items):'—'}</span>
                    <span className={cn('text-[10px]', t.cls)}>{t.label}{s.last_ok_at ? ' '+new Date(s.last_ok_at).toLocaleTimeString() : ''}</span>
                  </div>
                );
              })}
              {filteredSources.length===0 && <p className="px-3 py-8 text-center text-[12px] text-ink/30">No feeds match</p>}
            </div>
          </div>
        </div>
      )}

      {/* ======== NO-RSS (CATALOG WISHLIST) ======== */}
      {view === 'no-rss' && (
        <div className="space-y-4">
          <div className="text-[10px] text-ink/35">These {total - data.feedsRegistered} sources are in the catalog but not in the database. They need acquisition work.</div>
          {data.noRssBreakdown.map(m => {
            const open = noRssOpen === m.method;
            return (
              <div key={m.method} className="border border-ink/[0.06] bg-ink/[0.015] overflow-hidden">
                <button type="button" onClick={() => setNoRssOpen(open?null:m.method)}
                  className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-ink/[0.02]">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-ink/40">{m.method}</span>
                    <span className="text-[11px] font-mono text-ink/70">{m.count} sources</span>
                  </div>
                  <span className="text-[10px] text-ink/30">{pct(m.count, total)}</span>
                </button>
                {open && (
                  <div className="border-t border-ink/[0.04] max-h-[24rem] overflow-y-auto">
                    <div className="grid grid-cols-[1fr_1fr_5rem] gap-2 px-3 py-2 border-b border-ink/[0.04] text-[9px] uppercase tracking-wider text-ink/30">
                      <span>Source</span><span>Domain</span><span>Priority</span>
                    </div>
                    {m.sources.map(s => (
                      <div key={s.domain+s.name} className="grid grid-cols-[1fr_1fr_5rem] gap-2 px-3 py-2 text-[11px]">
                        <span className="text-ink/50 truncate">{s.name}</span>
                        <span className="text-ink/30 truncate font-mono">{s.domain}</span>
                        <span className={cn('text-[10px]', s.priority==='high'?'text-amber-400/70':'text-ink/30')}>{s.priority}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ======== PIPELINE REALITY ======== */}
      {view === 'pipeline' && (
        <div className="space-y-4">
          <div className="text-[10px] uppercase tracking-wider text-ink/35">Pipeline Reality — what the database actually contains</div>

          {/* Stage 1: Acquisition */}
          <div className="border border-ink/[0.06] overflow-hidden">
            <div className="px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/40">1. Acquisition (community_feed_sources)</div>
            <div className="grid grid-cols-4 text-[11px]">
              {[
                { label:'Pulled OK', v: data.feedsPulled, cls:'text-emerald-400/60' },
                { label:'Errored', v: data.feedsErrored, cls:'text-rose-400/60' },
                { label:'Never Pulled', v: data.feedsNeverPulled, cls:'text-ink/35' },
                { label:'Total Registered', v: data.feedsRegistered, cls:'text-sky-400/60' },
              ].map(c => (
                <div key={c.label} className="p-3 border-r border-ink/[0.04] last:border-r-0">
                  <div className="text-[10px] text-ink/35">{c.label}</div>
                  <div className={cn('text-lg font-mono', c.cls)}>{fmt(c.v)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Stage 2: Parse */}
          <div className="border border-ink/[0.06] overflow-hidden">
            <div className="px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/40">2. Parse (community_items)</div>
            <div className="grid grid-cols-3 text-[11px]">
              {[
                { label:'Total Items', v: data.totalCommunityItems, cls:'text-emerald-400/60' },
                { label:'Sources With Items', v: data.feedsWithItems, cls:'text-sky-400/60' },
                { label:'Sources Pulled But Empty', v: data.feedsEmpty, cls:'text-amber-400/60' },
              ].map(c => (
                <div key={c.label} className="p-3 border-r border-ink/[0.04] last:border-r-0">
                  <div className="text-[10px] text-ink/35">{c.label}</div>
                  <div className={cn('text-lg font-mono', c.cls)}>{fmt(c.v)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Stage 3: Findings */}
          <div className={cn('border overflow-hidden', data.totalFindings === 0 ? 'border-rose-500/20 bg-rose-500/[0.04]' : 'border-ink/[0.06]')}>
            <div className="px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/40">3. Findings & Runs (osint_harvest_*)</div>
            <div className="grid grid-cols-2 text-[11px]">
              {[
                { label:'Findings', v: data.totalFindings, cls: data.totalFindings===0 ? 'text-rose-400/60' : 'text-emerald-400/60' },
                { label:'Runs Executed', v: data.totalRuns, cls: data.totalRuns===0 ? 'text-rose-400/60' : 'text-emerald-400/60' },
              ].map(c => (
                <div key={c.label} className="p-3 border-r border-ink/[0.04] last:border-r-0">
                  <div className="text-[10px] text-ink/35">{c.label}</div>
                  <div className={cn('text-lg font-mono', c.cls)}>{fmt(c.v)}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Pipeline gap analysis */}
          {data.totalCommunityItems > 0 && data.totalFindings === 0 && (
            <div className="border border-amber-500/20 bg-amber-500/[0.03] p-4 space-y-2 text-[11px]">
              <div className="text-amber-400/70 font-semibold text-[10px] uppercase tracking-wider">Pipeline Gap</div>
              <div className="text-ink/45 leading-relaxed">
                <span className="text-emerald-400/60 font-mono">{fmt(data.totalCommunityItems)}</span> community items exist but
                <span className="text-rose-400/60 font-mono"> 0</span> findings and
                <span className="text-rose-400/60 font-mono"> 0</span> runs.
                The gap is between community_items ingestion and the findings pipeline. Possible causes:
              </div>
              <ul className="list-disc list-inside text-ink/35 space-y-0.5">
                <li>No collection targets registered (Targets tab is empty or targets not pointing to streams)</li>
                <li>Cascades workflows not configured to consume community feeds</li>
                <li>The finder/OSINT step that reads community_items and produces findings is not wired</li>
                <li>The Cascades daemon is not running (or not connected to Harvest)</li>
              </ul>
            </div>
          )}

          {/* Catalog reference (what we wish for) */}
          <div className="border border-ink/[0.04] bg-ink/[0.01] p-3 text-[10px] text-ink/30 leading-relaxed">
            <span className="text-ink/40">Catalog reference:</span> {fmt(total)} sources from harvest.md — {fmt(data.pipelineReality?.catalog?.rssRegistered || 0)} attempted RSS registration, 802 need scraper/API/page-diff work.
          </div>
        </div>
      )}

      {/* ======== ERRORED FEEDS ======== */}
      {view === 'errored' && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-ink/35">Errored Feeds ({data.erroredSources.length})</div>
          {data.erroredSources.length === 0 ? (
            <div className="border border-ink/[0.06] bg-ink/[0.015] p-6 text-center text-[12px] text-ink/30">No errors — all feeds healthy</div>
          ) : (
            <div className="border border-ink/[0.06] overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/35">
                <span>Source</span><span>Feed URL</span><span>Error</span>
              </div>
              <div className="max-h-[calc(100vh-20rem)] overflow-y-auto divide-y divide-ink/[0.04]">
                {data.erroredSources.map(e => (
                  <div key={e.name} className="grid grid-cols-[1fr_1fr_auto] gap-2 px-3 py-2 text-[11px]">
                    <span className="text-ink/50 truncate">{e.name}</span>
                    <span className="text-ink/25 truncate font-mono text-[10px]" title={e.feed_url}>{e.feed_url}</span>
                    <span className="text-rose-400/60 truncate max-w-[18rem]">{e.error || 'unknown'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ======== CATALOG BY CATEGORY ======== */}
      {view === 'category' && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-ink/35">Catalog by Category — acquisition method breakdown</div>
          {data.categoryAcquisition.length === 0 ? (
            <div className="border border-ink/[0.06] bg-ink/[0.015] p-6 text-center text-[12px] text-ink/30">No category data available</div>
          ) : (
            <div className="border border-ink/[0.06] overflow-hidden">
              <div className="grid grid-cols-[1fr_repeat(4,5rem)_4rem] gap-2 px-3 py-2 border-b border-ink/[0.06] text-[10px] uppercase tracking-wider text-ink/35">
                <span>Category</span><span className="text-right">RSS</span><span className="text-right">Scrape</span><span className="text-right">API</span><span className="text-right">Diff</span><span className="text-right">Total</span>
              </div>
              <div className="max-h-[calc(100vh-16rem)] overflow-y-auto divide-y divide-ink/[0.04]">
                {data.categoryAcquisition.map(c => (
                  <div key={c.category} className="grid grid-cols-[1fr_repeat(4,5rem)_4rem] gap-2 px-3 py-2 text-[11px] hover:bg-ink/[0.02]">
                    <span className="text-ink/55 truncate">{c.category}</span>
                    <span className="text-emerald-400/60 text-right font-mono">{c.rss}</span>
                    <span className="text-sky-400/60 text-right font-mono">{c.scraping}</span>
                    <span className="text-amber-400/60 text-right font-mono">{c.api}</span>
                    <span className="text-ink/25 text-right font-mono">{c.pageDiff}</span>
                    <span className="text-ink/60 text-right font-mono font-semibold">{c.total}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="text-[9px] text-ink/20 text-right">
        {data.dbConnected ? 'Live from database' : 'Static catalog (database not connected)'} · generated {data.generatedAt !== 'unknown' ? new Date(data.generatedAt).toLocaleString() : '—'}
      </div>
    </section>
  );
}
