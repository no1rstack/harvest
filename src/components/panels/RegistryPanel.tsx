import React, { useEffect, useState, useCallback } from 'react';
import { Play, RefreshCw, Crosshair, AlertTriangle, Database } from 'lucide-react';

interface HarvestTarget {
  id: string; name: string; category?: string; enabled: boolean;
  schedule?: string; last_run_at?: string; harvesters?: string[];
  metadata?: Record<string, unknown>;
}

const HARVESTERS = ['crtsh','dns','rdap','hackertarget','urlhaus','rss','wayback','holehe','sherlock','maigret'];

export const RegistryPanel: React.FC = () => {
  const [targets, setTargets] = useState<HarvestTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTarget, setNewTarget] = useState('');
  const [targetCategory, setTargetCategory] = useState('osint');
  const [newBulk, setNewBulk] = useState('');
  const [selectedHarvesters, setSelectedHarvesters] = useState<Record<string, boolean>>({});
  const [showBulk, setShowBulk] = useState(false);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/harvest/targets');
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setTargets(Array.isArray(json.targets) ? json.targets : []);
      setError(null);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTargets(); }, []);

  const toggleEnabled = async (id: string, enabled: boolean) => {
    setBusy(id);
    try {
      await fetch(`/api/harvest/targets/${id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Collection-Token': 'harvest-internal' },
        body: JSON.stringify({ enabled: !enabled }),
      });
      setTargets(prev => prev.map(t => t.id === id ? { ...t, enabled: !enabled } : t));
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const addTarget = async () => {
    const name = newTarget.trim(); if (!name) return;
    setBusy('new');
    try {
      await fetch('/api/harvest/targets', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Collection-Token': 'harvest-internal' },
        body: JSON.stringify({ name, category: targetCategory, harvesters: Object.keys(selectedHarvesters).filter(k => selectedHarvesters[k]), enabled: true }),
      });
      setNewTarget(''); setSelectedHarvesters({});
      await loadTargets();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const addBulk = async () => {
    const names = newBulk.split('\n').map(l => l.trim()).filter(Boolean);
    if (!names.length) return;
    setBusy('bulk');
    try {
      for (const name of names) {
        await fetch('/api/harvest/targets', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Collection-Token': 'harvest-internal' },
          body: JSON.stringify({ name, category: targetCategory, harvesters: Object.keys(selectedHarvesters).filter(k => selectedHarvesters[k]), enabled: true }),
        });
      }
      setNewBulk(''); setShowBulk(false);
      await loadTargets();
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  const runTarget = async (id: string) => {
    setBusy(id);
    try {
      await fetch(`/api/harvest/targets/${id}/run`, { method: 'POST', headers: { 'X-Collection-Token': 'harvest-internal' } });
    } catch (e: any) { setError(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-3 space-y-3">
        {error && <div className="flex items-start gap-2 p-2 border border-amber-400/20 bg-amber-400/[0.05] text-amber-200/70 text-[11px]"><AlertTriangle size={13} className="mt-0.5 shrink-0"/>{error}</div>}

        {/* Add target */}
        <div className="border border-ink/[0.05] bg-ink/[0.015] p-3 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-ink/40">Add Collection Target</div>
          <div className="flex flex-wrap gap-2">
            <input value={newTarget} onChange={e => setNewTarget(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTarget()}
              placeholder="Target name (domain, IP, handle...)"
              className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[12px] text-ink/70 flex-1 min-w-[16rem]" />
            <select value={targetCategory} onChange={e => setTargetCategory(e.target.value)}
              className="bg-noir-bg border border-ink/[0.08] px-2 py-1.5 text-[12px] text-ink/70">
              <option value="osint">OSINT</option><option value="financial">Financial</option>
              <option value="legal">Legal</option><option value="threat">Threat Intel</option>
              <option value="general">General</option>
            </select>
            <button onClick={addTarget} disabled={!newTarget.trim() || busy === 'new'}
              className="px-3 py-1.5 text-[11px] border border-ink/[0.08] text-ink/60 hover:text-ink/80 disabled:opacity-30">
              <Crosshair size={12} className="inline mr-1"/>Add
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {HARVESTERS.map(h => (
              <label key={h} className="flex items-center gap-1 text-[10px] text-ink/50 cursor-pointer">
                <input type="checkbox" checked={!!selectedHarvesters[h]} onChange={() => setSelectedHarvesters(s => ({...s, [h]: !s[h]}))}
                  className="accent-ink/30" />{h}
              </label>
            ))}
          </div>
        </div>

        {/* Bulk add */}
        {showBulk ? (
          <div className="border border-ink/[0.05] bg-ink/[0.015] p-3 space-y-2">
            <textarea value={newBulk} onChange={e => setNewBulk(e.target.value)}
              rows={5} placeholder="One target per line"
              className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[12px] text-ink/70 w-full" />
            <div className="flex gap-2">
              <button onClick={addBulk} disabled={!newBulk.trim()}
                className="px-3 py-1.5 text-[11px] border border-ink/[0.08] text-ink/60">Add All</button>
              <button onClick={() => setShowBulk(false)} className="px-3 py-1.5 text-[11px] text-ink/40">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowBulk(true)} className="text-[10px] text-ink/40 hover:text-ink/60 underline px-3">+ Bulk add</button>
        )}

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-ink/40">{targets.length} targets</span>
          <button onClick={loadTargets} className="text-[10px] text-ink/40 hover:text-ink/60"><RefreshCw size={11} className="inline"/></button>
        </div>

        {loading ? <div className="text-[12px] text-ink/40 p-4">Loading...</div> : (
          <div className="border border-ink/[0.05] overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-ink/[0.08] text-ink/40 text-[10px] uppercase tracking-wider">
                <th className="text-left p-2">Target</th><th className="text-left p-2">Category</th><th className="text-left p-2">Enabled</th><th className="text-left p-2">Harvesters</th><th className="text-left p-2">Last Run</th><th className="text-left p-2">Actions</th>
              </tr></thead>
              <tbody>
                {targets.map(t => (
                  <tr key={t.id} className="border-b border-ink/[0.03] hover:bg-ink/[0.02]">
                    <td className="p-2 font-mono text-ink/70">{t.name}</td>
                    <td className="p-2 text-ink/45">{t.category || 'osint'}</td>
                    <td className="p-2">
                      <button onClick={() => toggleEnabled(t.id, t.enabled)} className={t.enabled ? 'text-emerald-400/70' : 'text-ink/30'}>
                        {t.enabled ? 'ON' : 'OFF'}
                      </button>
                    </td>
                    <td className="p-2 text-ink/40 text-[10px]">{(t.harvesters || []).join(', ') || 'all'}</td>
                    <td className="p-2 text-ink/40 whitespace-nowrap">{t.last_run_at ? new Date(t.last_run_at).toLocaleString() : '-'}</td>
                    <td className="p-2">
                      <button onClick={() => runTarget(t.id)} disabled={busy === t.id}
                        className="text-[10px] text-ink/40 hover:text-sky-400/70 disabled:opacity-30">
                        <Play size={11} className="inline"/> Run
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
