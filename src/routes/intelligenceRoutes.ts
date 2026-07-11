/**
 * Intelligence API v1 — products consume capabilities, not core tables directly.
 */

import type { Express, Request, Response } from 'express';
import { getHarvestPool } from '../db/harvestPostgres.js';
import { getOntologySnapshot, hydrateOntologyFromPool } from '../intelligence/ontology/registry.js';
import { getProvenanceChain } from '../intelligence/core/provenance.js';
import { graphNeighbors } from '../intelligence/capabilities/graph-engine.js';
import { listDomainEvents } from '../intelligence/core/domain-events.js';
import { ensureIntelligenceCoreSchema } from '../intelligence/core/collections.js';
import { resolveIdentityForAnchor, resolveIdentityForCollection } from '../intelligence/capabilities/identity-engine.js';
import {
  getKnowledgeObject,
  listKnowledgeObjects,
  synthesizeCollectionSummary,
  synthesizeNetwork,
  synthesizeProfile,
} from '../intelligence/capabilities/knowledge-engine.js';
import { exportCollectionAsStix } from '../intelligence/capabilities/stix-export.js';
import { createClaim, getClaim, listClaims, updateClaimStatus } from '../intelligence/core/claims.js';
import { runAutomationForCollection } from '../intelligence/capabilities/automation-engine.js';

function poolOr503(res: Response) {
  const pool = getHarvestPool();
  if (!pool) {
    res.status(503).json({ error: 'HARVEST_DATABASE_URL not configured' });
    return null;
  }
  return pool;
}

export function registerIntelligenceRoutes(app: Express): void {
  app.get('/api/intelligence/v1/ontology', async (_req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      await hydrateOntologyFromPool(pool);
      const snap = getOntologySnapshot();
      res.json({
        version: snap.version,
        entity_types: [...snap.entity_types.values()],
        observable_types: [...snap.observable_types.values()],
        relationship_types: [...snap.relationship_types.values()],
        knowledge_types: [...snap.knowledge_types.values()],
      });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/collections/:id', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      await ensureIntelligenceCoreSchema(pool);
      const r = await pool.query(`SELECT * FROM collections WHERE id = $1`, [req.params.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'collection not found' });

      const stats = await pool.query(
        `SELECT
          (SELECT COUNT(*)::int FROM source_artifacts WHERE collection_id = $1) AS artifacts,
          (SELECT COUNT(*)::int FROM extraction_runs WHERE collection_id = $1) AS extractions,
          (SELECT COUNT(*)::int FROM osint_harvest_findings WHERE collection_id = $1) AS observations,
          (SELECT COUNT(*)::int FROM observed_entities WHERE collection_id = $1) AS observed_entities,
          (SELECT COUNT(*)::int FROM collection_relationships WHERE collection_id = $1) AS relationships,
          (SELECT COUNT(*)::int FROM domain_events WHERE collection_id = $1) AS domain_events,
          (SELECT COUNT(*)::int FROM knowledge_objects WHERE collection_id = $1) AS knowledge_objects,
          (SELECT COUNT(*)::int FROM resolved_entities WHERE collection_id = $1 OR collection_id IN (
            SELECT id FROM collections WHERE parent_id = $1
          )) AS resolved_entities`,
        [req.params.id],
      );

      res.json({ collection: r.rows[0], stats: stats.rows[0] });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/collections/:id/artifacts', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const limit = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
      const r = await pool.query(
        `SELECT id, connector_id, source_id, observable_type, payload_hash, ontology_version, created_at
         FROM source_artifacts WHERE collection_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [req.params.id, limit],
      );
      res.json({ artifacts: r.rows, count: r.rowCount });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/observations', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const where: string[] = [];
      const params: unknown[] = [];

      if (req.query.collection_id) {
        params.push(String(req.query.collection_id));
        where.push(`collection_id = $${params.length}`);
      }
      if (req.query.value) {
        params.push(String(req.query.value));
        where.push(`value ILIKE $${params.length}`);
      }
      if (req.query.entity_type) {
        params.push(String(req.query.entity_type));
        where.push(`entity_type = $${params.length}`);
      }

      params.push(Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 500));
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

      const r = await pool.query(
        `SELECT id, collection_id, entity_type, observable_type, value, stix_id, stix_type,
                source, confidence, source_artifact_id, extraction_run_id, provenance_id,
                observed_at, created_at
         FROM osint_harvest_findings ${whereSql}
         ORDER BY created_at DESC LIMIT $${params.length}`,
        params,
      );
      res.json({ observations: r.rows, count: r.rowCount });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/observed-entities/:id', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const r = await pool.query(`SELECT * FROM observed_entities WHERE id = $1`, [req.params.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'observed entity not found' });
      res.json({ observed_entity: r.rows[0] });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/graph/neighbors', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const slice = await graphNeighbors(pool, {
        value: req.query.value ? String(req.query.value) : undefined,
        stix_id: req.query.stix_id ? String(req.query.stix_id) : undefined,
        observation_id: req.query.observation_id ? String(req.query.observation_id) : undefined,
        depth: parseInt(String(req.query.depth || '1'), 10) || 1,
        relationship_origin: req.query.origin ? String(req.query.origin) : undefined,
        limit: parseInt(String(req.query.limit || '100'), 10) || 100,
      });
      res.json(slice);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/provenance/:id/chain', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const chain = await getProvenanceChain(pool, req.params.id);
      if (!chain.length) return res.status(404).json({ error: 'provenance not found' });
      res.json({ chain });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/events', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const events = await listDomainEvents(pool, {
        collection_id: req.query.collection_id ? String(req.query.collection_id) : undefined,
        event_type: req.query.event_type ? String(req.query.event_type) : undefined,
        limit: parseInt(String(req.query.limit || '50'), 10) || 50,
      });
      res.json({ events, count: events.length });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Identity Engine ──
  app.post('/api/intelligence/v1/identity/resolve', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      await ensureIntelligenceCoreSchema(pool);
      const collectionId = String(req.body?.collection_id || '').trim();
      const anchorValue = req.body?.anchor_value ? String(req.body.anchor_value) : undefined;
      if (!collectionId && !anchorValue) {
        return res.status(400).json({ error: 'collection_id or anchor_value required' });
      }
      const result = anchorValue && !collectionId
        ? await resolveIdentityForAnchor(pool, anchorValue)
        : [await resolveIdentityForCollection(pool, { source_collection_id: collectionId, anchor_value: anchorValue })];
      res.json({ results: result });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/resolved-entities/:id', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const re = await pool.query(`SELECT * FROM resolved_entities WHERE id = $1`, [req.params.id]);
      if (!re.rowCount) return res.status(404).json({ error: 'not found' });
      const members = await pool.query(
        `SELECT rem.*, oe.entity_type, oe.canonical_value, oe.stix_id
         FROM resolved_entity_members rem
         JOIN observed_entities oe ON oe.id = rem.observed_entity_id
         WHERE rem.resolved_entity_id = $1`,
        [req.params.id],
      );
      res.json({ resolved_entity: re.rows[0], members: members.rows });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Knowledge Engine ──
  app.get('/api/intelligence/v1/knowledge', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const items = await listKnowledgeObjects(pool, {
        kind: req.query.kind ? String(req.query.kind) : undefined,
        collection_id: req.query.collection_id ? String(req.query.collection_id) : undefined,
        limit: parseInt(String(req.query.limit || '50'), 10) || 50,
      });
      res.json({ knowledge_objects: items, count: items.length });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/knowledge/:id', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const ko = await getKnowledgeObject(pool, req.params.id);
      if (!ko) return res.status(404).json({ error: 'not found' });
      const refs = await pool.query(
        `SELECT * FROM knowledge_object_refs WHERE knowledge_object_id = $1`,
        [req.params.id],
      );
      res.json({ knowledge_object: ko, refs: refs.rows });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/collections/:id/summary', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const ko = await synthesizeCollectionSummary(pool, req.params.id);
      res.json({ knowledge_object: ko });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/intelligence/v1/networks', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const anchor = String(req.body?.anchor_value || req.body?.value || '').trim();
      if (!anchor) return res.status(400).json({ error: 'anchor_value required' });
      const ko = await synthesizeNetwork(pool, {
        anchor_value: anchor,
        collection_id: req.body?.collection_id,
        depth: req.body?.depth,
      });
      res.json({ knowledge_object: ko });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/profiles/:anchor', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const ko = await synthesizeProfile(pool, {
        anchor_value: decodeURIComponent(req.params.anchor),
        collection_id: req.query.collection_id ? String(req.query.collection_id) : undefined,
      });
      if (!ko) return res.status(404).json({ error: 'no resolved entity for anchor' });
      res.json({ knowledge_object: ko });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── STIX export (interop projection) ──
  app.get('/api/intelligence/v1/collections/:id/export/stix', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const bundle = await exportCollectionAsStix(pool, req.params.id);
      res.json(bundle);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Claims (investigation reasoning) ──
  app.get('/api/intelligence/v1/claims', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const claims = await listClaims(pool, {
        case_id: req.query.case_id ? parseInt(String(req.query.case_id), 10) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
      });
      res.json({ claims, count: claims.length });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post('/api/intelligence/v1/claims', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const statement = String(req.body?.statement || '').trim();
      if (!statement) return res.status(400).json({ error: 'statement required' });
      const claim = await createClaim(pool, {
        statement,
        case_id: req.body?.case_id,
        created_by: req.body?.created_by,
        observation_ids: req.body?.observation_ids,
        provenance_ids: req.body?.provenance_ids,
      });
      res.status(201).json({ claim });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/claims/:id', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const detail = await getClaim(pool, req.params.id);
      if (!detail) return res.status(404).json({ error: 'not found' });
      res.json(detail);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/claims/:id/provenance', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const detail = await getClaim(pool, req.params.id);
      if (!detail) return res.status(404).json({ error: 'not found' });
      res.json({ claim_id: req.params.id, provenance: detail.provenance });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.patch('/api/intelligence/v1/claims/:id', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const status = String(req.body?.status || '').trim();
      if (!status) return res.status(400).json({ error: 'status required' });
      const claim = await updateClaimStatus(pool, req.params.id, status);
      if (!claim) return res.status(404).json({ error: 'not found' });
      res.json({ claim });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Automation ──
  app.post('/api/intelligence/v1/collections/:id/automation/run', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const outcomes = await runAutomationForCollection(pool, req.params.id, req.body || {});
      res.json({ outcomes });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Phase 3: Reasoning Engine ──
  app.post('/api/intelligence/v1/claims/:id/evaluate', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const { evaluateClaim } = await import('../intelligence/capabilities/reasoning-engine.js');
      const assessment = await evaluateClaim(pool, req.params.id);
      res.json({ assessment });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/claims/:id/assessment', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const { getLatestAssessment } = await import('../intelligence/capabilities/reasoning-engine.js');
      const assessment = await getLatestAssessment(pool, req.params.id);
      if (!assessment) return res.status(404).json({ error: 'no assessment yet' });
      res.json({ assessment });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Phase 3: Evidence bundles ──
  app.post('/api/intelligence/v1/evidence', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const { createEvidenceBundle } = await import('../intelligence/core/evidence.js');
      const title = String(req.body?.title || 'Evidence bundle').trim();
      const claimId = String(req.body?.claim_id || '').trim();
      if (!claimId) return res.status(400).json({ error: 'claim_id required' });
      const bundle = await createEvidenceBundle(pool, {
        title,
        claim_id: claimId,
        case_id: req.body?.case_id,
        created_by: req.body?.created_by,
      });
      res.status(201).json({ evidence_bundle: bundle });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/evidence', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const { listEvidenceBundles } = await import('../intelligence/core/evidence.js');
      const bundles = await listEvidenceBundles(pool, {
        case_id: req.query.case_id ? parseInt(String(req.query.case_id), 10) : undefined,
        claim_id: req.query.claim_id ? String(req.query.claim_id) : undefined,
      });
      res.json({ evidence_bundles: bundles, count: bundles.length });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/evidence/:id', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const { getEvidenceBundle } = await import('../intelligence/core/evidence.js');
      const detail = await getEvidenceBundle(pool, req.params.id);
      if (!detail) return res.status(404).json({ error: 'not found' });
      res.json(detail);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Phase 3: Identity v2 ──
  app.post('/api/intelligence/v1/identity/resolve-v2', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const collectionId = String(req.body?.collection_id || '').trim();
      const anchorValue = String(req.body?.anchor_value || '').trim();
      if (!collectionId || !anchorValue) {
        return res.status(400).json({ error: 'collection_id and anchor_value required' });
      }
      const { resolveIdentityGraphV2 } = await import('../intelligence/capabilities/identity-engine-v2.js');
      const result = await resolveIdentityGraphV2(pool, {
        source_collection_id: collectionId,
        anchor_value: anchorValue,
      });
      res.json({ result });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── Phase 3: Read models ──
  app.post('/api/intelligence/v1/read-models/refresh', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const { refreshReadModels } = await import('../intelligence/core/read-models.js');
      const result = await refreshReadModels(pool);
      res.json(result);
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/dashboard/targets', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const r = await pool.query(`SELECT * FROM rm_target_dashboard ORDER BY observations DESC LIMIT 50`);
      res.json({ targets: r.rows, count: r.rowCount });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/dashboard/targets/:value', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const { getTargetDashboard } = await import('../intelligence/core/read-models.js');
      const dash = await getTargetDashboard(pool, decodeURIComponent(req.params.value));
      if (!dash) return res.status(404).json({ error: 'not found' });
      res.json({ dashboard: dash });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/api/intelligence/v1/dashboard/entities', async (req, res) => {
    try {
      const pool = poolOr503(res);
      if (!pool) return;
      const { listEntityIndex } = await import('../intelligence/core/read-models.js');
      const entities = await listEntityIndex(pool, {
        entity_type: req.query.entity_type ? String(req.query.entity_type) : undefined,
        limit: parseInt(String(req.query.limit || '100'), 10) || 100,
      });
      res.json({ entities, count: entities.length });
    } catch (err: unknown) {
      res.status(500).json({ error: (err as Error).message });
    }
  });
}
