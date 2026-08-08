import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Upload, Trash2, Play, RefreshCw, CheckSquare, Square,
  Rss, Globe, Clock, Activity, X, Plus, Filter, ChevronDown,
  Wrench, AlertTriangle, Sparkles,
} from 'lucide-react';
import { cn } from '../types';

interface FeedSource {
  id: string;
  name: string;
  feedUrl: string;
  siteUrl: string;
  category: string;
  enabled: boolean;
  autoPull: boolean;
  discoveredVia: string;
  lastCheckedAt?: string;
  lastOkAt?: string;
  lastError?: string;
  adaptiveIntervalMinutes: number;
  consecutiveNoopCount: number;
  consecutiveFailures: number;
  createdAt: string;
  // Discovery / repair fields
  discoveryStatus?: string;
  discoveredUrl?: string;
  discoveryConfidence?: number;
  discoveryMethod?: string;
  discoveredAt?: string;
  lastRepairAttemptAt?: string;
}

interface DiscoverResult {
  siteUrl: string;
  inputUrl: string;
  isDirectFeed: boolean;
  feeds: Array<{
    feedUrl: string;
    feedType: string;
    title?: string;
    itemCount: number;
    newestItemDate?: string;
    discoveredVia: string;
    score: number;
    scoreReasons: string[];
  }>;
}

interface RepairResult {
  sourceId: string;
  source: string;
  currentFeedUrl: string;
  originalUrl: string;
  siteUrl: string;
  suggestion: 'auto-repair' | 'recommend' | 'show-only' | 'none';
  autoRepairEligible: boolean;
  candidates: Array<{
    feedUrl: string;
    feedType: string;
    title?: string;
    itemCount: number;
    newestItemDate?: string;
    discoveredVia: string;
    score: number;
    scoreReasons: string[];
    isViable: boolean;
  }>;
  best?: {
    feedUrl: string;
    feedType: string;
    title?: string;
    itemCount: number;
    score: number;
    scoreReasons: string[];
  };
}

interface SourceListResponse {
  sources: FeedSource[];
  curated: Array<{ name: string; url: string; category: string }>;
  total: number;
}

function fmt(n: number | undefined | null): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function ago(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso).getTime();
  const now = Date.now();
  const m = Math.round((now - d) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function RssSourcesPanel() {
  const [data, setData] = useState<SourceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ok' | 'errored' | 'unknown'>('all');
  const [sourceFilter, setSourceFilter] = useState('');
  const [cadenceFilter, setCadenceFilter] = useState('');
  const [lastCheckFilter, setLastCheckFilter] = useState('');
  const [pullFilter, setPullFilter] = useState('');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const [importText, setImportText] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  const [packBusy, setPackBusy] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const [addName, setAddName] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addCategory, setAddCategory] = useState('osint');
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // ── Discover mode ──
  const [discoverMode, setDiscoverMode] = useState(false);
  const [discoverUrl, setDiscoverUrl] = useState('');
  const [discoverBusy, setDiscoverBusy] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  // ── Repair state ──
  const [repairBusy, setRepairBusy] = useState<string | null>(null);
  const [repairResults, setRepairResults] = useState<Map<string, RepairResult>>(new Map());
  const [repairExpanded, setRepairExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/feeds/community/sources');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const t = setInterval(() => load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const stats = useMemo(() => {
    if (!data) return null;
    const s = data.sources;
    return {
      total: s.length,
      producing: s.filter(x => x.lastOkAt && !x.lastError).length,
      errored: s.filter(x => x.lastError && x.enabled !== false).length,
      unknown: s.filter(x => !x.lastOkAt && !x.lastError).length,
      avgCadence: Math.round(s.reduce((sum, x) => sum + (x.adaptiveIntervalMinutes || 15), 0) / s.length),
    };
  }, [data]);

  const autoRetired = useRef(false);
  useEffect(() => {
    if (!data || !stats || stats.errored <= 20 || autoRetired.current) return;
    autoRetired.current = true;
    fetch('/api/retired/retire-broken-feeds', { method: 'POST' })
      .then(() => load())
      .catch(() => { autoRetired.current = false; });
  }, [data?.sources.length, stats?.errored, load]);

  const categories = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.sources.map(s => s.category));
    return Array.from(set).sort();
  }, [data]);

  const sourceGroups = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.sources.map(s => s.discoveredVia));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let rows = data.sources;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.feedUrl.toLowerCase().includes(q) ||
        s.discoveredVia.toLowerCase().includes(q)
      );
    }
    if (catFilter) rows = rows.filter(s => s.category === catFilter);
    if (sourceFilter) rows = rows.filter(s => s.discoveredVia.startsWith(sourceFilter));
    if (statusFilter === 'ok') rows = rows.filter(s => s.lastOkAt && !s.lastError);
    else if (statusFilter === 'errored') rows = rows.filter(s => s.lastError && !s.lastOkAt);
    else if (statusFilter === 'unknown') rows = rows.filter(s => !s.lastOkAt && !s.lastError);
    if (cadenceFilter === 'fast') rows = rows.filter(s => (s.adaptiveIntervalMinutes || 15) <= 15);
    else if (cadenceFilter === 'hourly') rows = rows.filter(s => { const c = (s.adaptiveIntervalMinutes || 15); return c > 15 && c <= 60; });
    else if (cadenceFilter === 'slow') rows = rows.filter(s => { const c = (s.adaptiveIntervalMinutes || 15); return c > 60 && c <= 360; });
    else if (cadenceFilter === 'daily') rows = rows.filter(s => (s.adaptiveIntervalMinutes || 15) > 360);
    if (lastCheckFilter) {
      const now = Date.now();
      const thresholds: Record<string, number> = { hour: 3600_000, today: 86400_000, week: 604800_000 };
      const limit = thresholds[lastCheckFilter];
      if (limit) rows = rows.filter(s => s.lastCheckedAt && (now - new Date(s.lastCheckedAt).getTime()) <= limit);
      else if (lastCheckFilter === 'older') rows = rows.filter(s => !s.lastCheckedAt || (now - new Date(s.lastCheckedAt).getTime()) > 604800_000);
      else if (lastCheckFilter === 'never') rows = rows.filter(s => !s.lastCheckedAt);
    }
    if (pullFilter === 'auto') rows = rows.filter(s => s.autoPull);
    else if (pullFilter === 'manual') rows = rows.filter(s => !s.autoPull);
    return rows;
  }, [data, search, catFilter, statusFilter, sourceFilter, cadenceFilter, lastCheckFilter, pullFilter]);

  const allSelected = filtered.length > 0 && selected.size >= filtered.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map(s => s.id)));
  };

  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const batchPatch = useCallback(async (patch: Record<string, unknown>, label: string) => {
    if (selected.size === 0) return;
    setBusy(label);
    let ok = 0, err = 0;
    for (const id of selected) {
      try {
        const res = await fetch(`/api/feeds/community/sources/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        if (res.ok) ok++; else err++;
      } catch { err++; }
    }
    setBusy(null);
    setImportResult(`${label}: ${ok} ok, ${err} failed`);
    setSelected(new Set());
    load();
  }, [selected, load]);

  const batchDelete = useCallback(async () => {
    if (selected.size === 0) return;
    if (selected.size <= 20 && !confirm(`Retire ${selected.size} RSS source(s)? They'll stop pulling and move to the Retired tab.`)) return;
    setBusy('deleting');
    let ok = 0, err = 0;
    for (const id of selected) {
      try {
        const res = await fetch(`/api/feeds/community/sources/${id}`, { method: 'DELETE' });
        if (res.ok) ok++; else err++;
      } catch { err++; }
    }
    setBusy(null);
    setImportResult(`Retired: ${ok} ok, ${err} failed`);
    setSelected(new Set());
    load();
  }, [selected, load]);

  const doTextImport = useCallback(async () => {
    const lines = importText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) return;
    setImportBusy(true);
    setImportResult(null);
    const parsed: Array<{ name: string; feed_url: string; category: string }> = [];
    for (const line of lines) {
      if (line.startsWith('#') || line.startsWith('//')) continue;
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 2) {
        parsed.push({ name: parts[0], feed_url: parts[1], category: parts[2] || 'osint' });
      } else if (parts[0].startsWith('http')) {
        parsed.push({ name: '', feed_url: parts[0], category: 'osint' });
      }
    }
    let registered = 0, errors = 0;
    for (const item of parsed) {
      try {
        const res = await fetch('/api/feeds/community/sources', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: item.name || item.feed_url.split('/')[2] || item.feed_url,
            feed_url: item.feed_url,
            category: item.category,
            auto_pull: true,
          }),
        });
        if (res.ok) registered++; else errors++;
      } catch { errors++; }
    }
    setImportBusy(false);
    setImportResult(`Imported ${registered} from ${parsed.length} lines (${errors} errors)`);
    setImportText('');
    setShowImport(false);
    load();
  }, [importText, load]);

  const doAddFeed = useCallback(async () => {
    if (!addUrl.trim().startsWith('http')) {
      setAddError('Please enter a valid URL starting with http:// or https://');
      return;
    }
    setAddBusy(true);
    setAddError(null);
    try {
      const res = await fetch('/api/feeds/community/sources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addName.trim() || new URL(addUrl).hostname,
          feed_url: addUrl.trim(),
          category: addCategory || 'osint',
          auto_pull: true,
          enabled: true,
          adaptive_interval_minutes: 15,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.id) {
        setAddName('');
        setAddUrl('');
        setAddCategory('osint');
        setShowAdd(false);
        setImportResult(`Added: ${addName || addUrl}`);
        load();
      } else {
        setAddError(body?.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setAddError((e as Error).message);
    } finally {
      setAddBusy(false);
    }
  }, [addName, addUrl, addCategory, load]);

  const importPack = useCallback(async (pack: string) => {
    setPackBusy(pack);
    setImportResult(null);
    try {
      const res = await fetch('/api/feeds/community/sources/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack }),
      });
      const d = await res.json();
      setImportResult(`"${pack}": ${d.imported} sources imported`);
      load();
    } catch (e) {
      setImportResult(`"${pack}" error: ${(e as Error).message}`);
    } finally { setPackBusy(null); }
  }, [load]);

  const pullOne = useCallback(async (id: string) => {
    setBusy(`pull-${id}`);
    try { await fetch(`/api/feeds/community/sources/${id}/pull`, { method: 'POST' }); } catch {}
    setBusy(null);
    load();
  }, [load]);

  // ── Discover ──
  const doDiscover = useCallback(async () => {
    if (!discoverUrl.trim()) return;
    setDiscoverBusy(true);
    setDiscoverResult(null);
    setDiscoverError(null);
    try {
      const res = await fetch('/api/feeds/community/sources/discover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: discoverUrl.trim() }),
      });
      const d = await res.json();
      if (res.ok) {
        setDiscoverResult(d);
      } else {
        setDiscoverError(d.error || 'Discovery failed');
      }
    } catch (e) {
      setDiscoverError((e as Error).message);
    } finally { setDiscoverBusy(false); }
  }, [discoverUrl]);

  const importDiscovered = useCallback(async (feed: DiscoverResult['feeds'][0], siteUrl: string, inputUrl: string) => {
    try {
      const res = await fetch('/api/feeds/community/sources', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: feed.title || new URL(feed.feedUrl).hostname,
          feed_url: feed.feedUrl,
          site_url: siteUrl || new URL(feed.feedUrl).origin,
          category: 'osint',
          auto_pull: true,
          discovered_via: `discover:${feed.discoveredVia}`,
        }),
      });
      if (res.ok) {
        setImportResult(`Added: ${feed.title || feed.feedUrl}`);
        load();
      }
    } catch (e) {
      setImportResult(`Error: ${(e as Error).message}`);
    }
  }, [load]);

  // ── Repair ──
  const repairSource = useCallback(async (id: string) => {
    setRepairBusy(id);
    try {
      const res = await fetch(`/api/feeds/community/sources/${id}/repair`, { method: 'POST' });
      const result = await res.json();
      if (res.ok) {
        setRepairResults((prev) => {
          const next = new Map(prev);
          next.set(id, result);
          return next;
        });
        setRepairExpanded((prev) => {
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }
    } catch (e) {
      setImportResult(`Repair error: ${(e as Error).message}`);
    } finally { setRepairBusy(null); }
  }, []);

  const acceptRepair = useCallback(async (id: string, newUrl: string, reason: string) => {
    try {
      const res = await fetch(`/api/feeds/community/sources/${id}/accept-repair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl, reason }),
      });
      if (res.ok) {
        setRepairResults((prev) => {
          const next = new Map(prev);
          next.delete(id);
          return next;
        });
        setImportResult(`Repaired: ${newUrl}`);
        load();
      }
    } catch (e) {
      setImportResult(`Repair error: ${(e as Error).message}`);
    }
  }, [load]);

  const ignoreRepair = useCallback((id: string) => {
    setRepairResults((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setRepairExpanded((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  if (loading && !data) return <div className="p-8 text-center text-[12px] text-ink/40">Loading RSS sources...</div>;
  if (error) return (
    <div className="border border-ink/[0.08] bg-ink/[0.02] p-8 text-center space-y-3">
      <p className="text-[13px] text-rose-400/80">{error}</p>
      <button onClick={load} className="px-3 py-1.5 border border-ink/[0.12] text-[11px] text-ink/70">Retry</button>
    </div>
  );
  if (!data) return null;

  return (
    <section className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold tracking-wide text-ink/75">
            <Rss size={14} className="inline mr-2 -mt-0.5" />
            RSS Sources
          </div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-ink/35">
            {fmt(stats?.total)} registered · {fmt(stats?.producing)} producing · avg cadence {stats?.avgCadence}m
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => { setShowAdd(true); setAddName(''); setAddUrl(''); setAddCategory('osint'); setAddError(null); setDiscoverMode(false); }}
            className="flex items-center gap-1 px-2.5 py-1.5 border border-ink/[0.10] text-[10px] text-ink/55 hover:text-ink/75">
            <Plus size={10} /> Add Feed
          </button>
          <button onClick={() => { setShowAdd(true); setDiscoverMode(true); setDiscoverUrl(''); setDiscoverResult(null); setDiscoverError(null); }}
            className="flex items-center gap-1 px-2.5 py-1.5 border border-emerald-400/[0.12] text-[10px] text-emerald-400/55 hover:text-emerald-400/75">
            <Sparkles size={10} /> Discover
          </button>
          <button onClick={() => { setShowImport(true); setImportText(''); }}
            className="flex items-center gap-1 px-2.5 py-1.5 border border-ink/[0.10] text-[10px] text-ink/55 hover:text-ink/75">
            <Upload size={10} /> Import
          </button>
          <button onClick={load}
            className="flex items-center gap-1 px-2.5 py-1.5 border border-ink/[0.08] text-ink/45 hover:text-ink/65 text-[10px]">
            <RefreshCw size={10} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-5 gap-2">
          {[
            { label: 'Total', v: stats.total, cls: 'text-ink/70' },
            { label: 'Producing', v: stats.producing, cls: 'text-emerald-400/60' },
            { label: 'Errored', v: stats.errored, cls: 'text-rose-400/60' },
            { label: 'Unknown', v: stats.unknown, cls: 'text-ink/30' },
            { label: 'Avg Cadence', v: `${stats.avgCadence}m`, cls: 'text-sky-400/50' },
          ].map(c => (
            <div key={c.label} className="border border-ink/[0.05] px-3 py-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-ink/30">{c.label}</span>
              <span className={cn('text-sm font-mono', c.cls)}>{c.v}</span>
            </div>
          ))}
        </div>
      )}

      {/* Import panel */}
      {showImport && (
        <div className="border border-sky-400/[0.12] bg-sky-400/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-sky-400/50">Import RSS Feeds</span>
            <button onClick={() => setShowImport(false)} className="text-ink/25 hover:text-ink/50"><X size={12} /></button>
          </div>

          {/* Text file / bulk paste */}
          <div>
            <div className="text-[9px] uppercase text-ink/30 mb-1">Paste URLs (one per line, or name | url | category)</div>
            <textarea
              value={importText}
              onChange={e => setImportText(e.target.value)}
              placeholder="BBC World | https://feeds.bbci.co.uk/news/world/rss.xml | geopolitics&#10;https://www.securityweek.com/feed/&#10;# comment lines start with #"
              className="w-full bg-noir-bg border border-ink/[0.08] px-3 py-2 text-[11px] text-ink/70 font-mono resize-y min-h-[6rem]"
              rows={5}
            />
            <div className="flex items-center justify-between mt-1.5">
              <button onClick={doTextImport} disabled={importBusy || !importText.trim()}
                className="px-3 py-1.5 bg-ink/[0.08] border border-ink/[0.12] text-[10px] text-ink/70 hover:bg-ink/[0.12] disabled:opacity-30">
                {importBusy ? 'Importing...' : `Import ${importText.trim() ? importText.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).length : 0} URLs`}
              </button>
              <div className="flex items-center gap-2">
                <label className="px-2 py-1.5 border border-ink/[0.10] text-[10px] text-ink/50 hover:text-ink/70 cursor-pointer">
                  <Upload size={10} className="inline mr-1" />
                  Upload File
                  <input type="file" accept=".txt,.json,.csv" className="hidden" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      const content = ev.target?.result as string;
                      if (file.name.endsWith('.json')) {
                        try {
                          const j = JSON.parse(content);
                          const items = Array.isArray(j) ? j : (j.sources || j.feeds || j.disabledFeeds || []);
                          setImportText(items.map((i: any) => `${i.name || i.title || ''} | ${i.feed_url || i.feedUrl || i.url || ''} | ${i.category || 'osint'}`).join('\n'));
                        } catch { setImportText(content); }
                      } else {
                        setImportText(content);
                      }
                    };
                    reader.readAsText(file);
                    e.target.value = '';
                  }} />
                </label>
                <span className="text-[9px] text-ink/25">Format: name | url | category (category optional, defaults to osint)</span>
              </div>
            </div>
          </div>

          <div className="border-t border-ink/[0.04] pt-3">
            <div className="text-[9px] uppercase text-ink/30 mb-2">Or import a pre-built pack</div>
            <div className="flex gap-2">
              {[
                { id: 'crucix', label: 'Crucix (5 feeds)', desc: 'SBS, Indian Express, MercoPress, Al Jazeera' },
                { id: 'worldmonitor', label: 'World Monitor (225)', desc: 'AGPL open-source catalog' },
                { id: 'legal', label: 'Legal RSS (59)', desc: 'JD Supra, L&S, Cornell LII, courts' },
                { id: 'crucix-full', label: 'Crucix Full (29 sources)', desc: '27 OSINT APIs: GDELT, FIRMS, AIS, OFAC, FRED, EIA, NOAA, WHO, CISA...' },
                { id: 'freshrss', label: 'FreshRSS Scraping (17)', desc: 'XPath-based scraping for sites w/o RSS' },
              ].map(p => (
                <button key={p.id}
                  disabled={!!packBusy}
                  onClick={() => importPack(p.id)}
                  title={p.desc}
                  className="flex-1 px-3 py-2 border border-ink/[0.08] text-[10px] text-ink/50 hover:text-ink/75 hover:border-ink/[0.15] disabled:opacity-30 text-left">
                  <div className="text-ink/60">{p.label}</div>
                  <div className="text-ink/25 text-[9px] mt-0.5">{p.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {importResult && (
            <div className="text-[11px] text-ink/50 bg-ink/[0.04] px-3 py-1.5">{importResult}</div>
          )}
        </div>
      )}

      {/* Add Feed form */}
      {showAdd && !discoverMode && (
        <div className="border border-emerald-400/[0.12] bg-emerald-400/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-emerald-400/50">Add RSS Feed</span>
            <button onClick={() => setShowAdd(false)} className="text-ink/25 hover:text-ink/50"><X size={12} /></button>
          </div>
          <div className="flex flex-col gap-2">
            <input
              value={addUrl}
              onChange={e => setAddUrl(e.target.value)}
              placeholder="https://example.com/rss-feed.xml"
              className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/70 font-mono w-full"
              onKeyDown={e => e.key === 'Enter' && doAddFeed()}
            />
            <div className="flex gap-2">
              <input
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder="Feed name (auto from URL if blank)"
                className="flex-1 bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/70"
              />
              <input
                value={addCategory}
                onChange={e => setAddCategory(e.target.value)}
                placeholder="Category (default: osint)"
                className="w-32 bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/70"
              />
              <button onClick={doAddFeed} disabled={addBusy || !addUrl.trim()}
                className="px-4 py-1.5 bg-emerald-400/[0.10] border border-emerald-400/[0.20] text-[10px] text-emerald-400/75 hover:bg-emerald-400/[0.15] disabled:opacity-30 whitespace-nowrap">
                {addBusy ? 'Saving...' : 'Add Feed'}
              </button>
            </div>
          </div>
          {addError && <div className="text-[10px] text-rose-400/60">{addError}</div>}
          {importResult && <div className="text-[10px] text-emerald-400/50">{importResult}</div>}
        </div>
      )}

      {/* Discover feeds panel */}
      {showAdd && discoverMode && (
        <div className="border border-sky-400/[0.12] bg-sky-400/[0.02] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-sky-400/50">
              <Sparkles size={10} className="inline mr-1" />Discover Feeds
            </span>
            <button onClick={() => setShowAdd(false)} className="text-ink/25 hover:text-ink/50"><X size={12} /></button>
          </div>
          <div className="text-[10px] text-ink/35">Enter a website URL to auto-discover its RSS feeds</div>
          <div className="flex gap-2">
            <input
              value={discoverUrl}
              onChange={e => setDiscoverUrl(e.target.value)}
              placeholder="https://some-news-site.com"
              className="flex-1 bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/70 font-mono"
              onKeyDown={e => e.key === 'Enter' && doDiscover()}
            />
            <button onClick={doDiscover} disabled={discoverBusy || !discoverUrl.trim()}
              className="px-4 py-1.5 bg-sky-400/[0.10] border border-sky-400/[0.20] text-[10px] text-sky-400/75 hover:bg-sky-400/[0.15] disabled:opacity-30 whitespace-nowrap">
              {discoverBusy ? 'Discovering...' : 'Discover'}
            </button>
          </div>
          {discoverError && <div className="text-[10px] text-rose-400/60">{discoverError}</div>}
          {discoverResult && discoverResult.feeds.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] text-sky-400/50">
                Found {discoverResult.feeds.length} feed{discoverResult.feeds.length > 1 ? 's' : ''}
                {discoverResult.isDirectFeed ? ' (direct feed)' : ` on ${discoverResult.siteUrl}`}
              </div>
              <div className="space-y-1.5">
                {discoverResult.feeds.map((feed, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 border border-ink/[0.06] bg-noir-bg">
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-ink/65 truncate">{(feed as any).title || feed.feedUrl}</div>
                      <div className="flex items-center gap-2 text-[9px] text-ink/30 mt-0.5">
                        <span className="uppercase">{feed.feedType}</span>
                        {feed.itemCount > 0 && <span>{feed.itemCount} items</span>}
                        <span>via {feed.discoveredVia}</span>
                        <span className="text-sky-400/40">score {feed.score}</span>
                      </div>
                    </div>
                    <button onClick={() => importDiscovered(feed, discoverResult.siteUrl, discoverResult.inputUrl)}
                      className="ml-2 px-3 py-1 bg-emerald-400/[0.08] border border-emerald-400/[0.15] text-[10px] text-emerald-400/70 hover:bg-emerald-400/[0.12] whitespace-nowrap">
                      {discoverResult.isDirectFeed ? 'Add Feed' : `✓ Add this feed${i > 0 ? ' ' + (i + 1) : ''}`}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {discoverResult && discoverResult.feeds.length === 0 && !discoverError && (
            <div className="text-[10px] text-ink/30 py-2">No feeds discovered for this URL</div>
          )}
        </div>
      )}

      {/* Search + filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink/20" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter by name, URL, or source..."
              className="w-full bg-noir-bg border border-ink/[0.08] pl-7 pr-3 py-1.5 text-[11px] text-ink/70"
            />
          </div>
          <button onClick={() => setShowFilters(!showFilters)}
            className={cn('flex items-center gap-1 px-2.5 py-1.5 border text-[10px]',
              showFilters ? 'border-ink/[0.15] text-ink/70' : 'border-ink/[0.08] text-ink/35 hover:text-ink/55')}>
            <Filter size={10} /> Filters <ChevronDown size={8} className={cn(showFilters && 'rotate-180')} />
          </button>
        </div>

        {showFilters && (
          <div className="flex gap-2 flex-wrap items-center">
            <select value={catFilter} onChange={e => setCatFilter(e.target.value)}
              className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/60 min-w-[8rem]">
              <option value="">All categories</option>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
              className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/60 min-w-[8rem]">
              <option value="">All sources</option>
              {sourceGroups.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
              className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/60 min-w-[6rem]">
              <option value="all">Status: All</option>
              <option value="ok">✓ OK</option>
              <option value="errored">✕ Errors</option>
              <option value="unknown">— Unknown</option>
            </select>
            <select value={cadenceFilter} onChange={e => setCadenceFilter(e.target.value)}
              className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/60 min-w-[7rem]">
              <option value="">Cadence: All</option>
              <option value="fast">≤ 15m</option>
              <option value="hourly">15m – 1h</option>
              <option value="slow">1h – 6h</option>
              <option value="daily">{'>'} 6h</option>
            </select>
            <select value={lastCheckFilter} onChange={e => setLastCheckFilter(e.target.value)}
              className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/60 min-w-[8rem]">
              <option value="">Last Check: All</option>
              <option value="hour">Last hour</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="older">Older</option>
              <option value="never">Never</option>
            </select>
            <select value={pullFilter} onChange={e => setPullFilter(e.target.value)}
              className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[11px] text-ink/60 min-w-[6rem]">
              <option value="">Pull: All</option>
              <option value="auto">Auto</option>
              <option value="manual">Manual</option>
            </select>
            <button onClick={() => { setSearch(''); setCatFilter(''); setStatusFilter('all'); setSourceFilter(''); setCadenceFilter(''); setLastCheckFilter(''); setPullFilter(''); }}
              className="text-[10px] text-ink/25 hover:text-ink/50">Reset filters</button>
          </div>
        )}

        {/* Batch toolbar */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 px-2 py-1 border border-sky-400/[0.15] bg-sky-400/[0.03]">
            <span className="text-[10px] text-sky-400/60 font-medium">{selected.size} selected</span>
            <span className="w-px h-4 bg-ink/[0.06]" />
            <button onClick={() => batchPatch({ enabled: true }, 'Enable')} disabled={!!busy}
              className="px-2 py-0.5 border border-emerald-400/[0.12] text-[10px] text-emerald-400/60 hover:text-emerald-400/80">
              Enable
            </button>
            <button onClick={() => batchPatch({ enabled: false }, 'Disable')} disabled={!!busy}
              className="px-2 py-0.5 border border-amber-400/[0.12] text-[10px] text-amber-400/60 hover:text-amber-400/80">
              Disable
            </button>
            <button onClick={batchDelete} disabled={!!busy}
              className="px-2 py-0.5 border border-rose-400/[0.12] text-[10px] text-rose-400/60 hover:text-rose-400/80">
              Retire
            </button>
            <button onClick={() => setSelected(new Set())}
              className="ml-auto text-[10px] text-ink/25 hover:text-ink/50">Clear selection</button>
          </div>
        )}
      </div>

      {/* Results count */}
      <div className="text-[10px] uppercase tracking-wider text-ink/30">
        {filtered.length} of {data.total} sources
        {(search || catFilter || statusFilter !== 'all' || sourceFilter || cadenceFilter || lastCheckFilter || pullFilter) && ` (filtered)`}
      </div>

      {/* Table */}
      <div className="border border-ink/[0.06] overflow-hidden">
        <div className="grid grid-cols-[2rem_2fr_3fr_6rem_6rem_5rem_5rem] gap-1 px-2 py-2 border-b border-ink/[0.06] bg-ink/[0.015] text-[10px] uppercase tracking-wider text-ink/35">
          <button onClick={toggleAll} className="flex items-center justify-center" title={allSelected ? 'Deselect all' : 'Select all'}>
            {allSelected ? <CheckSquare size={13} className="text-sky-400/60" /> :
             someSelected ? <Square size={13} className="text-sky-400/30" /> :
             <Square size={13} className="text-ink/12" />}
          </button>
          <span>Name</span>
          <span>Feed URL</span>
          <span className="text-right">Cadence</span>
          <span className="text-right">Status</span>
          <span className="text-right">Last Check</span>
          <span className="text-right">Pull</span>
        </div>

        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto divide-y divide-ink/[0.03]">
          {filtered.map(s => {
            const isSelected = selected.has(s.id);
            const isBusy = busy === `pull-${s.id}`;
            const cadence = s.adaptiveIntervalMinutes || 15;
            const cadenceColor = cadence <= 30 ? 'text-emerald-400/50' :
                                 cadence <= 120 ? 'text-amber-400/50' : 'text-ink/20';

            return (
              <React.Fragment key={s.id}>
                <div
                  className={cn(
                    'grid grid-cols-[2rem_2fr_3fr_6rem_6rem_5rem_5rem] gap-1 px-2 py-1.5 text-[11px]',
                    'hover:bg-ink/[0.015] transition-colors',
                    isSelected && 'bg-sky-400/[0.04]',
                  )}>
                  <button onClick={() => toggleOne(s.id)} className="flex items-center justify-center">
                    {isSelected
                      ? <CheckSquare size={13} className="text-sky-400/60" />
                      : <Square size={13} className="text-ink/10 hover:text-ink/20" />}
                  </button>

                  <div className="truncate">
                    <span className={cn('text-ink/60', !s.enabled && 'line-through text-ink/25')}>{s.name}</span>
                    <span className="ml-1.5 text-[9px] opacity-40">{s.category}</span>
                  </div>

                  <span className="text-ink/25 font-mono text-[10px] truncate" title={s.feedUrl}>
                    {s.feedUrl}
                  </span>

                  <span className={cn('text-right font-mono text-[10px]', cadenceColor)}>
                    {cadence}m
                    {s.consecutiveNoopCount > 0 && <span className="ml-1 text-ink/15">/ {s.consecutiveNoopCount}</span>}
                  </span>

                  <span className={cn('text-right text-[10px]',
                    s.lastOkAt && !s.lastError ? 'text-emerald-400/50' :
                    s.lastError ? 'text-rose-400/50' : 'text-ink/20')}>
                    {s.lastOkAt && !s.lastError ? 'OK' :
                     s.lastError ? 'Error' : '—'}
                  </span>

                  <span className="text-right text-ink/20 font-mono text-[10px]">
                    {ago(s.lastCheckedAt)}
                  </span>

                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => pullOne(s.id)} disabled={!!isBusy}
                      className="p-0.5 text-ink/15 hover:text-sky-400/50 disabled:opacity-20" title="Pull now">
                      {isBusy ? <Activity size={10} className="animate-pulse" /> : <Play size={10} />}
                    </button>
                    {s.lastError && s.enabled !== false && (
                      <button onClick={() => repairSource(s.id)} disabled={repairBusy === s.id}
                        className="p-0.5 text-ink/10 hover:text-amber-400/50 disabled:opacity-20" title="Repair — find alternative feed URL">
                        {repairBusy === s.id ? <Activity size={10} className="animate-pulse" /> : <Wrench size={10} />}
                      </button>
                    )}
                    <button onClick={() => {
                      if (confirm(`Retire "${s.name}"? It'll stop pulling and move to the Retired tab.`)) {
                        fetch(`/api/feeds/community/sources/${s.id}`, { method: 'DELETE' }).then(() => load());
                      }
                    }}
                      className="p-0.5 text-ink/10 hover:text-rose-400/50" title="Retire">
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
                {(() => {
                  const rr = repairResults.get(s.id);
                  if (!rr || rr.suggestion === 'none' || !rr.best) return null;
                  return (
                    <div className={cn('px-3 py-3 border-t',
                      rr.suggestion === 'auto-repair' ? 'border-emerald-400/[0.12] bg-emerald-400/[0.02]' :
                      rr.suggestion === 'recommend' ? 'border-sky-400/[0.12] bg-sky-400/[0.02]' :
                      'border-amber-400/[0.08] bg-amber-400/[0.01]')}>
                      <div className="flex items-start justify-between">
                        <div className="space-y-1.5 flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn('text-[10px] uppercase tracking-wider font-medium',
                              rr.suggestion === 'auto-repair' ? 'text-emerald-400/60' :
                              rr.suggestion === 'recommend' ? 'text-sky-400/60' : 'text-amber-400/60')}>
                              {rr.suggestion === 'auto-repair' ? 'Auto-Repair Eligible' :
                               rr.suggestion === 'recommend' ? 'Recommended Replacement' : 'Candidate Found'}
                            </span>
                            <span className="text-[9px] text-ink/25">score {rr.best.score}/100</span>
                          </div>
                          <div className="text-[10px] text-ink/35">
                            Current: <span className="line-through text-ink/20">{rr.currentFeedUrl}</span>
                          </div>
                          <div className="text-[11px] text-ink/60 font-mono truncate">
                            Suggested: <span className="text-emerald-400/60">{rr.best.feedUrl}</span>
                          </div>
                          <div className="flex items-center gap-2 text-[9px] text-ink/30">
                            <span className="uppercase">{rr.best.feedType}</span>
                            <span>{rr.best.itemCount} items</span>
                            <span>via {rr.best.discoveredVia}</span>
                            {rr.best.scoreReasons?.map((r, i) => (
                              <span key={i} className="text-ink/20">+ {r}</span>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 ml-3 shrink-0">
                          <button onClick={() => acceptRepair(s.id, rr.best!.feedUrl, `repair: ${rr.suggestion}`)}
                            className="px-3 py-1.5 bg-emerald-400/[0.10] border border-emerald-400/[0.20] text-[10px] text-emerald-400/75 hover:bg-emerald-400/[0.15] whitespace-nowrap">
                            Replace URL
                          </button>
                          <button onClick={() => ignoreRepair(s.id)}
                            className="px-3 py-1.5 border border-ink/[0.08] text-[10px] text-ink/35 hover:text-ink/55 whitespace-nowrap">
                            Ignore
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </React.Fragment>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-16 text-center text-[12px] text-ink/20 space-y-1">
              <p>No feeds match your filters</p>
              <p className="text-[10px] text-ink/15">
                {data.sources.length ? 'Try adjusting search or filters' : 'Import feeds to get started'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Curated feeds */}
      <details className="border border-ink/[0.04] overflow-hidden">
        <summary className="px-3 py-2 text-[10px] uppercase tracking-wider text-ink/25 cursor-pointer hover:text-ink/45 select-none">
          {data.curated.length} curated always-on feeds (pulled at base 15m cadence)
        </summary>
        <div className="divide-y divide-ink/[0.02] max-h-[24rem] overflow-y-auto">
          {data.curated.map(f => (
            <div key={f.url} className="grid grid-cols-[2fr_3fr_6rem] gap-2 px-3 py-1.5 text-[10px]">
              <span className="text-ink/35 truncate">{f.name}</span>
              <span className="text-ink/20 font-mono truncate">{f.url}</span>
              <span className="text-ink/15">{f.category}</span>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}
