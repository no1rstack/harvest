import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, CheckCircle2, XCircle, Globe, Network, User, Wand2 } from 'lucide-react';

interface ParsedCollection {
  target: string;
  targetType: string;
  product: string;
  workflowTemplate: string;
  profile: string;
  policy: string;
  strategy: string;
  intent: string;
  reasoning: string;
  capabilities: string[];
  collectors: string[];
}

interface AiFlowResult {
  ok: boolean;
  target: { id: string; value: string; target_type: string };
  parsed: ParsedCollection;
  cascades: { run_id: string; status: string } | null;
  error?: string;
}

const TYPE_ICONS: Record<string, React.FC<{ size?: number }>> = {
  domain: Globe,
  subdomain: Globe,
  ip: Network,
  cidr: Network,
  email: User,
  username: User,
  person: User,
  organization: User,
  repository: Globe,
};

const EXAMPLES = [
  { prompt: 'Check DNS and certificates for noirstack.com', label: 'Domain recon' },
  { prompt: 'Investigate twitter account @elonmusk', label: 'Social identity' },
  { prompt: 'Deep scan infrastructure of 10.0.0.0/24', label: 'Network scan' },
  { prompt: 'Look up organization "Stripe Inc"', label: 'Org lookup' },
  { prompt: 'Find threat indicators for malicious-site.ru', label: 'Threat check' },
];

export const AiFlowStudio: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiFlowResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/collection/ai-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmed, enqueue: true }),
      });
      const data = await res.json() as AiFlowResult;
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setResult(data);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [prompt, busy]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleExample = useCallback((example: string) => {
    setPrompt(example);
    setResult(null);
    setError(null);
  }, []);

  const TypeIcon = result?.parsed?.targetType ? TYPE_ICONS[result.parsed.targetType] : undefined;

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 p-4 border-b border-ink/[0.06]">
        <div className="flex items-center gap-2 mb-1">
          <Bot size={14} className="text-sky-400/70" />
          <h2 className="text-sm font-semibold text-ink/70">AI Flow Studio</h2>
          <span className="text-[9px] px-1.5 py-0.5 bg-sky-400/[0.08] text-sky-400/60 uppercase tracking-wider">Beta</span>
        </div>
        <p className="text-[10px] text-ink/40">Describe what to collect in natural language — Harvest parses the target, selects the right workflow, and enqueues it in Cascades.</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="border border-ink/[0.08] bg-ink/[0.01] p-3 space-y-3">
          <div className="flex items-start gap-3">
            <Bot size={16} className="text-sky-400/60 mt-1.5 shrink-0" />
            <div className="flex-1 space-y-2">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. Check DNS records for example.com, or investigate @username, or scan 10.0.0.0/24..."
                rows={3}
                className="w-full bg-transparent border-0 outline-none text-[12px] text-ink/80 placeholder:text-ink/30 resize-none font-mono"
                disabled={busy}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={busy || !prompt.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-400/90 text-black text-[11px] font-medium disabled:opacity-40"
                >
                  {busy ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                  {busy ? 'Orchestrating...' : 'Run Collection'}
                </button>
                <span className="text-[9px] text-ink/35">Enter to submit</span>
              </div>
            </div>
          </div>
        </div>

        {!result && !error && (
          <div className="space-y-1.5">
            <div className="text-[9px] uppercase tracking-wider text-ink/35 mb-2">Try these</div>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex, i) => (
                <button key={i} type="button" onClick={() => handleExample(ex.prompt)}
                  className="text-[10px] px-2 py-1 border border-ink/[0.06] text-ink/45 hover:text-ink/70 hover:border-ink/[0.12]">
                  <Wand2 size={10} className="inline mr-1" />
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="border border-rose-500/20 bg-rose-500/[0.04] p-3 text-[11px] text-rose-400/80 flex items-start gap-2">
            <XCircle size={14} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-medium mb-1">Orchestration failed</div>
              <div className="text-rose-400/60 font-mono">{error}</div>
            </div>
          </div>
        )}

        {result && result.ok && (
          <div className="space-y-3">
            <div className="border border-emerald-500/20 bg-emerald-500/[0.03] p-3">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 size={14} className="text-emerald-400/80" />
                <span className="text-[11px] font-medium text-emerald-400/80">Collection orchestrated</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div className="border border-ink/[0.04] p-2">
                  <div className="text-ink/30 uppercase">Target</div>
                  <div className="text-ink/70 font-mono">{result.parsed.target}</div>
                  {TypeIcon && <TypeIcon size={12} className="mt-1 text-ink/30" />}
                </div>
                <div className="border border-ink/[0.04] p-2">
                  <div className="text-ink/30 uppercase">Type</div>
                  <div className="text-ink/70">{result.parsed.targetType}</div>
                </div>
                <div className="border border-ink/[0.04] p-2">
                  <div className="text-ink/30 uppercase">Workflow</div>
                  <div className="text-ink/70 font-mono">{result.parsed.workflowTemplate}</div>
                </div>
                <div className="border border-ink/[0.04] p-2">
                  <div className="text-ink/30 uppercase">Profile</div>
                  <div className="text-ink/70">{result.parsed.profile}</div>
                </div>
                <div className="border border-ink/[0.04] p-2">
                  <div className="text-ink/30 uppercase">Strategy</div>
                  <div className="text-ink/70 font-mono text-[9px]">{result.parsed.strategy}</div>
                </div>
                <div className="border border-ink/[0.04] p-2">
                  <div className="text-ink/30 uppercase">Target ID</div>
                  <div className="text-ink/70 font-mono text-[9px]">{result.target.id}</div>
                </div>
              </div>
              {result.parsed.reasoning && (
                <div className="mt-2 border-t border-ink/[0.04] pt-2 text-[10px] text-ink/35 italic">{result.parsed.reasoning}</div>
              )}
              {result.cascades && (
                <div className="mt-2 flex items-center gap-2 text-[10px]">
                  <span className="text-ink/30">Cascades:</span>
                  <span className="font-mono text-sky-400/70">{result.cascades.run_id}</span>
                  <span className={result.cascades.status === 'accepted' ? 'text-amber-400/60' : 'text-emerald-400/60'}>{result.cascades.status}</span>
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {result.parsed.capabilities.map(cap => (
                  <span key={cap} className="text-[8px] px-1.5 py-0.5 bg-ink/[0.06] text-ink/40 uppercase">{cap}</span>
                ))}
              </div>
            </div>
            <button type="button" onClick={() => { setPrompt(''); setResult(null); setError(null); inputRef.current?.focus(); }}
              className="text-[10px] px-3 py-1.5 border border-ink/[0.08] text-ink/50 hover:text-ink/70">New Collection</button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AiFlowStudio;
