/**
 * ENNA identity harvesters — Holehe / Sherlock / Maigret via host CLI.
 * Soft-skip when binaries are missing (same pattern as theHarvester/amass).
 *
 * @see https://www.en-na.com/workflows/osint-investigation
 * @see https://www.en-na.com/tool/sherlock
 * @see https://www.en-na.com/tool/maigret
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Harvester, HarvestFinding } from '../types.js';

function which(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('which', [bin]);
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    child.on('error', () => resolve(null));
  });
}

function runCmd(
  cmd: string,
  args: string[],
  timeoutMs: number,
  cwd?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: process.env, cwd });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Timeout after ${timeoutMs}ms: ${cmd}`));
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

function normalizeHandle(v: string): string {
  return v.trim().replace(/^@/, '');
}

function parseSherlockStdout(stdout: string, seed: string): HarvestFinding[] {
  const findings: HarvestFinding[] = [];
  for (const line of stripAnsi(stdout).split('\n')) {
    const m = line.match(/^\[\+\]\s+(.+?):\s+(https?:\/\/\S+)/);
    if (!m) continue;
    const platform = m[1].trim();
    const url = m[2].trim();
    findings.push({
      source: 'sherlock',
      sourceId: `sherlock:${platform}:${seed}`,
      entityType: 'url',
      value: url,
      label: `${platform} · ${seed}`,
      title: `Sherlock: ${platform}`,
      description: `Username claimed on ${platform}`,
      confidence: 0.82,
      tags: ['sherlock', 'username', 'enna', 'identity'],
      related: [
        { type: 'username', value: seed, relation: 'associated_with' },
        { type: 'person', value: seed, relation: 'discovers' },
      ],
      raw: { platform, url },
    });
  }
  return findings;
}

function parseSherlockCsv(csv: string, seed: string): HarvestFinding[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const iName = idx('name');
  const iUrl = Math.max(idx('url_user'), idx('url_main'));
  const iExists = idx('exists');
  const findings: HarvestFinding[] = [];

  for (const line of lines.slice(1)) {
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === ',' && !inQ) {
        cols.push(cur);
        cur = '';
        continue;
      }
      cur += ch;
    }
    cols.push(cur);
    const exists = (cols[iExists] || '').trim();
    if (exists && exists !== 'Claimed') continue;
    const site = (cols[iName] || '').trim();
    const url = (cols[iUrl] || '').trim();
    if (!site && !url) continue;
    findings.push({
      source: 'sherlock',
      sourceId: `sherlock:${site}:${seed}`,
      entityType: 'url',
      value: url || `https://${site.toLowerCase()}/${seed}`,
      label: `${site} · ${seed}`,
      title: `Sherlock: ${site}`,
      confidence: 0.82,
      tags: ['sherlock', 'username', 'enna', 'identity'],
      related: [
        { type: 'username', value: seed, relation: 'associated_with' },
        { type: 'person', value: seed, relation: 'discovers' },
      ],
      raw: { site, exists },
    });
  }
  return findings;
}

function parseMaigretJson(raw: string, seed: string): HarvestFinding[] {
  let data: Record<string, any>;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const findings: HarvestFinding[] = [];
  for (const [siteName, entry] of Object.entries(data || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const status = (entry as any).status;
    const statusStr = typeof status === 'object' ? status?.status : status;
    if (String(statusStr || '').toLowerCase() !== 'claimed') continue;
    const url =
      (entry as any).url_user || status?.url || (entry as any).url_main || undefined;
    if (!url) continue;
    findings.push({
      source: 'maigret',
      sourceId: `maigret:${siteName}:${seed}`,
      entityType: 'url',
      value: String(url),
      label: `${siteName} · ${seed}`,
      title: `Maigret: ${siteName}`,
      confidence: 0.85,
      tags: ['maigret', 'username', 'enna', 'identity'],
      related: [
        { type: 'username', value: seed, relation: 'associated_with' },
        { type: 'person', value: seed, relation: 'discovers' },
      ],
      raw: { site: siteName, ids: status?.ids },
    });
  }
  return findings;
}

function parseHoleheStdout(stdout: string, email: string): HarvestFinding[] {
  const findings: HarvestFinding[] = [];
  for (const line of stripAnsi(stdout).split('\n')) {
    const m = line.match(/^\[([+x\-])\]\s+(\S+)/);
    if (!m || line.includes('Email used')) continue;
    if (m[1] !== '+') continue;
    const site = m[2].replace(/\/$/, '');
    findings.push({
      source: 'holehe',
      sourceId: `holehe:${site}:${email}`,
      entityType: 'email',
      value: email,
      label: `${site} · ${email}`,
      title: `Holehe: ${site}`,
      description: `Email registered on ${site}`,
      confidence: 0.88,
      tags: ['holehe', 'email', 'enna', 'identity'],
      related: [
        { type: 'username', value: email.split('@')[0], relation: 'discovers' },
        { type: 'person', value: email.split('@')[0], relation: 'discovers' },
        ...(site.includes('.')
          ? [{ type: 'domain', value: site.replace(/^https?:\/\//i, '').split('/')[0], relation: 'from_source' }]
          : []),
      ],
      raw: { site, email },
    });
  }
  return findings;
}

export const holeheHarvester: Harvester = {
  id: 'holehe',
  name: 'Holehe (CLI)',
  description: 'ENNA: check which sites an email is registered on (password-reset probes)',
  reference: 'https://github.com/megadose/holehe',

  async run(ctx) {
    const started = Date.now();
    const email = ctx.target.trim();
    if (!looksLikeEmail(email)) {
      return {
        harvester: this.id,
        findings: [],
        errors: [`holehe expects an email target, got: ${email.slice(0, 80)}`],
        durationMs: Date.now() - started,
      };
    }

    const bin = await which('holehe');
    if (!bin) {
      return {
        harvester: this.id,
        findings: [],
        errors: ['holehe not installed — skipping (pipx install holehe)'],
        durationMs: Date.now() - started,
      };
    }

    try {
      const { stdout, stderr, code } = await runCmd(
        bin,
        [email, '--only-used', '--no-color'],
        Math.max(ctx.timeoutMs, 120_000),
      );
      const findings = parseHoleheStdout(stdout, email).slice(0, ctx.maxResults);
      const errors: string[] = [];
      if (code !== 0 && !findings.length) {
        errors.push(`holehe exit ${code}: ${stderr.slice(0, 300)}`);
      }
      return { harvester: this.id, findings, errors, durationMs: Date.now() - started };
    } catch (err) {
      return {
        harvester: this.id,
        findings: [],
        errors: [`holehe: ${(err as Error).message}`],
        durationMs: Date.now() - started,
      };
    }
  },
};

export const sherlockHarvester: Harvester = {
  id: 'sherlock',
  name: 'Sherlock (CLI)',
  description: 'ENNA: username presence across social networks',
  reference: 'https://github.com/sherlock-project/sherlock',

  async run(ctx) {
    const started = Date.now();
    const handle = normalizeHandle(ctx.target);
    if (!handle || looksLikeEmail(handle)) {
      return {
        harvester: this.id,
        findings: [],
        errors: [`sherlock expects a username target, got: ${ctx.target.slice(0, 80)}`],
        durationMs: Date.now() - started,
      };
    }

    const bin = (await which('sherlock')) || (await which('sherlock-project'));
    if (!bin) {
      return {
        harvester: this.id,
        findings: [],
        errors: ['sherlock not installed — skipping (pipx install sherlock-project)'],
        durationMs: Date.now() - started,
      };
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-sherlock-'));
    try {
      const siteArgs: string[] = [];
      const siteEnv = process.env.HARVEST_SHERLOCK_SITES || process.env.HEXSOCIAL_SHERLOCK_SITES;
      if (siteEnv && siteEnv !== 'all') {
        for (const s of siteEnv.split(',').map((x) => x.trim()).filter(Boolean)) {
          siteArgs.push('--site', s);
        }
      } else if (siteEnv !== 'all') {
        for (const s of [
          'GitHub',
          'GitLab',
          'Reddit',
          'Twitter',
          'Instagram',
          'TikTok',
          'Steam',
          'Spotify',
          'Twitch',
          'YouTube',
          'Keybase',
          'Docker Hub',
          'PyPi',
          'npm',
        ]) {
          siteArgs.push('--site', s);
        }
      }

      const { stdout, stderr, code } = await runCmd(
        bin,
        [handle, '--print-found', '--no-color', '--timeout', '12', '--csv', ...siteArgs],
        Math.max(ctx.timeoutMs, 150_000),
        dir,
      );

      let findings: HarvestFinding[] = [];
      const csvPath = path.join(dir, `${handle}.csv`);
      if (fs.existsSync(csvPath)) {
        findings = parseSherlockCsv(fs.readFileSync(csvPath, 'utf8'), handle);
      }
      if (!findings.length) findings = parseSherlockStdout(stdout, handle);
      findings = findings.slice(0, ctx.maxResults);

      const errors: string[] = [];
      if (code !== 0 && !findings.length) {
        errors.push(`sherlock exit ${code}: ${stderr.slice(0, 300)}`);
      }
      return { harvester: this.id, findings, errors, durationMs: Date.now() - started };
    } catch (err) {
      return {
        harvester: this.id,
        findings: [],
        errors: [`sherlock: ${(err as Error).message}`],
        durationMs: Date.now() - started,
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
};

export const maigretHarvester: Harvester = {
  id: 'maigret',
  name: 'Maigret (CLI)',
  description: 'ENNA: deep username OSINT across 2500+ sites',
  reference: 'https://github.com/soxoj/maigret',

  async run(ctx) {
    const started = Date.now();
    const handle = normalizeHandle(ctx.target);
    if (!handle || looksLikeEmail(handle)) {
      return {
        harvester: this.id,
        findings: [],
        errors: [`maigret expects a username target, got: ${ctx.target.slice(0, 80)}`],
        durationMs: Date.now() - started,
      };
    }

    const bin = await which('maigret');
    if (!bin) {
      return {
        harvester: this.id,
        findings: [],
        errors: ['maigret not installed — skipping (pipx install maigret)'],
        durationMs: Date.now() - started,
      };
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-maigret-'));
    try {
      const top = process.env.HARVEST_MAIGRET_TOP_SITES || process.env.HEXSOCIAL_MAIGRET_TOP_SITES || '40';
      const { stdout, stderr, code } = await runCmd(
        bin,
        [
          handle,
          '--timeout',
          '10',
          '--retries',
          '0',
          '--top-sites',
          top,
          '--no-autoupdate',
          '--no-color',
          '-J',
          'simple',
          '--folderoutput',
          dir,
        ],
        Math.max(ctx.timeoutMs, 180_000),
      );

      let findings: HarvestFinding[] = [];
      const jsonPath = path.join(dir, `report_${handle}_simple.json`);
      if (fs.existsSync(jsonPath)) {
        findings = parseMaigretJson(fs.readFileSync(jsonPath, 'utf8'), handle);
      }
      if (!findings.length) {
        for (const line of stripAnsi(stdout).split('\n')) {
          const m = line.match(/^\[\+\]\s+(.+?):\s+(https?:\/\/\S+)/);
          if (!m) continue;
          findings.push({
            source: 'maigret',
            sourceId: `maigret:${m[1]}:${handle}`,
            entityType: 'url',
            value: m[2],
            label: `${m[1]} · ${handle}`,
            title: `Maigret: ${m[1]}`,
            confidence: 0.8,
            tags: ['maigret', 'username', 'enna', 'identity'],
            related: [
              { type: 'username', value: handle, relation: 'associated_with' },
              { type: 'person', value: handle, relation: 'discovers' },
            ],
          });
        }
      }
      findings = findings.slice(0, ctx.maxResults);

      const errors: string[] = [];
      if (code !== 0 && !findings.length) {
        errors.push(`maigret exit ${code}: ${stderr.slice(0, 300)}`);
      }
      return { harvester: this.id, findings, errors, durationMs: Date.now() - started };
    } catch (err) {
      return {
        harvester: this.id,
        findings: [],
        errors: [`maigret: ${(err as Error).message}`],
        durationMs: Date.now() - started,
      };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
};
