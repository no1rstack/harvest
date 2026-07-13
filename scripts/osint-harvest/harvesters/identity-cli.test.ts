/**
 * Smoke tests for ENNA identity CLI parsers (no live binary required).
 */
import { describe, it, expect } from 'vitest';
import { holeheHarvester, sherlockHarvester, maigretHarvester } from '../harvesters/identity-cli.js';

describe('identity connectors registry', () => {
  it('exports holehe, sherlock, maigret ids', () => {
    expect(holeheHarvester.id).toBe('holehe');
    expect(sherlockHarvester.id).toBe('sherlock');
    expect(maigretHarvester.id).toBe('maigret');
  });

  it('holehe rejects non-email targets', async () => {
    const r = await holeheHarvester.run({
      target: 'not-an-email',
      userId: 'test',
      maxResults: 10,
      timeoutMs: 1000,
      userAgent: 'test',
    });
    expect(r.findings).toHaveLength(0);
    expect(r.errors[0]).toMatch(/expects an email/i);
  });

  it('sherlock rejects email targets', async () => {
    const r = await sherlockHarvester.run({
      target: 'a@b.com',
      userId: 'test',
      maxResults: 10,
      timeoutMs: 1000,
      userAgent: 'test',
    });
    expect(r.findings).toHaveLength(0);
    expect(r.errors[0]).toMatch(/expects a username/i);
  });
});
