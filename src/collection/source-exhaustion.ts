/**
 * Source exhaustion — when a finding arrives from source X, enqueue X
 * so we pull more from that same source (feeds, platforms, connectors, URLs).
 */

import type { Pool } from 'pg';
import { inferAssetType, type CollectionAssetType } from './asset-types.js';
import { publishCollectionEvent } from './events.js';
import { resolveTargetStrategy } from './strategies.js';
import type { CollectionObservation, CollectionTarget } from './types.js';
import { normalizeTargetValue, upsertTarget } from './targetRegistry.js';

export interface SourceExhaustionCandidate {
  /** Registry value (may be encoded for connector-scoped seeds) */
  value: string;
  target_type: CollectionAssetType;
  workflow_template: string;
  strategy: string;
  /** Provenance label e.g. crtsh, rss:cisa-alerts, sherlock */
  provenance_source: string;
  /** Actual seed passed to Cascades when value is encoded */
  seed?: string;
  /** Force connector subset on the next Cascades run */
  collectors?: string[];
  confidence: number;
  kind: 'url' | 'domain' | 'feed' | 'platform' | 'connector';
}

/** Connectors that are re-queried against the parent seed (not standalone URLs). */
const CONNECTOR_SOURCES = new Set([
  'crtsh',
  'certspotter',
  'dns',
  'rdap',
  'whois',
  'wayback',
  'hackertarget',
  'urlhaus',
  'securitytrails',
  'holehe',
  'sherlock',
  'maigret',
  'theharvester',
  'github',
]);

const RSS_FEED_URLS: Record<string, string> = {
  'cisa-alerts': 'https://www.cisa.gov/cybersecurity-advisories/all.xml',
  krebs: 'https://krebsonsecurity.com/feed/',
  bleepingcomputer: 'https://www.bleepingcomputer.com/feed/',
};

function hostFromUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.hostname.replace(/^www\./i, '') || null;
  } catch {
    return null;
  }
}

function looksLikeUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim());
}

function pushUnique(
  out: SourceExhaustionCandidate[],
  seen: Set<string>,
  cand: SourceExhaustionCandidate,
): void {
  const key = `${cand.target_type}:${normalizeTargetValue(cand.value)}`;
  if (seen.has(key)) return;
  if (!cand.value?.trim()) return;
  seen.add(key);
  out.push(cand);
}

function connectorPlan(
  connector: string,
  parent: CollectionTarget,
): Pick<SourceExhaustionCandidate, 'workflow_template' | 'strategy' | 'collectors'> {
  const c = connector.toLowerCase();
  if (c === 'holehe' || c === 'sherlock' || c === 'maigret' || c === 'github') {
    return {
      workflow_template: 'identity',
      strategy: 'identity-deep',
      collectors: [c === 'github' ? 'github' : c],
    };
  }
  if (c === 'urlhaus' || c.startsWith('rss')) {
    return {
      workflow_template: 'threat-feed',
      strategy: 'source-exhaustion-standard',
      collectors: c.startsWith('rss') ? ['rss'] : ['urlhaus'],
    };
  }
  if (c === 'wayback') {
    return {
      workflow_template: 'document',
      strategy: 'source-exhaustion-standard',
      collectors: ['wayback'],
    };
  }
  if (c === 'crtsh' || c === 'certspotter') {
    return {
      workflow_template: 'certificate',
      strategy: 'certificate-minimal',
      collectors: [c === 'certspotter' ? 'crtsh' : c],
    };
  }
  return {
    workflow_template: parent.workflow_template || 'passive-domain',
    strategy: 'source-exhaustion-standard',
    collectors: [c],
  };
}

/**
 * Derive source-exhaustion candidates from observation provenance.
 * Entity fan-out remains separate (related edges); this is about the *source*.
 */
export function extractSourceExhaustionCandidates(
  observations: CollectionObservation[],
  parent: CollectionTarget,
): SourceExhaustionCandidate[] {
  const out: SourceExhaustionCandidate[] = [];
  const seen = new Set<string>();
  const parentNorm = normalizeTargetValue(parent.value);

  for (const obs of observations) {
    const source = String(obs.source || '').trim();
    const raw = (obs.raw && typeof obs.raw === 'object' ? obs.raw : {}) as Record<string, unknown>;
    const provenanceConnector =
      String(
        (obs.provenance as { collection?: { connector_id?: string } })?.collection?.connector_id ||
          '',
      ).trim() || source.split(':')[0];

    // ── Concrete URLs (article, profile, archive, feed item) ──
    const urlCandidates = [
      looksLikeUrl(obs.value) ? obs.value : null,
      typeof raw.url === 'string' && looksLikeUrl(raw.url) ? raw.url : null,
      typeof raw.feedUrl === 'string' && looksLikeUrl(raw.feedUrl) ? raw.feedUrl : null,
      typeof raw.feed_url === 'string' && looksLikeUrl(raw.feed_url) ? raw.feed_url : null,
      typeof raw.original === 'string' && looksLikeUrl(raw.original) ? raw.original : null,
    ].filter((u): u is string => Boolean(u));

    for (const url of urlCandidates) {
      const host = hostFromUrl(url);
      const isIdentitySrc = source === 'sherlock' || source === 'maigret' || source === 'holehe';
      const isRss = source.startsWith('rss');
      pushUnique(out, seen, {
        value: url,
        target_type: 'api_endpoint',
        workflow_template: isRss ? 'threat-feed' : isIdentitySrc ? 'identity' : 'document',
        strategy: isIdentitySrc ? 'identity-deep' : 'source-exhaustion-standard',
        provenance_source: source || 'url',
        confidence: obs.confidence ?? 0.7,
        kind: isRss ? 'feed' : isIdentitySrc ? 'platform' : 'url',
        collectors: isRss ? ['rss'] : isIdentitySrc ? [source] : ['wayback'],
      });
      if (host && normalizeTargetValue(host) !== parentNorm) {
        pushUnique(out, seen, {
          value: host,
          target_type: inferAssetType(host) === 'subdomain' ? 'subdomain' : 'domain',
          workflow_template: 'passive-domain',
          strategy: 'passive-domain-standard',
          provenance_source: source || host,
          confidence: obs.confidence ?? 0.65,
          kind: 'domain',
        });
      }
    }

    // ── RSS feed as first-class source ──
    if (source.startsWith('rss:')) {
      const feedId = source.slice(4);
      const feedUrl =
        (typeof raw.feedUrl === 'string' && raw.feedUrl) ||
        (typeof raw.feed_url === 'string' && raw.feed_url) ||
        RSS_FEED_URLS[feedId];
      if (feedUrl) {
        pushUnique(out, seen, {
          value: feedUrl,
          target_type: 'api_endpoint',
          workflow_template: 'threat-feed',
          strategy: 'source-exhaustion-standard',
          provenance_source: source,
          confidence: 0.9,
          kind: 'feed',
          collectors: ['rss'],
        });
      } else {
        pushUnique(out, seen, {
          value: source,
          target_type: 'metadata',
          workflow_template: 'threat-feed',
          strategy: 'source-exhaustion-standard',
          provenance_source: source,
          confidence: 0.8,
          kind: 'feed',
          collectors: ['rss'],
        });
      }
    }

    // ── Identity platforms (Holehe / Sherlock / Maigret) ──
    const platform =
      (typeof raw.platform === 'string' && raw.platform) ||
      (typeof raw.site === 'string' && raw.site) ||
      null;
    if (platform && (source === 'sherlock' || source === 'maigret' || source === 'holehe')) {
      const platformHost = platform.includes('.')
        ? platform.replace(/^https?:\/\//i, '').split('/')[0]
        : null;
      const platformUrl = looksLikeUrl(platform)
        ? platform
        : platformHost
          ? `https://${platformHost}`
          : null;

      if (platformUrl) {
        pushUnique(out, seen, {
          value: platformUrl,
          target_type: 'api_endpoint',
          workflow_template: 'identity',
          strategy: 'identity-deep',
          provenance_source: source,
          confidence: 0.85,
          kind: 'platform',
          collectors: [source],
        });
      }
      if (platformHost && normalizeTargetValue(platformHost) !== parentNorm) {
        pushUnique(out, seen, {
          value: platformHost,
          target_type: 'domain',
          workflow_template: 'passive-domain',
          strategy: 'passive-domain-standard',
          provenance_source: source,
          confidence: 0.75,
          kind: 'domain',
        });
      } else if (!platformHost && platform.length > 1) {
        // Site name only (e.g. "GitHub") — still track as metadata source
        pushUnique(out, seen, {
          value: `platform:${source}:${platform}`,
          target_type: 'metadata',
          workflow_template: 'identity',
          strategy: 'identity-deep',
          provenance_source: source,
          seed: parent.value,
          collectors: [source],
          confidence: 0.7,
          kind: 'platform',
        });
      }
    }

    // ── Connector-scoped re-query of the parent seed ──
    const connector = provenanceConnector.toLowerCase();
    if (CONNECTOR_SOURCES.has(connector) || CONNECTOR_SOURCES.has(source.toLowerCase())) {
      const id = CONNECTOR_SOURCES.has(connector) ? connector : source.toLowerCase();
      const plan = connectorPlan(id, parent);
      pushUnique(out, seen, {
        value: `source:${id}:${parent.normalized_value || parentNorm}`,
        target_type: 'metadata',
        workflow_template: plan.workflow_template,
        strategy: plan.strategy,
        provenance_source: id,
        seed: parent.value,
        collectors: plan.collectors,
        confidence: 0.8,
        kind: 'connector',
      });
    }
  }

  // Never re-enqueue the parent itself as a plain value match
  return out.filter((c) => {
    if (c.kind === 'connector') return true;
    return normalizeTargetValue(c.value) !== parentNorm;
  });
}

export async function exhaustSourcesFromObservations(
  pool: Pool,
  parent: CollectionTarget,
  observations: CollectionObservation[],
  opts: { workflowRunId?: string; dryRun?: boolean; maxSources?: number } = {},
): Promise<{ exhausted: number; skipped: number; targets: string[] }> {
  if (
    process.env.COLLECTION_SOURCE_EXHAUSTION === '0' ||
    process.env.COLLECTION_SOURCE_EXHAUSTION === 'false'
  ) {
    return { exhausted: 0, skipped: 0, targets: [] };
  }

  const strategy = resolveTargetStrategy(parent);
  if (!strategy.auto_discover && !parent.metadata?.force_discover) {
    return { exhausted: 0, skipped: observations.length, targets: [] };
  }

  const maxDepth = strategy.stopping_conditions?.max_depth ?? 3;
  const parentDepth = parent.discovery_depth ?? (parent.metadata?.discovery_depth as number) ?? 0;
  if (parentDepth >= maxDepth) {
    return { exhausted: 0, skipped: observations.length, targets: [] };
  }

  const candidates = extractSourceExhaustionCandidates(observations, parent);
  const limit = Math.min(
    opts.maxSources ?? strategy.stopping_conditions?.max_targets ?? 50,
    100,
  );
  const slice = candidates.slice(0, limit);

  let exhausted = 0;
  let skipped = candidates.length - slice.length;
  const targetIds: string[] = [];

  for (const cand of slice) {
    if (opts.dryRun) {
      exhausted++;
      continue;
    }

    const child = await upsertTarget(pool, {
      target_type: cand.target_type,
      value: cand.value,
      product: parent.product,
      case_id: parent.case_id,
      workflow_template: cand.workflow_template,
      collection_strategy: cand.strategy,
      collection_policy: parent.collection_policy,
      collection_profile: parent.collection_profile,
      expires_at: parent.expires_at,
      origin: 'discovery',
      origin_ref: `source-exhaustion:${parent.id}`,
      source: cand.provenance_source,
      priority: Math.min(99, (parent.priority || 50) + 5),
      metadata: {
        parent_target_id: parent.id,
        discovery_depth: parentDepth + 1,
        discovery_relation: 'from_source',
        exhaust_source: true,
        provenance_source: cand.provenance_source,
        exhaust_kind: cand.kind,
        seed_target: cand.seed || parent.value,
        collectors: cand.collectors,
        discovered_from_run: opts.workflowRunId,
      },
    });

    await pool.query(
      `INSERT INTO collection_target_dependencies
        (parent_target_id, child_target_id, relation, source_type, target_type, discovered_value, depth, rule_id)
       VALUES ($1,$2,'from_source',$3,$4,$5,$6,$7)`,
      [
        parent.id,
        child.id,
        parent.target_type,
        cand.target_type,
        cand.value,
        parentDepth + 1,
        `source-exhaust:${cand.kind}:${cand.provenance_source}`,
      ],
    );

    await pool.query(
      `UPDATE collection_targets SET
         parent_target_id = COALESCE(parent_target_id, $2),
         discovery_depth = GREATEST(COALESCE(discovery_depth, 0), $3),
         collection_strategy = COALESCE(collection_strategy, $4),
         expires_at = COALESCE(expires_at, $5)
       WHERE id = $1`,
      [child.id, parent.id, parentDepth + 1, cand.strategy, parent.expires_at],
    );

    await publishCollectionEvent(pool, {
      event_type: 'target.discovered',
      target_id: child.id,
      run_id: opts.workflowRunId,
      payload: {
        parent_target_id: parent.id,
        parent_value: parent.value,
        discovered_value: cand.value,
        target_type: cand.target_type,
        relation: 'from_source',
        exhaust_source: true,
        provenance_source: cand.provenance_source,
        kind: cand.kind,
        workflow_template: cand.workflow_template,
        strategy: cand.strategy,
      },
    });

    const enqueue =
      process.env.COLLECTION_DISCOVERY_ENQUEUE !== '0' &&
      process.env.COLLECTION_DISCOVERY_ENQUEUE !== 'false';
    if (enqueue) {
      try {
        const { submitTargetToCascades } = await import('./submitDue.js');
        await submitTargetToCascades(pool, child, {
          actor: 'source-exhaustion',
          force: true,
        });
      } catch (err) {
        console.warn(
          `[source-exhaustion] enqueue failed for ${child.id}: ${(err as Error).message}`,
        );
      }
    }

    exhausted++;
    targetIds.push(child.id);
  }

  return { exhausted, skipped, targets: targetIds };
}
