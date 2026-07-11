/**
 * Target Registry input validation.
 */

import { COLLECTION_ASSET_TYPES } from './asset-types.js';
import { COLLECTION_POLICIES } from './policies.js';
import { COLLECTION_PROFILES, type CollectionProfileId } from './profiles.js';
import { COLLECTION_STRATEGIES } from './strategies.js';
import type { CollectionTargetInput } from './types.js';

export function validateTargetInput(
  input: CollectionTargetInput,
): { ok: true } | { ok: false; error: string } {
  if (!input.value?.trim()) {
    return { ok: false, error: 'value required' };
  }
  if (input.target_type && !COLLECTION_ASSET_TYPES.includes(input.target_type)) {
    return { ok: false, error: `invalid target_type: ${input.target_type}` };
  }
  if (input.collection_profile && !COLLECTION_PROFILES[input.collection_profile as CollectionProfileId]) {
    return { ok: false, error: `invalid collection_profile: ${input.collection_profile}` };
  }
  if (input.collection_policy && !COLLECTION_POLICIES[input.collection_policy]) {
    return { ok: false, error: `invalid collection_policy: ${input.collection_policy}` };
  }
  if (input.collection_strategy && !COLLECTION_STRATEGIES[input.collection_strategy]) {
    return { ok: false, error: `invalid collection_strategy: ${input.collection_strategy}` };
  }
  if (input.priority != null && (input.priority < 0 || input.priority > 100)) {
    return { ok: false, error: 'priority must be between 0 and 100' };
  }
  if (input.confidence != null && (input.confidence < 0 || input.confidence > 1)) {
    return { ok: false, error: 'confidence must be between 0 and 1' };
  }
  return { ok: true };
}
