/** Shared HTTP helpers for passive OSINT harvesters. */

import { resilientFetch } from '../../src/api/resilience.js';

export async function fetchJson<T = unknown>(
  url: string,
  opts: {
    timeoutMs: number;
    userAgent: string;
    headers?: Record<string, string>;
    breakerName?: string;
  },
): Promise<T> {
  const breakerName = opts.breakerName || new URL(url).hostname;
  const res = await resilientFetch(
    url,
    {
      breakerName,
      headers: {
        Accept: 'application/json',
        'User-Agent': opts.userAgent,
        ...(opts.headers || {}),
      },
    },
    { maxTimeout: opts.timeoutMs },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const snippet = body.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`HTTP ${res.status} for ${url}${snippet ? ` (${snippet})` : ''}`);
  }
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 80)}`);
  }
}

export async function fetchText(
  url: string,
  opts: {
    timeoutMs: number;
    userAgent: string;
    headers?: Record<string, string>;
    breakerName?: string;
  },
): Promise<string> {
  const breakerName = opts.breakerName || new URL(url).hostname;
  const res = await resilientFetch(
    url,
    {
      breakerName,
      headers: {
        'User-Agent': opts.userAgent,
        ...(opts.headers || {}),
      },
    },
    { maxTimeout: opts.timeoutMs },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const snippet = body.replace(/\s+/g, ' ').slice(0, 120);
    throw new Error(`HTTP ${res.status} for ${url}${snippet ? ` (${snippet})` : ''}`);
  }
  return await res.text();
}

export function normalizeDomain(target: string): string {
  return target
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '');
}

export function isIp(value: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
