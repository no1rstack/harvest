/**
 * Resilience Layer — retry, circuit breaker, timeout for harvester HTTP.
 */

let pRetry: any;
let CircuitBreaker: any;

try {
  pRetry = (await import('p-retry')).default;
} catch {
  pRetry = null;
}

try {
  CircuitBreaker = (await import('opossum')).default;
} catch {
  CircuitBreaker = null;
}

const RETRY_OPTIONS = { retries: 3, factor: 2, minTimeout: 1000, maxTimeout: 10000 };

const breakers = new Map<string, any>();

function getBreaker(name: string): any {
  if (!CircuitBreaker) {
    return { fire: (fn: () => Promise<any>) => fn() };
  }
  if (!breakers.has(name)) {
    breakers.set(
      name,
      new CircuitBreaker(async (fn: () => Promise<any>) => fn(), {
        timeout: 15000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        name,
        rollingCountTimeout: 60000,
        rollingCountBuckets: 10,
        volumeThreshold: 5,
      }),
    );
  }
  return breakers.get(name)!;
}

export async function resilientFetch(
  url: string,
  options: RequestInit & { breakerName?: string } = {},
  retryOpts: Record<string, any> = {},
): Promise<Response> {
  const breakerName = options.breakerName || new URL(url).hostname;
  const breaker = getBreaker(breakerName);
  const mergedRetry = { ...RETRY_OPTIONS, ...retryOpts };

  const run = async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), mergedRetry.maxTimeout || 15000);
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Harvest/1.0 Collection Platform',
          ...options.headers,
        },
      });
      if (!res.ok && res.status >= 500) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return res;
    } finally {
      clearTimeout(timeout);
    }
  };

  if (pRetry) {
    return breaker.fire(() => pRetry(run, mergedRetry)) as Promise<Response>;
  }
  return breaker.fire(run) as Promise<Response>;
}
