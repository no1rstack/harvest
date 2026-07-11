/**
 * Collection Platform — shared infrastructure for Judicium, H3XA, HexSocial.
 * Replaces the narrow "Harvest" utility framing with a full maturity model.
 */

export const COLLECTION_PLATFORM_NAME = 'Collection Platform';
export const COLLECTION_PLATFORM_VERSION = '2.0';

/** Maturity levels — most OSINT tools stop at 2; OpenCTI ~4; target Level 6. */
export const PLATFORM_MATURITY_LEVELS = [
  { level: 1, name: 'Registry', description: 'Typed assets, strategies, dependencies' },
  { level: 2, name: 'Collection', description: 'Capability-driven workflow execution' },
  { level: 3, name: 'Observation', description: 'Immutable events, graph projections' },
  { level: 4, name: 'Correlation', description: 'Cross-source corroboration' },
  { level: 5, name: 'Discovery', description: 'Self-growing target registry' },
  { level: 6, name: 'Intelligence', description: 'Actionable insight across products' },
] as const;

export type PlatformMaturityLevel = (typeof PLATFORM_MATURITY_LEVELS)[number]['level'];
