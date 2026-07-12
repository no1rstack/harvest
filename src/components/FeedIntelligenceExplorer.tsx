import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search, Sparkles, Play, Filter } from 'lucide-react';
import { cn } from '../types';

interface CommunityItem {
  id: string;
  title: string;
  summary: string;
  stream: string;
  category: string;
  severity: string;
  sourceName: string;
  publishedAt: string;
  payload?: {
    enrichment?: { keywords?: string[]; entities?: string[] };
  };
}

interface Facets {
  keywords: Array<{ term: string; count: number }>;
  entities: Array<{ term: string; count: number }>;
  categories: Array<{ term: string; count: number }>;
  streams: Array<{ term: string; count: number }>;
}

export function FeedIntelligenceExplorer() {
  const [hours, setHours] = useState(48);
  const [stream, setStream] = useState('');
  const [category, setCategory] = useState('');
  const [q, setQ] = useState('');
  const [keyword, setKeyword] = useState('');
  const [items, setItems] = useState<CommunityItem[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [expandResult, setExpandResult] = useState<string | null>(null);
  const [stats, setStats] = useState<{ total: number } | null>(null);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set('hours', String(hours));
    p.set('limit', '200');
    if (stream) p.set('stream', stream);
    if (category) p.set('category', category);
    if (q) p.set('q', q);
    if (keyword) p.set('keyword', keyword);
    return p.toString();
  }, [hours, stream, category, q, keyword]);

  const load = useCallback(async () => {
    setBusy(true);
    setExpandResult(null);
    try {
      const [itemsRes, facetsRes] = await Promise.all([
        fetch(`/api/feeds/community/items?${queryString}`),
        fetch(`/api/feeds/community/facets?hours=${hours}${stream ? `&stream=${encodeURIComponent(stream)}` : ''}`),
      ]);
      const itemsJson = await itemsRes.json();
      const facetsJson = await facetsRes.json();
      setItems(itemsJson.items || []);
      setStats(itemsJson.stats || null);
      setFacets(facetsJson.facets || null);
    } catch (e) {
      console.warn('feed intelligence load failed', e);
    } finally {
      setBusy(false);
    }
  }, [queryString, hours, stream]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runExpand = async (enqueue: boolean) => {
    setBusy(true);
    setExpandResult(null);
    try {
      const body: Record<string, unknown> = {
        enqueue,
        expand: true,
        hours,
      };
      if (selected.size) body.item_ids = [...selected];
      else if (keyword) body.keywords = [keyword];
      else if (q) body.keywords = [q];

      const res = await fetch('/api/feeds/community/expand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setExpandResult(
        `Seeds: ${json.seeds?.length ?? 0} → ${json.expanded?.length ?? 0} terms, ` +
          `${json.targets?.length ?? 0} targets${enqueue ? `, ${json.enqueued ?? 0} enqueued` : ''}`,
      );
    } catch (e) {
      setExpandResult((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runEnrich = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/feeds/community/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: 168, stream: stream || undefined, limit: 500 }),
      });
      const json = await res.json();
      setExpandResult(`Backfill enriched ${json.enriched ?? 0} items`);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const facetChip = (term: string, count: number, onClick: () => void) => (
    <button
      key={term}
      type="button"
      onClick={onClick}
      className="px-2 py-0.5 border border-ink/[0.08] text-[10px] text-ink/55 hover:bg-ink/[0.05] hover:text-ink/75"
    >
      {term} <span className="text-ink/30">({count})</span>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink/45">Feed intelligence — slice, extract, expand</div>
          <div className="text-[11px] text-ink/40 mt-0.5">
            Query RSS & community items, extract keywords, seed Cascades threat-feed collection
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} disabled={busy} className="text-[10px] text-ink/45 hover:text-ink/70 flex items-center gap-1">
            <RefreshCw size={11} className={busy ? 'animate-spin' : ''} /> Refresh
          </button>
          <button type="button" onClick={() => void runEnrich()} disabled={busy} className="text-[10px] border border-ink/[0.08] px-2 py-1 text-ink/55 hover:text-ink/75">
            Backfill enrich
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-1 space-y-3 border border-ink/[0.06] bg-ink/[0.015] p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink/40">
            <Filter size={11} /> Filters
          </div>
          <label className="block text-[10px] text-ink/40">
            Hours
            <input type="number" value={hours} onChange={(e) => setHours(Number(e.target.value) || 48)} className="mt-1 w-full bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1 text-[11px]" />
          </label>
          <label className="block text-[10px] text-ink/40">
            Stream
            <input value={stream} onChange={(e) => setStream(e.target.value)} placeholder="rss, cyber…" className="mt-1 w-full bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1 text-[11px]" />
          </label>
          <label className="block text-[10px] text-ink/40">
            Category
            <input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 w-full bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1 text-[11px]" />
          </label>
          <label className="block text-[10px] text-ink/40">
            Search
            <div className="mt-1 flex gap-1">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="title / summary" className="flex-1 bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1 text-[11px]" />
              <button type="button" onClick={() => void load()} className="border border-ink/[0.08] px-2"><Search size={12} /></button>
            </div>
          </label>
          <label className="block text-[10px] text-ink/40">
            Keyword facet
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className="mt-1 w-full bg-[#0a0a0f] border border-ink/[0.08] px-2 py-1 text-[11px]" />
          </label>

          {facets && (
            <div className="space-y-2 pt-2 border-t border-ink/[0.06]">
              <div className="text-[10px] uppercase text-ink/35">Top keywords</div>
              <div className="flex flex-wrap gap-1">
                {facets.keywords.slice(0, 12).map((f) => facetChip(f.term, f.count, () => setKeyword(f.term)))}
              </div>
              <div className="text-[10px] uppercase text-ink/35">Entities</div>
              <div className="flex flex-wrap gap-1">
                {facets.entities.slice(0, 10).map((f) => facetChip(f.term, f.count, () => setQ(f.term)))}
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-ink/40">
            <span>{stats?.total ?? items.length} items in window</span>
            <span>·</span>
            <span>{selected.size} selected</span>
            <button type="button" disabled={busy} onClick={() => void runExpand(false)} className="ml-auto border border-ink/[0.08] px-2 py-1 text-ink/55 hover:text-ink/75 flex items-center gap-1">
              <Sparkles size={11} /> Seed targets
            </button>
            <button type="button" disabled={busy} onClick={() => void runExpand(true)} className="border border-emerald-500/30 bg-emerald-500/[0.08] px-2 py-1 text-emerald-400/80 flex items-center gap-1">
              <Play size={11} /> Seed + enqueue Cascades
            </button>
          </div>
          {expandResult && <div className="text-[11px] text-sky-400/80 border border-sky-500/20 bg-sky-500/[0.06] px-3 py-2">{expandResult}</div>}

          <div className="border border-ink/[0.06] overflow-auto max-h-[32rem]">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-[#06060A]">
                <tr className="text-ink/40 text-left border-b border-ink/[0.06]">
                  <th className="py-2 px-2 w-8" />
                  <th className="py-2 pr-2">Title</th>
                  <th className="py-2 pr-2">Stream</th>
                  <th className="py-2 pr-2">Keywords</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const kw = item.payload?.enrichment?.keywords || [];
                  const isSel = selected.has(item.id);
                  return (
                    <tr key={item.id} className={cn('border-b border-ink/[0.04] text-ink/65', isSel && 'bg-ink/[0.04]')}>
                      <td className="py-2 px-2">
                        <input type="checkbox" checked={isSel} onChange={() => toggleSelect(item.id)} />
                      </td>
                      <td className="py-2 pr-2">
                        <div className="font-medium text-ink/75">{item.title}</div>
                        <div className="text-[10px] text-ink/35 truncate max-w-md">{item.summary}</div>
                      </td>
                      <td className="py-2 pr-2 text-ink/45">{item.stream} · {item.category}</td>
                      <td className="py-2 pr-2">
                        <div className="flex flex-wrap gap-1">
                          {kw.slice(0, 5).map((k) => (
                            <span key={k} className="text-[9px] px-1 border border-ink/[0.06] text-ink/40">{k}</span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!items.length && (
                  <tr><td colSpan={4} className="py-8 text-center text-ink/35">No items — try backfill enrich or pull RSS</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
