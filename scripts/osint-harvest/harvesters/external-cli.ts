/**
 * Optional external CLI bridge for ENNA tools installed on the host.
 * Supports: theHarvester (passive sources only), amass (passive enum).
 *
 * Does NOT wrap Social-Engineer Toolkit (SET) — SET is for authorized phishing
 * assessments, not investigative data harvest into Judicium.
 *
 * @see https://www.en-na.com/#tools
 * @see https://github.com/laramies/theHarvester
 * @see https://github.com/owasp-amass/amass
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { Harvester, HarvestFinding } from '../types.js';
import { normalizeDomain } from '../http.js';

function which(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('which', [bin]);
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
    child.on('error', () => resolve(null));
  });
}

function runCmd(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Timeout after ${timeoutMs}ms: ${cmd}`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
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

function parseEmailsAndHosts(text: string, domain: string): HarvestFinding[] {
  const findings: HarvestFinding[] = [];
  const emailRe = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const hostRe = new RegExp(
    `\\b(?:[a-zA-Z0-9-]+\\.)+${domain.replace(/\./g, '\\.')}\\b`,
    'gi',
  );
  const ipRe = /\b\d{1,3}(?:\.\d{1,3}){3}\b/g;

  for (const email of new Set(text.match(emailRe) || [])) {
    findings.push({
      source: 'theharvester',
      sourceId: `email:${email}`,
      entityType: 'email',
      value: email.toLowerCase(),
      label: email,
      title: `Email: ${email}`,
      confidence: 0.7,
      tags: ['theharvester', 'email', 'passive'],
      related: [{ type: 'domain', value: domain, relation: 'associated_with' }],
    });
  }
  for (const host of new Set((text.match(hostRe) || []).map((h) => h.toLowerCase()))) {
    findings.push({
      source: 'theharvester',
      sourceId: `host:${host}`,
      entityType: host === domain ? 'domain' : 'subdomain',
      value: host,
      label: host,
      title: `Host: ${host}`,
      confidence: 0.75,
      tags: ['theharvester', 'host', 'passive'],
    });
  }
  for (const ip of new Set(text.match(ipRe) || [])) {
    findings.push({
      source: 'theharvester',
      sourceId: `ip:${ip}`,
      entityType: 'ip',
      value: ip,
      label: ip,
      title: `IP: ${ip}`,
      confidence: 0.7,
      tags: ['theharvester', 'ip', 'passive'],
    });
  }
  return findings;
}

export const theHarvesterCli: Harvester = {
  id: 'theharvester',
  name: 'theHarvester (CLI)',
  description: 'Optional: run installed theHarvester with passive sources only',
  reference: 'https://github.com/laramies/theHarvester',

  async run(ctx) {
    const started = Date.now();
    const domain = normalizeDomain(ctx.target);
    const errors: string[] = [];
    const bin = (await which('theHarvester')) || (await which('theharvester'));
    if (!bin) {
      return {
        harvester: this.id,
        findings: [],
        errors: ['theHarvester not installed — skipping (pipx install theHarvester)'],
        durationMs: Date.now() - started,
      };
    }

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'judicium-th-'));
    const outBase = path.join(outDir, 'results');
    try {
      // -b all can hit paid APIs; stick to free passive sources
      const sources = process.env.THEHARVESTER_SOURCES || 'crtsh,dnsdumpster,hackertarget,urlscan,otx';
      const { stdout, stderr, code } = await runCmd(
        bin,
        ['-d', domain, '-b', sources, '-l', String(Math.min(ctx.maxResults, 200)), '-f', outBase],
        ctx.timeoutMs,
      );
      if (code !== 0 && !stdout) {
        errors.push(`theHarvester exit ${code}: ${stderr.slice(0, 300)}`);
      }

      let blob = stdout;
      for (const ext of ['.json', '.xml', '.txt']) {
        const p = outBase + ext;
        if (fs.existsSync(p)) blob += '\n' + fs.readFileSync(p, 'utf8');
      }

      const findings = parseEmailsAndHosts(blob, domain).slice(0, ctx.maxResults);
      return { harvester: this.id, findings, errors, durationMs: Date.now() - started };
    } catch (err) {
      errors.push(`theharvester: ${(err as Error).message}`);
      return { harvester: this.id, findings: [], errors, durationMs: Date.now() - started };
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  },
};

export const amassCli: Harvester = {
  id: 'amass',
  name: 'OWASP Amass (CLI)',
  description: 'Optional: passive subdomain enum via installed amass',
  reference: 'https://github.com/owasp-amass/amass',

  async run(ctx) {
    const started = Date.now();
    const domain = normalizeDomain(ctx.target);
    const errors: string[] = [];
    const bin = await which('amass');
    if (!bin) {
      return {
        harvester: this.id,
        findings: [],
        errors: ['amass not installed — skipping'],
        durationMs: Date.now() - started,
      };
    }

    try {
      const { stdout, stderr, code } = await runCmd(
        bin,
        ['enum', '-passive', '-d', domain, '-nocolor'],
        ctx.timeoutMs,
      );
      if (code !== 0 && !stdout) {
        errors.push(`amass exit ${code}: ${stderr.slice(0, 300)}`);
      }
      const hosts = [...new Set(
        stdout
          .split('\n')
          .map((l) => l.trim().toLowerCase())
          .filter((l) => l.endsWith(domain)),
      )].slice(0, ctx.maxResults);

      const findings: HarvestFinding[] = hosts.map((host) => ({
        source: 'amass',
        sourceId: host,
        entityType: host === domain ? 'domain' : 'subdomain',
        value: host,
        label: host,
        title: `Amass: ${host}`,
        confidence: 0.8,
        tags: ['amass', 'passive', 'subdomain'],
      }));

      return { harvester: this.id, findings, errors, durationMs: Date.now() - started };
    } catch (err) {
      errors.push(`amass: ${(err as Error).message}`);
      return { harvester: this.id, findings: [], errors, durationMs: Date.now() - started };
    }
  },
};
