/**
 * Post collection findings to Judicium /api/v1 so the workbench receives Harvest output.
 * Best-effort: skipped when JUDICIUM_URL + service token are unset.
 */

import type { Pool } from 'pg';
import { createHash } from 'crypto';

const MAX_EVIDENCE = 100;

export type JudiciumBridgeResult = {
  skipped?: boolean;
  reason?: string;
  investigation_id?: string;
  submitted: number;
  errors: number;
};

function judiciumBaseUrl(): string {
  return (
    process.env.JUDICIUM_INTERNAL_URL ||
    process.env.JUDICIUM_URL ||
    process.env.JUDICIUM_PUBLIC_URL ||
    ''
  ).replace(/\/$/, '');
}

function judiciumToken(): string {
  return (
    process.env.JUDICIUM_SERVICE_TOKEN ||
    process.env.JUDICIUM_API_KEY ||
    ''
  ).trim();
}

export async function bridgeWorkflowRunToJudicium(
  pool: Pool,
  opts: {
    workflowRunId: string;
    targetId: string;
    targetValue: string;
    caseId?: number | null;
  },
): Promise<JudiciumBridgeResult> {
  const base = judiciumBaseUrl();
  const token = judiciumToken();
  if (!base || !token) {
    return {
      skipped: true,
      reason: 'JUDICIUM_URL/INTERNAL_URL or JUDICIUM_SERVICE_TOKEN unset',
      submitted: 0,
      errors: 0,
    };
  }

  const investigationId =
    opts.caseId != null && opts.caseId > 0
      ? String(opts.caseId)
      : `harvest:${opts.targetId || opts.workflowRunId}`;

  const obsRows = await pool.query(
    `SELECT id, source, source_id, entity_type, value, label, title, description,
            severity, confidence, tags, related, raw
     FROM osint_harvest_findings
     WHERE workflow_run_id = $1 AND target_id = $2
     ORDER BY observed_at DESC NULLS LAST
     LIMIT $3`,
    [opts.workflowRunId, opts.targetId, MAX_EVIDENCE],
  );

  let submitted = 0;
  let errors = 0;

  for (const row of obsRows.rows) {
    const source = String(row.source || 'harvest');
    const sourceId = String(row.source_id || row.id || '');
    const value = String(row.value || '');
    const claim =
      String(row.title || row.label || `${source}: ${value}`).slice(0, 2000) ||
      `Harvest observation for ${opts.targetValue}`;
    const hash = createHash('sha256')
      .update(`${source}|${sourceId}|${value}|${opts.workflowRunId}`)
      .digest('hex');

    const payload = {
      investigation_id: investigationId,
      type: 'document',
      content_ref: `harvest://${source}/${opts.workflowRunId}/${sourceId || row.id}`,
      hash,
      submitted_by: 'harvest-collection',
      metadata: {
        source,
        sourceId,
        scanId: opts.workflowRunId,
        findingType: row.entity_type || 'custom',
        severity: row.severity || 'info',
        confidence: typeof row.confidence === 'number' ? row.confidence : 0.75,
        entities: [
          {
            type: row.entity_type || 'custom',
            value,
            label: row.label || value,
          },
        ],
        relationships: [],
        tags: Array.isArray(row.tags) ? row.tags : ['harvest', source],
        provenance: {
          harvestTargetId: opts.targetId,
          harvestTarget: opts.targetValue,
          workflowRunId: opts.workflowRunId,
        },
        raw: row.raw || null,
        description: row.description || null,
      },
    };

    try {
      const res = await fetch(`${base}/api/v1/evidence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        errors += 1;
        continue;
      }
      submitted += 1;
    } catch {
      errors += 1;
    }
  }

  return {
    investigation_id: investigationId,
    submitted,
    errors,
  };
}
