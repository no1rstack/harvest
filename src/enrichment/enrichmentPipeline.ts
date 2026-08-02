/**
 * Daily Encyclopedia Enrichment Pipeline
 *
 * Extracts keywords/entities from community_items, resolves them against
 * Wikidata, fetches Wikipedia summaries+infoboxes, stores normalized facts,
 * and detects changes between snapshots.
 */

import type { Pool } from 'pg';
import type { EnrichmentCandidate, EnrichmentResult, EnrichmentRun } from './types';
import { resolveTermToWikidata, resolveWikidataEntity } from './wikidata';
import { fetchWikipediaArticle } from './wikipedia';
import { ENRICHMENT_SCHEMA_SQL } from './schema';
import * as crypto from 'crypto';

// ---- Schema migration ----
let schemaEnsured = false;
export async function ensureEnrichmentSchema(pool: Pool): Promise<void> {
  if (schemaEnsured) return;
  try {
    await pool.query(ENRICHMENT_SCHEMA_SQL);
    schemaEnsured = true;
  } catch (err: unknown) {
    console.error('[enrichment] Schema migration failed:', (err as Error).message);
    throw err;
  }
}

// ---- Candidate extraction from community_items ----
export async function extractEnrichmentCandidates(
  pool: Pool,
): Promise<EnrichmentCandidate[]> {
  // Extract unique terms from enrichment payloads
  const query = `
    WITH terms AS (
      SELECT
        LOWER(kw) as term,
        stream,
        category,
        id as source_record_id,
        first_seen_at
      FROM community_items,
      LATERAL jsonb_array_elements_text(COALESCE(payload_json->'enrichment'->'keywords', '[]'::jsonb)) as kw
      WHERE payload_json->'enrichment'->'keywords' IS NOT NULL
      UNION ALL
      SELECT
        LOWER(ent) as term,
        stream,
        category,
        id as source_record_id,
        first_seen_at
      FROM community_items,
      LATERAL jsonb_array_elements_text(COALESCE(payload_json->'enrichment'->'entities', '[]'::jsonb)) as ent
      WHERE payload_json->'enrichment'->'entities' IS NOT NULL
    ),
    cleaned AS (
      SELECT
        term,
        stream,
        category,
        source_record_id,
        first_seen_at,
        CASE
          WHEN term ~ '^[0-9]+$' OR term ~ '^[0-9a-f]{4,}$' THEN 0
          WHEN LENGTH(term) < 3 THEN 0
          WHEN term IN ('http', 'https', 'www', 'com', 'org', 'net', 'edu', 'gov',
                         'the', 'and', 'for', 'with', 'from', 'that', 'this',
                         'was', 'are', 'has', 'had', 'were', 'been', 'being',
                         'will', 'would', 'could', 'should', 'may', 'might',
                         'also', 'not', 'but', 'its', 'his', 'her', 'our',
                         'their', 'said', 'reported', 'reports', 'report',
                         'new', 'one', 'two', 'first', 'last', 'will', 'used',
                         'can', 'per', 'set', 'get', 'may', 'etc', 'many',
                         'still', 'take', 'make', 'use', 'much', 'part',
                         'long', 'just', 'like', 'even', 'now', 'year',
                         'alt', 'opensky', 'download', 'bin.sh',
                         'reportedly', 'allegedly')
            THEN 0
          WHEN term ~ '^[a-f0-9]{32,}$' OR term ~ '^[0-9]{8,}$' THEN 0
          WHEN term ~ '^[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+$' THEN 0
          ELSE 1
        END AS valid
      FROM terms
    )
    SELECT
      term,
      ARRAY_AGG(DISTINCT stream) FILTER (WHERE stream IS NOT NULL) AS source_ids,
      ARRAY_AGG(DISTINCT category) FILTER (WHERE category IS NOT NULL) AS contexts,
      ARRAY_AGG(DISTINCT source_record_id) AS source_record_ids,
      MIN(first_seen_at) AS first_observed_at,
      MAX(first_seen_at) AS last_observed_at,
      COUNT(*) AS occurrence_count,
      SUM(
        CASE
          WHEN category IN ('sanctions', 'legal', 'terrorism', 'cyber', 'military', 'intelligence')
            OR stream IN ('aiid', 'sanctions', 'law', 'security')
            THEN 3
          WHEN category IN ('corporate', 'government', 'finance', 'economy', 'trade')
            THEN 2
          ELSE 1
        END
      )::REAL AS authority_weighted_count
    FROM cleaned
    WHERE valid = 1
    GROUP BY term
    HAVING COUNT(*) >= 2
    ORDER BY authority_weighted_count DESC, COUNT(*) DESC
    LIMIT 2000
  `;

  const result = await pool.query(query);
  const candidates: EnrichmentCandidate[] = result.rows.map((row: any) => ({
    term: row.term,
    sourceIds: row.source_ids || [],
    sourceRecordIds: row.source_record_ids || [],
    firstObservedAt: row.first_observed_at?.toISOString?.() || row.first_observed_at,
    lastObservedAt: row.last_observed_at?.toISOString?.() || row.last_observed_at,
    occurrenceCount: row.occurrence_count,
    authorityWeightedCount: row.authority_weighted_count,
    contexts: row.contexts || [],
    aliases: [],
  }));

  return candidates;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function contentHash(data: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
}

function slug(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
}

// ---- Main enrichment run ----
export async function runEnrichment(
  pool: Pool,
  options: {
    maxCandidates?: number;
    minPriority?: number;
    forceReenrichDays?: number; // re-enrich entities older than N days
    batchSize?: number;
  } = {}
): Promise<EnrichmentRun> {
  const {
    maxCandidates = 500,
    minPriority = 1,
    forceReenrichDays = 7,
    batchSize = 10,
  } = options;

  await ensureEnrichmentSchema(pool);

  const runId = generateId('er');
  const run: EnrichmentRun = {
    runId,
    startedAt: new Date().toISOString(),
    candidates: 0,
    resolved: 0,
    failed: 0,
    facts: 0,
    changes: 0,
    status: 'running',
  };

  console.log(`[enrichment] Starting run ${runId}`);

  try {
    await pool.query(
      `INSERT INTO enrichment_runs (run_id, status) VALUES ($1, 'running')`,
      [runId]
    );

    // Step 1: Extract candidates from community items
    console.log('[enrichment] Extracting candidates from community_items...');
    const candidates = await extractEnrichmentCandidates(pool);

    // Filter by priority
    const filtered = candidates
      .filter(c => c.authorityWeightedCount >= minPriority)
      .sort((a, b) => b.authorityWeightedCount - a.authorityWeightedCount)
      .slice(0, maxCandidates);

    run.candidates = filtered.length;
    console.log(`[enrichment] Found ${candidates.length} candidates, processing ${filtered.length}`);

    // Step 2: Resolve each candidate against Wikidata
    const results: EnrichmentResult[] = [];
    let processed = 0;

    for (let i = 0; i < filtered.length; i += batchSize) {
      const batch = filtered.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (candidate) => {
          try {
            return await enrichCandidate(pool, candidate);
          } catch (err: unknown) {
            console.error(`[enrichment] Error enriching "${candidate.term}":`, (err as Error).message);
            return {
              candidateTerm: candidate.term,
              resolved: false,
              factsAdded: 0,
              factsSkipped: 0,
              changesDetected: 0,
              wasUpdated: false,
              error: (err as Error).message,
            } as EnrichmentResult;
          }
        })
      );

      for (const result of batchResults) {
        results.push(result);
        if (result.resolved) run.resolved++;
        else run.failed++;
        run.facts += result.factsAdded;
        run.changes += result.changesDetected;
      }

      processed += batch.length;
      if (processed % 100 === 0) {
        console.log(`[enrichment] Progress: ${processed}/${filtered.length} (${run.resolved} resolved, ${run.failed} failed, ${run.facts} facts)`);
      }

      // Rate limiting: be gentle to Wikimedia APIs
      if (i + batchSize < filtered.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    run.status = 'completed';
    run.finishedAt = new Date().toISOString();

    await pool.query(
      `UPDATE enrichment_runs SET
        finished_at = NOW(), resolved = $2, failed = $3, facts_added = $4,
        changes_detected = $5, status = 'completed'
       WHERE run_id = $1`,
      [runId, run.resolved, run.failed, run.facts, run.changes]
    );

    console.log(`[enrichment] Run ${runId} complete: ${run.resolved} resolved, ${run.failed} failed, ${run.facts} facts, ${run.changes} changes`);
    return run;
  } catch (err: unknown) {
    run.status = 'failed';
    run.finishedAt = new Date().toISOString();
    try {
      await pool.query(
        `UPDATE enrichment_runs SET finished_at = NOW(), status = 'failed', error = $2 WHERE run_id = $1`,
        [runId, (err as Error).message]
      );
    } catch {} // best-effort
    console.error('[enrichment] Run failed:', (err as Error).message);
    return run;
  }
}

async function enrichCandidate(
  pool: Pool,
  candidate: EnrichmentCandidate,
): Promise<EnrichmentResult> {
  const term = candidate.term;

  // Step 1: Check if already resolved recently
  const existing = await pool.query(
    `SELECT entity_id, wikidata_id, canonical_label, entity_type,
            resolution_status, last_enriched_at
     FROM canonical_entities
     WHERE canonical_label = $1 OR $1 = ANY(aliases)`,
    [term]
  );

  if (existing.rows.length > 0 && existing.rows[0].resolution_status === 'resolved') {
    const row = existing.rows[0];
    // Re-enrich if it's been more than 7 days
    const lastEnriched = new Date(row.last_enriched_at).getTime();
    const ageDays = (Date.now() - lastEnriched) / (1000 * 60 * 60 * 24);
    if (ageDays < 7) {
      return {
        candidateTerm: term,
        resolved: true,
        wikidataId: row.wikidata_id,
        canonicalLabel: row.canonical_label,
        entityType: row.entity_type,
        factsAdded: 0,
        factsSkipped: 0,
        changesDetected: 0,
        wasUpdated: false,
      };
    }
  }

  // Step 2: Resolve against Wikidata
  const resolution = await resolveTermToWikidata(term);

  if (!resolution.wikidataId || resolution.resolutionConfidence < 0.3) {
    // Store failed resolution
    await pool.query(
      `INSERT INTO canonical_entities (entity_id, canonical_label, resolution_status, resolution_evidence)
       VALUES ($1, $2, 'failed', $3)
       ON CONFLICT (entity_id) DO UPDATE SET
         resolution_status = 'failed', updated_at = NOW()`,
      [crypto.createHash('sha256').update(term).digest('hex').slice(0, 16), term, resolution.resolutionEvidence]
    );
    return {
      candidateTerm: term,
      resolved: false,
      factsAdded: 0,
      factsSkipped: 0,
      changesDetected: 0,
      wasUpdated: false,
      error: 'Low confidence resolution',
    };
  }

  // Step 3: Fetch rich Wikidata entity
  const wikidata = await resolveWikidataEntity(resolution.wikidataId);

  // Step 4: Store canonical entity
  const entityId = crypto.createHash('sha256').update(wikidata.id).digest('hex').slice(0, 16);
  await pool.query(
    `INSERT INTO canonical_entities
       (entity_id, canonical_label, entity_type, wikidata_id, wikipedia_title,
        wikipedia_url, aliases, resolution_confidence, resolution_status,
        resolution_evidence, last_enriched_at, priority_score)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, 'resolved', $9, NOW(), $10)
     ON CONFLICT (wikidata_id) DO UPDATE SET
       canonical_label = $2, entity_type = $3, wikipedia_title = $5,
       wikipedia_url = $6, aliases = $7, resolution_confidence = $8,
       last_enriched_at = NOW(), priority_score = GREATEST(canonical_entities.priority_score, $10),
       updated_at = NOW()`,
    [
      entityId,
      wikidata.label,
      wikidata.entityType,
      wikidata.id,
      wikidata.wikipediaTitle || null,
      wikidata.wikipediaUrl || null,
      wikidata.aliases || [],
      resolution.resolutionConfidence,
      resolution.resolutionEvidence,
      candidate.authorityWeightedCount,
    ]
  );

  let factsAdded = 0;
  let changesDetected = 0;

  // Step 5: Store Wikidata facts
  for (const claim of wikidata.claims) {
    const hash = contentHash({ p: claim.property, v: claim.value });
    const fId = `ef_${entityId}_${claim.property}_${hash}`.slice(0, 80);

    const snapId = `es_${entityId}_wikidata_${wikidata.lastModified}`.slice(0, 80);
    // Ensure snapshot exists
    const snapHash = contentHash(wikidata.claims);
    await pool.query(
      `INSERT INTO encyclopedia_snapshots (snapshot_id, entity_id, source, language, revision_id, content_hash, raw_payload)
       VALUES ($1, $2, 'wikidata', 'en', $3, $4, $5::jsonb)
       ON CONFLICT (snapshot_id) DO NOTHING`,
      [snapId, entityId, wikidata.lastModified, snapHash, JSON.stringify({ claims: wikidata.claims })]
    );

    const result = await pool.query(
      `INSERT INTO encyclopedia_facts (fact_id, entity_id, property, value, value_entity_id, source_snapshot_id, confidence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (fact_id) DO NOTHING`,
      [fId, entityId, claim.propertyLabel, claim.value, claim.valueId || null, snapId, 0.85]
    );
    if (result.rowCount && result.rowCount > 0) factsAdded++;
  }

  // Step 6: Fetch Wikipedia article
  if (wikidata.wikipediaTitle) {
    try {
      const article = await fetchWikipediaArticle(wikidata.wikipediaTitle);

      // Update page info
      await pool.query(
        `UPDATE canonical_entities SET wikipedia_page_id = $2 WHERE entity_id = $1`,
        [entityId, article.pageId || null]
      );

      // Snapshot
      const revId = String(article.revisionId || article.lastRevisionTime);
      const snapId2 = `es_${entityId}_wikipedia_${revId}`.slice(0, 80);
      const wpHash = contentHash(article.extract);

      // Check previous snapshot for change detection
      const prevSnap = await pool.query(
        `SELECT content_hash, raw_payload FROM encyclopedia_snapshots
         WHERE entity_id = $1 AND source = 'wikipedia'
         ORDER BY retrieved_at DESC LIMIT 1`,
        [entityId]
      );

      const changedFields: string[] = [];
      if (prevSnap.rows.length > 0 && prevSnap.rows[0].content_hash !== wpHash) {
        const prevPayload = prevSnap.rows[0].raw_payload || {};
        if ((prevPayload.extract || '').slice(0, 200) !== article.extract.slice(0, 200)) {
          changedFields.push('extract');
        }
        changesDetected++;

        await pool.query(
          `INSERT INTO encyclopedia_changes
             (change_id, entity_id, change_type, property, detected_at, source_snapshot_id, significance, description)
           VALUES ($1, $2, 'modified', 'article_extract', NOW(), $3, 'medium', $4)`,
          [
            generateId('ech'),
            entityId,
            snapId2,
            `Wikipedia article updated for ${wikidata.label}`,
          ]
        );
      }

      await pool.query(
        `INSERT INTO encyclopedia_snapshots
           (snapshot_id, entity_id, source, language, revision_id, content_hash, changed_fields, raw_payload)
         VALUES ($1, $2, 'wikipedia', 'en', $3, $4, $5::text[], $6::jsonb)
         ON CONFLICT (snapshot_id) DO NOTHING`,
        [snapId2, entityId, revId, wpHash, changedFields,
          JSON.stringify({ extract: article.extract, sections: article.sections, categories: article.categories, infobox: article.infobox })]
      );

      // Store facts from infobox
      if (article.infobox) {
        for (const [key, value] of Object.entries(article.infobox)) {
          if (!value || key.length < 2) continue;
          const hash = contentHash({ k: key, v: value });
          const fId = `ef_${entityId}_${key.replace(/[^a-z0-9]/g, '_').slice(0, 30)}_${hash}`.slice(0, 80);
          const result = await pool.query(
            `INSERT INTO encyclopedia_facts (fact_id, entity_id, property, value, source_snapshot_id, confidence)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (fact_id) DO NOTHING`,
            [fId, entityId, `infobox:${key}`, value, snapId2, 0.7]
          );
          if (result.rowCount && result.rowCount > 0) factsAdded++;
        }
      }

      // Store categories as facts (taxonomy)
      for (const cat of article.categories.slice(0, 20)) {
        const hash = contentHash(cat);
        const fId = `ef_${entityId}_category_${hash}`.slice(0, 80);
        await pool.query(
          `INSERT INTO encyclopedia_facts (fact_id, entity_id, property, value, source_snapshot_id, confidence)
           VALUES ($1, $2, 'wikipedia_category', $3, $4, 0.75)
           ON CONFLICT (fact_id) DO NOTHING`,
          [fId, entityId, cat, snapId2]
        );
      }
    } catch (err: unknown) {
      console.warn(`[enrichment] Wikipedia fetch failed for ${wikidata.wikipediaTitle}:`, (err as Error).message);
    }
  }

  return {
    candidateTerm: term,
    resolved: true,
    wikidataId: wikidata.id,
    canonicalLabel: wikidata.label,
    entityType: wikidata.entityType,
    factsAdded,
    factsSkipped: 0,
    changesDetected,
    wasUpdated: true,
  };
}

export async function getEnrichmentStats(pool: Pool): Promise<{
  totalEntities: number;
  totalFacts: number;
  totalSnapshots: number;
  totalChanges: number;
  resolvedEntities: number;
  failedEntities: number;
  entitiesByType: Record<string, number>;
  recentRuns: Array<{ runId: string; startedAt: string; resolved: number; status: string }>;
  recentChanges: Array<{ entity: string; description: string; detectedAt: string; significance: string }>;
}> {
  await ensureEnrichmentSchema(pool);

  const [ent, facts, snaps, changes, byType, runs, recChanges] = await Promise.all([
    pool.query(`SELECT COUNT(*) as total FROM canonical_entities`),
    pool.query(`SELECT COUNT(*) as total FROM encyclopedia_facts`),
    pool.query(`SELECT COUNT(*) as total FROM encyclopedia_snapshots`),
    pool.query(`SELECT COUNT(*) as total FROM encyclopedia_changes`),
    pool.query(`SELECT entity_type, COUNT(*) as cnt FROM canonical_entities WHERE entity_type IS NOT NULL GROUP BY entity_type ORDER BY cnt DESC`),
    pool.query(`SELECT run_id, started_at, resolved, status FROM enrichment_runs ORDER BY started_at DESC LIMIT 5`),
    pool.query(
      `SELECT ce.canonical_label as entity, ec.description, ec.detected_at, ec.significance
       FROM encyclopedia_changes ec
       JOIN canonical_entities ce ON ce.entity_id = ec.entity_id
       ORDER BY ec.detected_at DESC LIMIT 20`
    ),
  ]);

  const entitiesByType: Record<string, number> = {};
  for (const row of byType.rows) {
    entitiesByType[row.entity_type || 'unknown'] = Number(row.cnt);
  }

  return {
    totalEntities: Number(ent.rows[0]?.total || 0),
    totalFacts: Number(facts.rows[0]?.total || 0),
    totalSnapshots: Number(snaps.rows[0]?.total || 0),
    totalChanges: Number(changes.rows[0]?.total || 0),
    resolvedEntities: Number(ent.rows[0]?.total || 0), // all stored are resolved or failed
    failedEntities: 0, // compute separately if needed
    entitiesByType,
    recentRuns: runs.rows.map((r: any) => ({
      runId: r.run_id,
      startedAt: r.started_at?.toISOString?.() || r.started_at,
      resolved: Number(r.resolved),
      status: r.status,
    })),
    recentChanges: recChanges.rows.map((r: any) => ({
      entity: r.entity,
      description: r.description,
      detectedAt: r.detected_at?.toISOString?.() || r.detected_at,
      significance: r.significance,
    })),
  };
}

export async function getEntityProfile(pool: Pool, entityIdOrName: string): Promise<any> {
  await ensureEnrichmentSchema(pool);

  const qidMatch = entityIdOrName.match(/^Q\d+$/i);
  let entity;
  if (qidMatch) {
    entity = await pool.query(
      `SELECT * FROM canonical_entities WHERE wikidata_id = $1`,
      [qidMatch[0].toUpperCase()]
    );
  } else {
    entity = await pool.query(
      `SELECT * FROM canonical_entities WHERE canonical_label ILIKE $1 OR $1 = ANY(aliases)`,
      [entityIdOrName]
    );
  }

  if (!entity.rows.length) return null;

  const e = entity.rows[0];
  const [facts, snapshots, changes] = await Promise.all([
    pool.query(`SELECT * FROM encyclopedia_facts WHERE entity_id = $1 ORDER BY property, value`, [e.entity_id]),
    pool.query(`SELECT * FROM encyclopedia_snapshots WHERE entity_id = $1 ORDER BY retrieved_at DESC`, [e.entity_id]),
    pool.query(`SELECT * FROM encyclopedia_changes WHERE entity_id = $1 ORDER BY detected_at DESC`, [e.entity_id]),
  ]);

  return {
    ...e,
    facts: facts.rows,
    snapshots: snapshots.rows,
    changes: changes.rows,
  };
}
