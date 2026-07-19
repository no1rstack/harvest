/**
 * UNdata / UNSD — country and SDG statistical context (passive, keyless).
 * @see https://data.un.org/ @see https://data.un.org/ws
 */

import type { Harvester, HarvestFinding } from '../types.js';
import { fetchJson } from '../http.js';

const SDMX_REST = (process.env.UNDATA_SDMX_URL || 'https://data.un.org/ws/rest').replace(/\/$/, '');
const SDG_API = (process.env.UNSD_SDG_API_URL || 'https://unstats.un.org/SDGAPI/v1').replace(/\/$/, '');

export const undataHarvester: Harvester = {
  id: 'undata',
  name: 'UNdata / UNSD SDG',
  description: 'UN statistical dataflows (SDMX) and SDG goals matching the target keyword/country',
  reference: 'https://data.un.org/ws',

  async run(ctx) {
    const started = Date.now();
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];
    const q = ctx.target.trim();

    try {
      const data = await fetchJson<{
        data?: { dataflows?: Array<{ id?: string; name?: string; agencyID?: string; version?: string }> };
      }>(`${SDMX_REST}/dataflow/all/all/latest`, {
        timeoutMs: ctx.timeoutMs,
        userAgent: ctx.userAgent,
        headers: { Accept: 'application/vnd.sdmx.structure+json;version=1.0' },
        breakerName: 'data.un.org',
      });
      const ql = q.toLowerCase();
      const flows = (data.data?.dataflows || [])
        .filter((f) => {
          const hay = `${f.id} ${f.name} ${f.agencyID}`.toLowerCase();
          return !ql || hay.includes(ql) || ql.split(/\s+/).some((t) => t && hay.includes(t));
        })
        .slice(0, Math.min(ctx.maxResults, 25));

      for (const f of flows) {
        const id = String(f.id || '');
        findings.push({
          source: 'undata',
          sourceId: id,
          entityType: 'custom',
          value: id,
          label: String(f.name || id),
          title: `UNdata: ${f.name || id}`,
          description: `SDMX dataflow ${id} (${f.agencyID || 'UN'})`,
          confidence: 0.8,
          tags: ['undata', 'sdmx', 'statistics', String(f.agencyID || 'UN').toLowerCase()],
          raw: f as unknown as Record<string, unknown>,
        });
      }
    } catch (err) {
      errors.push(`undata-sdmx: ${(err as Error).message}`);
    }

    try {
      const goals = await fetchJson<
        Array<{ code?: string; title?: string; description?: string }>
      >(`${SDG_API}/sdg/Goal/List?includechildren=false`, {
        timeoutMs: ctx.timeoutMs,
        userAgent: ctx.userAgent,
        breakerName: 'unstats.un.org',
      });
      const ql = q.toLowerCase();
      for (const g of goals || []) {
        if (findings.length >= ctx.maxResults) break;
        const hay = `${g.code} ${g.title} ${g.description}`.toLowerCase();
        if (ql && !(hay.includes(ql) || ql.split(/\s+/).some((t) => t && hay.includes(t)))) continue;
        findings.push({
          source: 'undata',
          sourceId: `sdg-goal-${g.code}`,
          entityType: 'custom',
          value: String(g.code || ''),
          label: `SDG ${g.code}: ${g.title}`,
          title: `UNSD SDG Goal ${g.code}`,
          description: String(g.description || g.title || '').slice(0, 500),
          confidence: 0.85,
          tags: ['undata', 'sdg', 'unsd'],
          raw: g as unknown as Record<string, unknown>,
        });
      }
    } catch (err) {
      errors.push(`undata-sdg: ${(err as Error).message}`);
    }

    findings.push({
      source: 'undata',
      sourceId: `explorer:${q}`,
      entityType: 'url',
      value: 'https://data.un.org/',
      label: 'UNdata Explorer',
      title: `UNdata portal for "${q}"`,
      description: 'Browse UN statistical tables; SDMX WS at https://data.un.org/ws',
      confidence: 0.7,
      tags: ['undata', 'portal'],
      raw: { query: q, ws: 'https://data.un.org/ws' },
    });

    return {
      harvester: this.id,
      findings: findings.slice(0, ctx.maxResults),
      errors,
      durationMs: Date.now() - started,
    };
  },
};
