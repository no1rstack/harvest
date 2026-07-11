/**
 * RDAP / WHOIS registration data (passive).
 * ENNA category: recon / WHOIS
 * Upstream: https://rdap.org bootstrap via rdap.org / IANA
 */

import type { Harvester, HarvestFinding } from '../types.js';
import { fetchJson, normalizeDomain, isIp } from '../http.js';

interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown[];
  handle?: string;
  publicIds?: Array<{ type?: string; identifier?: string }>;
}

interface RdapResponse {
  objectClassName?: string;
  handle?: string;
  ldhName?: string;
  name?: string;
  entities?: RdapEntity[];
  events?: Array<{ eventAction?: string; eventDate?: string }>;
  status?: string[];
  nameservers?: Array<{ ldhName?: string }>;
  links?: Array<{ href?: string; rel?: string }>;
  errorCode?: number;
  title?: string;
}

function extractVcardFn(entity: RdapEntity): string | undefined {
  const vcard = entity.vcardArray;
  if (!Array.isArray(vcard) || vcard.length < 2) return undefined;
  const props = vcard[1];
  if (!Array.isArray(props)) return undefined;
  for (const row of props) {
    if (Array.isArray(row) && row[0] === 'fn' && typeof row[3] === 'string') {
      return row[3];
    }
    if (Array.isArray(row) && row[0] === 'email' && typeof row[3] === 'string') {
      return row[3];
    }
  }
  return undefined;
}

function extractEmails(entity: RdapEntity): string[] {
  const emails: string[] = [];
  const vcard = entity.vcardArray;
  if (!Array.isArray(vcard) || vcard.length < 2) return emails;
  const props = vcard[1];
  if (!Array.isArray(props)) return emails;
  for (const row of props) {
    if (Array.isArray(row) && row[0] === 'email' && typeof row[3] === 'string') {
      emails.push(row[3]);
    }
  }
  return emails;
}

export const rdapHarvester: Harvester = {
  id: 'rdap',
  name: 'RDAP Registration',
  description: 'Domain/IP registration metadata via public RDAP',
  reference: 'https://about.rdap.org/',

  async run(ctx) {
    const started = Date.now();
    const target = normalizeDomain(ctx.target);
    const findings: HarvestFinding[] = [];
    const errors: string[] = [];

    const url = isIp(target)
      ? `https://rdap.org/ip/${encodeURIComponent(target)}`
      : `https://rdap.org/domain/${encodeURIComponent(target)}`;

    try {
      const data = await fetchJson<RdapResponse>(url, {
        timeoutMs: ctx.timeoutMs,
        userAgent: ctx.userAgent,
      });

      if (data.errorCode) {
        errors.push(`rdap: ${data.title || data.errorCode}`);
        return { harvester: this.id, findings, errors, durationMs: Date.now() - started };
      }

      findings.push({
        source: 'rdap',
        sourceId: data.handle || target,
        entityType: 'whois',
        value: data.ldhName || data.name || target,
        label: data.ldhName || data.name || target,
        title: `RDAP: ${data.ldhName || data.name || target}`,
        description: `Status: ${(data.status || []).join(', ') || 'n/a'}`,
        confidence: 0.9,
        tags: ['rdap', 'whois', 'passive'],
        raw: data as unknown as Record<string, unknown>,
      });

      for (const ns of data.nameservers || []) {
        if (!ns.ldhName) continue;
        findings.push({
          source: 'rdap',
          sourceId: `ns:${ns.ldhName}`,
          entityType: 'dns_record',
          value: ns.ldhName.toLowerCase(),
          label: `NS ${ns.ldhName}`,
          title: `Nameserver: ${ns.ldhName}`,
          confidence: 0.9,
          tags: ['rdap', 'nameserver'],
          related: [{ type: 'domain', value: target, relation: 'nameserver_of' }],
        });
      }

      for (const entity of data.entities || []) {
        const name = extractVcardFn(entity);
        const roles = (entity.roles || []).join(',');
        if (name) {
          const isEmail = name.includes('@');
          findings.push({
            source: 'rdap',
            sourceId: entity.handle || `${roles}:${name}`,
            entityType: isEmail
              ? 'email'
              : roles.includes('registrant') || roles.includes('registrar')
                ? 'organization'
                : 'person',
            value: name,
            label: name,
            title: `RDAP ${roles || 'contact'}: ${name}`,
            confidence: 0.75,
            tags: ['rdap', ...(entity.roles || [])],
            related: [{ type: 'domain', value: target, relation: 'registered_by' }],
            raw: { handle: entity.handle, roles: entity.roles },
          });
        }
        for (const email of extractEmails(entity)) {
          findings.push({
            source: 'rdap',
            sourceId: `email:${email}`,
            entityType: 'email',
            value: email.toLowerCase(),
            label: email,
            title: `RDAP email: ${email}`,
            confidence: 0.8,
            tags: ['rdap', 'email', ...(entity.roles || [])],
            related: [{ type: 'domain', value: target, relation: 'contact_for' }],
          });
        }
      }

      for (const ev of data.events || []) {
        if (!ev.eventAction || !ev.eventDate) continue;
        findings.push({
          source: 'rdap',
          sourceId: `event:${ev.eventAction}:${ev.eventDate}`,
          entityType: 'custom',
          value: `${ev.eventAction}@${ev.eventDate}`,
          label: `${ev.eventAction} ${ev.eventDate}`,
          title: `RDAP event: ${ev.eventAction}`,
          confidence: 0.9,
          tags: ['rdap', 'lifecycle'],
          observedAt: ev.eventDate,
          related: [{ type: 'domain', value: target, relation: 'has_event' }],
        });
      }
    } catch (err) {
      errors.push(`rdap: ${(err as Error).message}`);
    }

    return {
      harvester: this.id,
      findings: findings.slice(0, ctx.maxResults),
      errors,
      durationMs: Date.now() - started,
    };
  },
};
