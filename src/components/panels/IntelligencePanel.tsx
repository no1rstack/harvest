import React, { useEffect, useState } from 'react';
import { AlertTriangle, Brain } from 'lucide-react';

export const IntelligencePanel: React.FC = () => {
  const [tables, setTables] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [rows, setRows] = useState<any[]>([]);
  const [rowCount, setRowCount] = useState(0);

  useEffect(() => {
    fetch('/api/intelligence/v1/summary')
      .then(r => r.json())
      .then(data => { setTables(data.tables || []); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadTable = async (table: string) => {
    setSelectedTable(table);
    setLoading(true);
    try {
      const res = await fetch(`/api/intelligence/v1/records/${table}?limit=50`);
      const data = await res.json();
      setRows(data.records || []); setRowCount(data.total || 0);
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-3 space-y-3">
        {error && <div className="flex items-start gap-2 p-2 border border-amber-400/20 bg-amber-400/[0.05] text-amber-200/70 text-[11px]"><AlertTriangle size={13} className="mt-0.5 shrink-0"/>{error}</div>}

        <div className="flex items-center gap-2">
          <Brain size={14} className="text-ink/40" />
          <span className="text-[10px] uppercase tracking-wider text-ink/40">Intelligence Core v1</span>
        </div>

        {loading && <div className="text-[12px] text-ink/40 p-4">Loading...</div>}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          {tables.map((t: any) => (
            <button key={t.table_name}
              onClick={() => loadTable(t.table_name)}
              className={`border p-3 text-left ${selectedTable === t.table_name ? 'border-ink/30 bg-ink/[0.04]' : 'border-ink/[0.05] hover:bg-ink/[0.02]'}`}>
              <div className="text-[11px] text-ink/70 font-mono">{t.table_name}</div>
              <div className="text-[10px] text-ink/40 mt-1">{t.row_count ?? '?'} rows</div>
            </button>
          ))}
        </div>

        {selectedTable && rows.length > 0 && (
          <div className="border border-ink/[0.05] overflow-x-auto">
            <div className="p-2 text-[10px] text-ink/40 border-b border-ink/[0.05]">
              {selectedTable} — {rowCount} records (showing {rows.length})
            </div>
            <table className="w-full text-[10px]">
              <thead><tr className="border-b border-ink/[0.08] text-ink/40 text-[9px] uppercase tracking-wider">
                {Object.keys(rows[0] || {}).slice(0, 8).map(k => <th key={k} className="text-left p-1.5">{k}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((row: any, i: number) => (
                  <tr key={i} className="border-b border-ink/[0.03] hover:bg-ink/[0.02]">
                    {Object.values(row).slice(0, 8).map((v: any, j: number) => (
                      <td key={j} className="p-1.5 text-ink/50 max-w-[12rem] truncate">
                        {typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v ?? '-').slice(0, 80)}
                      </td>
                    ))}
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
