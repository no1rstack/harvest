/**
 * OpenAI-compatible chat client for Harvest feed enrichment.
 * Env contract aligned with Judicium / Cascades.
 */

const OLLAMA_DEFAULT = 'http://host.containers.internal:11434/v1/chat/completions';

function trim(v: string | undefined): string {
  return String(v || '').trim();
}

function chatUrlFromBase(base: string): string {
  const b = base.replace(/\/+$/, '');
  if (b.endsWith('/chat/completions')) return b;
  if (b.endsWith('/v1')) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

export function isHarvestLlmEnrichEnabled(): boolean {
  const flag = trim(process.env.HARVEST_LLM_ENRICH).toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  if (flag === '1' || flag === 'true' || flag === 'on') return true;
  // Default on (Ollama host gateway); set HARVEST_LLM_ENRICH=0 to disable.
  return true;
}

/** Cap LLM calls per pull batch to keep RSS ingest responsive. */
export function harvestLlmEnrichLimit(): number {
  const n = Number(process.env.HARVEST_LLM_ENRICH_LIMIT || 20);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 20;
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function getHarvestLlmConfig() {
  const litellmBase = trim(process.env.LITELLM_BASE_URL);
  const copilotUrl = trim(process.env.COPILOT_API_URL);
  const ollamaUrl = trim(process.env.OLLAMA_URL) || OLLAMA_DEFAULT;
  const model =
    trim(process.env.HARVEST_LLM_MODEL) ||
    trim(process.env.LITELLM_MODEL) ||
    trim(process.env.COPILOT_MODEL) ||
    'qwen2.5-coder:7b-instruct';
  const timeoutMs = Math.max(
    1000,
    Number(process.env.HARVEST_LLM_TIMEOUT_MS || process.env.LITELLM_TIMEOUT_MS || 12000),
  );

  if (litellmBase) {
    return {
      chatCompletionsUrl: chatUrlFromBase(litellmBase),
      apiKey: trim(process.env.LITELLM_API_KEY) || trim(process.env.COPILOT_API_KEY) || '',
      model,
      timeoutMs,
    };
  }
  if (copilotUrl) {
    return {
      chatCompletionsUrl: copilotUrl.includes('/chat/completions') ? copilotUrl : chatUrlFromBase(copilotUrl),
      apiKey: trim(process.env.COPILOT_API_KEY) || trim(process.env.OPENAI_API_KEY) || '',
      model,
      timeoutMs,
    };
  }
  return {
    chatCompletionsUrl: ollamaUrl.includes('/chat/completions') ? ollamaUrl : chatUrlFromBase(ollamaUrl),
    apiKey: '',
    model,
    timeoutMs,
  };
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    /* continue */
  }
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type HarvestLlmEnrichment = {
  entities: string[];
  keywords: string[];
  category: string;
  summary?: string;
  model: string;
  ok: boolean;
};

export async function harvestStructuredEnrich(opts: {
  title: string;
  summary: string;
  categoryHint?: string;
}): Promise<HarvestLlmEnrichment | null> {
  if (!isHarvestLlmEnrichEnabled()) return null;
  const cfg = getHarvestLlmConfig();
  const system =
    'You extract OSINT feed metadata. Reply with ONLY compact JSON: ' +
    '{"entities":string[],"keywords":string[],"category":string,"summary":string}. ' +
    'category must be one of: defense, sanctions, cyber, maritime, aviation, finance, disaster, energy, government, intelligence, news. ' +
    'entities are people/orgs/places (lowercase). keywords are 3-12 topical terms. summary max 240 chars.';
  const user = JSON.stringify({
    title: opts.title.slice(0, 300),
    summary: (opts.summary || '').slice(0, 1200),
    category_hint: opts.categoryHint || 'news',
  });

  try {
    const res = await fetch(cfg.chatCompletionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 280,
        temperature: 0.1,
        format: 'json',
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = String(data.choices?.[0]?.message?.content || '').trim();
    const parsed = extractJsonObject(text);
    if (!parsed) return null;

    const entities = Array.isArray(parsed.entities)
      ? parsed.entities.map((e) => String(e).toLowerCase().trim()).filter(Boolean).slice(0, 20)
      : [];
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.map((k) => String(k).toLowerCase().trim()).filter(Boolean).slice(0, 12)
      : [];
    const category = String(parsed.category || opts.categoryHint || 'news')
      .toLowerCase()
      .trim() || 'news';
    const summary = parsed.summary ? String(parsed.summary).slice(0, 240) : undefined;

    return { entities, keywords, category, summary, model: cfg.model, ok: true };
  } catch {
    return null;
  }
}
