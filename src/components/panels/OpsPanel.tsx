import React, { useEffect, useState } from 'react';
import { Play, RefreshCw, AlertTriangle } from 'lucide-react';

export const OpsPanel: React.FC = () => {
  const [metrics, setMetrics] = useState<any>(null);
  const [daily, setDaily] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const loadOps = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, dailyRes] = await Promise.all([
        fetch('/api/harvest/ops-summary'),
        fetch('/api/harvest/daily-summary'),
      ]);
      const summary = summaryRes.ok ? await summaryRes.json() : null;
      const dailyData = dailyRes.ok ? await dailyRes.json() : null;
      setMetrics(summary);
      setDaily(dailyData);
      if (!summaryRes.ok || !dailyRes.ok) setError('Partial load failed');
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  useEffect(() => { loadOps(); }, []);

  const runDaily = async (dry: boolean) => {
    setRunBusy(true); setRunResult(null);
    try {
      const res = await fetch('/api/harvest/daily-run', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Collection-Token': 'harvest-internal' },
        body: JSON.stringify({ dryRun: dry }),
      });
      const data = await res.json();
      setRunResult(dry ? 'Dry run complete' : `Run started: ${JSON.stringify(data)}`);
    } catch (e: any) { setError(e.message); } finally { setRunBusy(false); }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-3 space-y-3">
        {error && <div className="flex items-start gap-2 p-2 border border-amber-400/20 bg-amber-400/[0.05] text-amber-200/70 text-[11px]"><AlertTriangle size={13} className="mt-0.5 shrink-0"/>{error}</div>}

        {metrics && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: 'Targets Enabled', value: metrics.targets?.enabled ?? '-' },
              { label: 'Due Now', value: metrics.targets?.due ?? '-' },
              { label: 'Obs Today', value: metrics.observationsPersistedToday ?? '-' },
              { label: 'Findings Today', value: metrics.findings?.today ?? '-' },
              { label: 'Connector Errors 24h', value: metrics.providerErrors24h ?? '-' },
              { label: 'Healthy Connectors', value: `${metrics.connectorHealth?.healthy ?? 0}/${metrics.connectorHealth?.total ?? 0}` },
            ].map(c => (
              <div key={c.label} className="border border-ink/[0.05] bg-ink/[0.015] p-3">
                <div className="text-[10px] uppercase tracking-wider text-ink/40">{c.label}</div>
                <div className="mt-1 text-xl font-mono font-light text-ink/70">{c.value}</div>
              </div>
            ))}
          </section>
        )}

        <div className="flex gap-2">
          <button onClick={() => runDaily(false)} disabled={runBusy}
            className="px-3 py-1.5 text-[11px] border border-ink/[0.08] text-ink/60 hover:text-sky-400/70 disabled:opacity-30">
            <Play size={12} className="inline mr-1"/>Run Daily Collection
          </button>
          <button onClick={() => runDaily(true)} disabled={runBusy}
            className="px-3 py-1.5 text-[11px] border border-ink/[0.08] text-ink/40 hover:text-ink/60 disabled:opacity-30">
            Dry Run
          </button>
          <button onClick={loadOps} className="px-3 py-1.5 text-[11px] border border-ink/[0.08] text-ink/40"><RefreshCw size={12} className="inline"/></button>
        </div>

        {runResult && <div className="text-[11px] text-ink/50 font-mono p-2 border border-ink/[0.05]">{runResult}</div>}

        {daily && (
          <div className="border border-ink/[0.05] p-3 space-y-2">
            <div className="text-[10px] uppercase tracking-wider text-ink/40">Today's Collection</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
              {[
                { l: 'Started', v: daily.startedAt ? new Date(daily.startedAt).toLocaleString() : '-' },
                { l: 'Finished', v: daily.finishedAt ? new Date(daily.finishedAt).toLocaleString() : '-' },
                { l: 'Runs', v: daily.runs ?? '-' },
                { l: 'Failed', v: daily.failed ?? '-' },
                { l: 'Findings', v: daily.totalFindings ?? '-' },
                { l: 'Inserted', v: daily.totalInserted ?? '-' },
                { l: 'Errors', v: daily.totalErrors ?? '-' },
                { l: 'Products', v: daily.products ?? '-' },
              ].map(d => (
                <div key={d.l} className="text-ink/50"><span className="text-ink/30">{d.l}:</span> {d.v}</div>
              ))}
            </div>
            {daily.log && <pre className="text-[10px] text-ink/40 font-mono border border-ink/[0.05] p-2 max-h-32 overflow-auto">{daily.log}</pre>}
          </div>
        )}

        {loading && <div className="text-[12px] text-ink/40 p-4">Loading operations data...</div>}
      </div>
    </div>
  );
};
