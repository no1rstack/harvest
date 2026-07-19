/**
 * APTnotes + OpenSky harvesters for Collection Platform.
 * @see https://github.com/aptnotes/data
 * @see https://opensky-network.org/
 */

import type { Harvester, HarvestFinding } from '../types.js';
import { fetchJson } from '../http.js';

const APTNOTES_URL =
  process.env.APTNOTES_JSON_URL ||
  'https://raw.githubusercontent.com/aptnotes/data/master/APTnotes.json';

type AptNote = {
  Filename?: string;
  Title?: string;
  Source?: string;
  Link?: string;
  'SHA-1'?: string;
  Date?: string;
  Year?: string;
};

export const aptnotesHarvester: Harvester = {
  id: 'aptnotes',
  name: 'APTnotes',
  description: 'Public APT campaign report index (GitHub JSON)',
  reference: 'https://github.com/aptnotes/data',
  async run(ctx) {
    const started = Date.now();
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];
    const q = ctx.target.toLowerCase().trim();
    try {
      const rows = await fetchJson<AptNote[]>(APTNOTES_URL, {
        timeoutMs: ctx.timeoutMs,
        userAgent: ctx.userAgent,
        breakerName: 'raw.githubusercontent.com',
      });
      const list = Array.isArray(rows) ? rows : [];
      for (const r of list) {
        if (findings.length >= ctx.maxResults) break;
        const hay = `${r.Title} ${r.Source} ${r.Filename} ${r.Year}`.toLowerCase();
        if (q && !(hay.includes(q) || q.split(/\s+/).some((t) => t && hay.includes(t)))) continue;
        findings.push({
          source: 'aptnotes',
          sourceId: String(r['SHA-1'] || r.Filename || r.Title).slice(0, 80),
          entityType: 'custom',
          value: String(r.Link || r.Title || ''),
          label: String(r.Title || r.Filename),
          title: `APTnotes: ${r.Title}`,
          description: `${r.Source || ''} · ${r.Year || r.Date || ''}`.trim(),
          confidence: 0.85,
          tags: ['aptnotes', 'apt', 'threat-report', String(r.Year || '')],
          raw: r as unknown as Record<string, unknown>,
        });
      }
    } catch (err) {
      errors.push(`aptnotes: ${(err as Error).message}`);
    }
    return { harvester: this.id, findings, errors, durationMs: Date.now() - started };
  },
};

export const openskyHarvester: Harvester = {
  id: 'opensky',
  name: 'OpenSky Network',
  description: 'Live ADS-B states filtered by callsign/ICAO24',
  reference: 'https://opensky-network.org/',
  async run(ctx) {
    const started = Date.now();
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];
    const q = ctx.target.toLowerCase().trim();
    try {
      const data = await fetchJson<{ states?: unknown[][] }>(
        'https://opensky-network.org/api/states/all',
        {
          timeoutMs: Math.max(ctx.timeoutMs, 25000),
          userAgent: ctx.userAgent,
          breakerName: 'opensky-network.org',
        },
      );
      for (const s of data.states || []) {
        if (findings.length >= ctx.maxResults) break;
        const icao = String(s[0] || '');
        const callsign = String(s[1] || '').trim();
        const hay = `${icao} ${callsign}`.toLowerCase();
        if (q && !hay.includes(q)) continue;
        findings.push({
          source: 'opensky',
          sourceId: icao,
          entityType: 'custom',
          value: callsign || icao,
          label: callsign || icao,
          title: `OpenSky ${callsign || icao}`,
          description: `lat=${s[6]} lon=${s[5]} alt=${s[7]} country=${s[2]}`,
          confidence: 0.85,
          tags: ['opensky', 'adsb', 'aviation'],
          raw: {
            icao24: icao,
            callsign,
            origin_country: s[2],
            lon: s[5],
            lat: s[6],
            baro_altitude: s[7],
            velocity: s[9],
            true_track: s[10],
          },
        });
      }
      if (!findings.length) {
        findings.push({
          source: 'opensky',
          sourceId: `portal:${ctx.target}`,
          entityType: 'url',
          value: 'https://opensky-network.org/',
          label: 'OpenSky Network',
          title: `No live match for "${ctx.target}"`,
          description: 'Try ICAO24 hex or callsign as target; commercial trackers: FR24 / FlightAware',
          confidence: 0.5,
          tags: ['opensky', 'portal'],
        });
      }
    } catch (err) {
      errors.push(`opensky: ${(err as Error).message}`);
    }
    return { harvester: this.id, findings, errors, durationMs: Date.now() - started };
  },
};
