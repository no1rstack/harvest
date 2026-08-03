import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Settings, RefreshCw, Play } from 'lucide-react';

type AnyObject = Record<string, unknown>;

export const PlatformPanel: React.FC = () => {
  const [config, setConfig] = useState<AnyObject | null>(null);
  const [status, setStatus] = useState<AnyObject | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, configRes] = await Promise.all([
        fetch('/api/harvest/platform/status'),
        fetch('/api/harvest/platform/config'),
      ]);
      if (!statusRes.ok) throw new Error(`status ${statusRes.status}`);
      if (!configRes.ok) throw new Error(`config ${configRes.status}`);
      setStatus(await statusRes.json());
      const cfg = await configRes.json();
      setConfig(cfg.config || cfg);
    } catch (e: any) {
      setError(e.message);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveConfig = async () => {
    if (!config) return;
    setBusy('save');
    try {
      await fetch('/api/harvest/platform/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Collection-Token': 'harvest-internal' },
        body: JSON.stringify({ config }),
      });
      await load();
    } catch (e: any) { setError(e.message); }
    setBusy(null);
  };

  const patch = (path: string[], value: unknown) => {
    if (!config) return;
    const next = { ...config };
    let obj: AnyObject = next;
    for (let i = 0; i < path.length - 1; i++) {
      if (!obj[path[i]]) obj[path[i]] = {};
      const v = obj[path[i]];
      if (typeof v !== 'object' || v === null) return;
      obj[path[i]] = { ...v };
      obj = obj[path[i]] as AnyObject;
    }
    obj[path[path.length - 1]] = value;
    setConfig(next);
  };

  const runJob = async (kind: string) => {
    setBusy(kind);
    try {
      await fetch(`/api/harvest/platform/run/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Collection-Token': 'harvest-internal' },
      });
      await load();
    } catch (e: any) { setError(e.message); }
    setBusy(null);
  };

  if (loading) return <div className="p-4 text-[12px] text-ink/40">Loading platform config…</div>;

  return (
    <div className="h-full overflow-auto">
      <div className="p-3 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Settings size={14} className="text-ink/40"/>
            <span className="text-[10px] uppercase tracking-wider text-ink/40">Platform — schedulers, feeds, Judicium integration</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="text-[10px] text-ink/35 hover:text-ink/60"><RefreshCw size={11} className="inline"/> Refresh</button>
            <button onClick={saveConfig} disabled={!!busy}
              className="px-3 py-1 border border-ink/[0.12] text-[11px] text-ink/70 hover:text-ink/90 disabled:opacity-30">
              {busy === 'save' ? 'Saving…' : 'Save config'}
            </button>
          </div>
        </div>

        {error && <div className="flex items-start gap-2 p-2 border border-amber-400/20 bg-amber-400/[0.05] text-amber-200/70 text-[11px]"><AlertTriangle size={13} className="mt-0.5 shrink-0"/>{error}</div>}

        {!config ? (
          <div className="text-[12px] text-ink/40 p-4">No platform config loaded</div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {/* Collection Scheduler */}
            <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-ink/45">Collection Scheduler</div>

              <label className="flex items-center gap-2 text-[11px] text-ink/60">
                <input type="checkbox" checked={!!(config.scheduler as AnyObject)?.enabled}
                  onChange={e => patch(['scheduler', 'enabled'], e.target.checked)} />
                Scheduler enabled
              </label>

              <label className="flex items-center gap-2 text-[11px] text-ink/60">
                <input type="checkbox" checked={!!((config.scheduler as AnyObject)?.cascadesDuePull as AnyObject)?.enabled}
                  onChange={e => patch(['scheduler', 'cascadesDuePull', 'enabled'], e.target.checked)} />
                Cascades due pull (passive-domain-collection)
              </label>

              <div className="flex items-center gap-2 text-[11px] text-ink/55 ml-6">
                <span>Due interval (min)</span>
                <input type="number" min={5}
                  className="w-20 bg-noir-bg border border-ink/[0.08] px-2 py-1 font-mono text-ink/60"
                  value={((config.scheduler as AnyObject)?.cascadesDuePull as AnyObject)?.intervalMinutes ?? 60}
                  onChange={e => patch(['scheduler', 'cascadesDuePull', 'intervalMinutes'], Number(e.target.value))} />
              </div>

              <label className="flex items-center gap-2 text-[11px] text-ink/60">
                <input type="checkbox" checked={!!((config.scheduler as AnyObject)?.dailyPull as AnyObject)?.enabled}
                  onChange={e => patch(['scheduler', 'dailyPull', 'enabled'], e.target.checked)} />
                Daily pull cycle
              </label>

              <select className="bg-noir-bg border border-ink/[0.08] px-2 py-1 text-[11px] text-ink/55 ml-6"
                value={((config.scheduler as AnyObject)?.dailyPull as AnyObject)?.mode ?? 'cascades-due'}
                onChange={e => patch(['scheduler', 'dailyPull', 'mode'], e.target.value)}>
                <option value="cascades-due">Cascades due (in-process)</option>
                <option value="shell">Shell daily-pull.sh</option>
                <option value="both">Both</option>
                <option value="disabled">Disabled</option>
              </select>

              <div className="flex flex-wrap gap-2 pt-2">
                {['cascades-due', 'daily-pull'].map(kind => (
                  <button key={kind} disabled={!!busy} onClick={() => runJob(kind)}
                    className="flex items-center gap-1 px-2 py-1 border border-ink/[0.1] text-[10px] text-ink/60 hover:text-ink/85 disabled:opacity-30">
                    <Play size={10}/> Run {kind}
                  </button>
                ))}
                <button disabled={!!busy} onClick={() => runJob('rss-pull')}
                  className="flex items-center gap-1 px-2 py-1 border border-ink/[0.1] text-[10px] text-ink/60 hover:text-ink/85 disabled:opacity-30">
                  <Play size={10}/> Run rss-pull
                </button>
              </div>
            </div>

            {/* Community Feeds */}
            <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-ink/45">Module: Community Feeds</div>
              <div className="text-[10px] text-ink/35 font-mono">community-feeds@1.2.0 · Harvest-owned</div>

              <label className="flex items-center gap-2 text-[11px] text-ink/60">
                <input type="checkbox" checked={!!((config.modules as AnyObject)?.communityFeeds as AnyObject)?.enabled}
                  onChange={e => patch(['modules', 'communityFeeds', 'enabled'], e.target.checked)} />
                Feeds worker enabled
              </label>

              <label className="flex items-center gap-2 text-[11px] text-ink/60">
                <input type="checkbox" checked={!!((config.modules as AnyObject)?.communityFeeds as AnyObject)?.delegateFromJudicium}
                  onChange={e => patch(['modules', 'communityFeeds', 'delegateFromJudicium'], e.target.checked)} />
                Judicium delegates community pull to Harvest
              </label>

              <label className="flex items-center gap-2 text-[11px] text-ink/60">
                <input type="checkbox" checked={((config.modules as AnyObject)?.communityFeeds as AnyObject)?.enrichment?.autoOnIngest !== false}
                  onChange={e => patch(['modules', 'communityFeeds', 'enrichment', 'autoOnIngest'], e.target.checked)} />
                Enrich keywords on ingest
              </label>

              <label className="flex items-center gap-2 text-[11px] text-ink/60">
                <input type="checkbox" checked={((config.modules as AnyObject)?.communityFeeds as AnyObject)?.expansion?.enabled !== false}
                  onChange={e => patch(['modules', 'communityFeeds', 'expansion', 'enabled'], e.target.checked)} />
                Keyword expansion API enabled
              </label>

              {/* RSS cadence */}
              <label className="flex items-center gap-2 text-[11px] text-ink/60">
                <input type="checkbox" checked={((config.modules as AnyObject)?.communityFeeds as AnyObject)?.rss?.adaptive !== false}
                  onChange={e => patch(['modules', 'communityFeeds', 'rss', 'adaptive'], e.target.checked)} />
                Adaptive RSS cadence
              </label>
              <div className="flex items-center gap-2 text-[11px] text-ink/55 ml-6">
                <span>Max (min)</span>
                <input type="number" min={15}
                  className="w-20 bg-noir-bg border border-ink/[0.08] px-2 py-1 font-mono text-ink/60"
                  value={((config.modules as AnyObject)?.communityFeeds as AnyObject)?.rss?.adaptiveMaxMinutes ?? 1440}
                  onChange={e => patch(['modules', 'communityFeeds', 'rss', 'adaptiveMaxMinutes'], Number(e.target.value))} />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-ink/55 ml-6">
                <span>No-op threshold</span>
                <input type="number" min={1}
                  className="w-20 bg-noir-bg border border-ink/[0.08] px-2 py-1 font-mono text-ink/60"
                  value={((config.modules as AnyObject)?.communityFeeds as AnyObject)?.rss?.adaptiveNoopThreshold ?? 3}
                  onChange={e => patch(['modules', 'communityFeeds', 'rss', 'adaptiveNoopThreshold'], Number(e.target.value))} />
              </div>
            </div>

            {/* Judicium Integration */}
            <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-ink/45">Judicium Integration</div>
              <div className="text-[11px] text-ink/50 font-mono">postFindingsToJudicium: {config.postFindingsToJudicium === false ? 'OFF' : 'ON'}</div>
              <div className="text-[10px] text-ink/30 font-mono truncate">URL: {config.judiciumUrl || '(using env)'}</div>
              {Object.entries(config.judicium as AnyObject ?? {}).map(([k, v]) => (
                <div key={k} className="text-[10px] text-ink/30 font-mono">{k}: {v === undefined ? '(not set)' : typeof v === 'boolean' ? String(v) : String(v ?? '—')}</div>
              ))}
            </div>

            {/* Scheduler Status */}
            {status && (
              <div className="border border-ink/[0.05] bg-ink/[0.015] p-4 space-y-3">
                <div className="text-[10px] uppercase tracking-wider text-ink/45">Scheduler Status</div>
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div className="text-ink/30">Running</div>
                  <div className={status?.scheduler?.running ? 'text-emerald-400/60' : 'text-ink/20'}>{(status as any)?.scheduler?.running ? 'Yes' : 'No'}</div>
                  <div className="text-ink/30">Started</div>
                  <div className="text-ink/40">{(status as any)?.scheduler?.startedAt ? new Date((status as any).scheduler.startedAt).toLocaleString() : '—'}</div>
                  <div className="text-ink/30">Last cascades-due</div>
                  <div className="text-ink/40">{(status as any)?.scheduler?.lastRuns?.cascadesDue ? new Date((status as any).scheduler.lastRuns.cascadesDue).toLocaleString() : '—'}</div>
                  <div className="text-ink/30">Last daily</div>
                  <div className="text-ink/40">{(status as any)?.scheduler?.lastRuns?.daily ? new Date((status as any).scheduler.lastRuns.daily).toLocaleString() : '—'}</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Env Overrides */}
        {config && (
          <details className="border border-ink/[0.04] overflow-hidden">
            <summary className="px-3 py-2 text-[10px] uppercase tracking-wider text-ink/25 cursor-pointer hover:text-ink/45 select-none">
              Environment overrides
            </summary>
            <div className="px-3 py-2 text-[10px] font-mono text-ink/30 space-y-1">
              {Object.entries((config as any).envOverrides ?? {}).map(([k, v]) => (
                <div key={k}>{k}={v ?? '(none)'}</div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
};
