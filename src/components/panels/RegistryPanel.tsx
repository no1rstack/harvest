import React, { useEffect, useState, useCallback } from 'react';
import { Play, RefreshCw, Crosshair, AlertTriangle } from 'lucide-react';

interface CollectionTarget {
  id: string;
  target_type: string;
  value: string;
  normalized_value: string;
  product: string;
  workflow_template: string;
  priority: number;
  frequency: string;
  enabled: boolean;
  last_collected_at: string | null;
  next_collect_at: string | null;
}

const TARGET_TYPES = ['domain', 'ip_address', 'email', 'url', 'handle', 'organization', 'person'];

export const RegistryPanel: React.FC = () => {
  const [targets, setTargets] = useState<CollectionTarget[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTarget, setNewTarget] = useState('');
  const [targetType, setTargetType] = useState('domain');
  const [newBulk, setNewBulk] = useState('');
  const [showBulk, setShowBulk] = useState(false);

  const loadTargets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/collection/targets?limit=200');
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setTargets(Array.isArray(json.targets) ? json.targets : []);
      setTotal(json.total ?? 0);
      setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTargets(); }, []);

  const toggleEnabled = async (id: string, enabled: boolean) => {
    setBusy(id);
    try {
      await fetch(`/api/collection/targets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !enabled }),
      });
      setTargets(prev => prev.map(t => t.id === id ? { ...t, enabled: !enabled } : t));
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const addTarget = async () => {
    const value = newTarget.trim(); if (!value) return;
    setBusy('new');
    try {
      const res = await fetch('/api/collection/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, target_type: targetType }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `${res.status}`);
      }
      setNewTarget('');
      await loadTargets();
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  const addBulk = async () => {
    const values = newBulk.split('\n').map(l => l.trim()).filter(Boolean);
    if (!values.length) return;
    setBusy('bulk');
    let ok = 0;
    for (const value of values) {
      try {
        const res = await fetch('/api/collection/targets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value, target_type: targetType }),
        });
        if (res.ok) ok++;
      } catch { /* continue */ }
    }
    setNewBulk(''); setShowBulk(false);
    setError(ok === values.length ? null : `${ok}/${values.length} added (some may already exist)`);
    await loadTargets();
    setBusy(null);
  };

  const runTarget = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch('/api/collection/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetId: id }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setError(null);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(null); }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-3 space-y-3">
        {error && (
          <div className="flex items-start gap-2 p-2 border border-amber-400/20 bg-amber-400/[0.05] text-amber-200/70 text-[11px]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0"/>{error}
          </div>
        )}

        {/* Add target */}
        <div className="border border-ink/[0.05] bg-ink/[0.015] p-3 space-y-3">
          <div className="text-[10px] uppercase tracking-wider text-ink/40">Add Collection Target</div>
          <div className="flex flex-wrap gap-2">
            <input value={newTarget} onChange={e => setNewTarget(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addTarget()}
              placeholder="Target value (domain, IP, handle...)"
              className="bg-noir-bg border border-ink/[0.08] px-3 py-1.5 text-[12px] text-ink/70 flex-1 min-w-[16rem]" />
            <select value={targetType} onChange={e => setTargetType(e.target.value)}
              className="bg-noir-bg border border-ink/[0.08] px-2 py-1.5 text-[12px] text-ink/70">
              {TARGET_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <button onClick={addTarget} disabled={!newTarget.trim() || busy === 'new'}
              className="px-3 py-1.5 text-[11px] border border-ink/[0.08] text-ink/60 hover:text-ink/80 disabled:opacity-30">
              <Crosshair size={12} className="inline mr-1"/>Add
            </button>
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
          <span className="text-[10px] text-ink/40">{total} targets</span>
          <button onClick={loadTargets} className="text-[10px] text-ink/40 hover:text-ink/60"><RefreshCw size={11} className="inline"/></button>
        </div>

        {loading ? <div className="text-[12px] text-ink/40 p-4">Loading...</div> : (
          <div className="border border-ink/[0.05] overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-ink/[0.08] text-ink/40 text-[10px] uppercase tracking-wider">
                <th className="text-left p-2">Value</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Workflow</th>
                <th className="text-left p-2">Enabled</th>
                <th className="text-left p-2">Last Run</th>
                <th className="text-left p-2">Actions</th>
              </tr></thead>
              <tbody>
                {targets.map(t => (
                  <tr key={t.id} className="border-b border-ink/[0.03] hover:bg-ink/[0.02]">
                    <td className="p-2 font-mono text-ink/70">{t.value}</td>
                    <td className="p-2 text-ink/45">{t.target_type}</td>
                    <td className="p-2 text-ink/40 text-[10px]">{t.workflow_template}</td>
                    <td className="p-2">
                      <button onClick={() => toggleEnabled(t.id, t.enabled)} className={t.enabled ? 'text-emerald-400/70' : 'text-ink/30'}>
                        {t.enabled ? 'ON' : 'OFF'}
                      </button>
                    </td>
                    <td className="p-2 text-ink/40 whitespace-nowrap">{t.last_collected_at ? new Date(t.last_collected_at).toLocaleString() : '-'}</td>
                    <td className="p-2">
                      <button onClick={() => runTarget(t.id)} disabled={busy === t.id}
                        className="text-[10px] text-ink/40 hover:text-sky-400/70 disabled:opacity-30">
                        <Play size={11} className="inline"/> Run
                      </button>
                    </td>
                  </tr>
                ))}
                {!targets.length && <tr><td colSpan={6} className="p-6 text-center text-ink/30 text-[12px]">No targets — add a domain or IP above</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
