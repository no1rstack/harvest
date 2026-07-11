import { describe, expect, it, beforeEach } from 'vitest';
import {
  resetOntologySnapshot,
  resolveEntityTypeId,
  resolveStixType,
  resolveRelationshipType,
  resolveObservableType,
} from '../src/intelligence/ontology/registry.js';
import { normalizeProviderData } from '../src/collection/stixNormalize.js';

describe('Intelligence Core Phase 0 — Ontology', () => {
  beforeEach(() => {
    resetOntologySnapshot();
  });

  it('resolves connector aliases to canonical entity types', () => {
    expect(resolveEntityTypeId('domain')).toBe('Domain');
    expect(resolveEntityTypeId('subdomain')).toBe('Hostname');
    expect(resolveEntityTypeId('dns_record')).toBe('Domain');
    expect(resolveEntityTypeId('organization')).toBe('Organization');
  });

  it('maps entity types to STIX via ontology', () => {
    expect(resolveStixType('domain', 'example.com').stix_type).toBe('domain-name');
    expect(resolveStixType('email', 'a@b.com').stix_type).toBe('email-addr');
    expect(resolveStixType('ip', '10.0.0.1').stix_type).toBe('ipv4-addr');
    expect(resolveStixType('ip', '2001:db8::1').stix_type).toBe('ipv6-addr');
    expect(resolveStixType('organization', 'Acme').stix_identity_class).toBe('organization');
  });

  it('resolves relationship types from connector labels', () => {
    expect(resolveRelationshipType('a-record')).toBe('resolves-to');
    expect(resolveRelationshipType('registrant')).toBe('owned-by');
    expect(resolveRelationshipType('subdomain')).toBe('discovers');
  });

  it('infers observable types from connector id', () => {
    expect(resolveObservableType('dns', 'domain')).toBe('dns.record');
    expect(resolveObservableType('crtsh', 'certificate')).toBe('crt.certificate');
  });
});

describe('stixNormalize uses ontology', () => {
  beforeEach(() => {
    resetOntologySnapshot();
  });

  it('normalizes provider findings with ontology entity types', () => {
    const observations = normalizeProviderData(
      [
        {
          source: 'dns',
          sourceId: 'a1',
          entityType: 'domain',
          value: 'noirstack.com',
        },
      ],
      { runId: 'run-1', targetId: 'tgt-1', targetValue: 'noirstack.com' },
    );
    expect(observations).toHaveLength(1);
    expect(observations[0].entity_type).toBe('Domain');
    expect(observations[0].stix_type).toBe('domain-name');
    expect(observations[0].observable_type).toBe('dns.record');
    expect(observations[0].ontology_version).toBe('1.0.0');
  });
});

describe('Phase 1 — artifact hashing', () => {
  it('hashPayload is deterministic', async () => {
    const { hashPayload } = await import('../src/intelligence/core/artifacts.js');
    expect(hashPayload({ a: 1 })).toBe(hashPayload({ a: 1 }));
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });
});
