/**
 * Workflow templates — backward-compatible facade over the Workflow Catalog.
 * @see workflow-catalog.ts for the data-driven source of truth.
 */

import type { CollectionTargetType } from './types.js';
import {
  getCatalogWorkflow,
  listCatalogWorkflows,
  normalizeWorkflowId,
  resolveWorkflowConnectors,
  defaultWorkflowForAssetType,
  type WorkflowCatalogEntry,
} from './workflow-catalog.js';
import { profileCapabilities } from './profiles.js';

export type CollectionWorkflowTemplate = WorkflowCatalogEntry & {
  /** @deprecated Legacy connector list — use resolveWorkflowConnectors */
  collectors: string[];
  default_frequency: 'hourly' | 'daily' | 'weekly';
};

function toLegacyTemplate(entry: WorkflowCatalogEntry): CollectionWorkflowTemplate {
  return {
    ...entry,
    collectors: resolveWorkflowConnectors(entry.id, profileCapabilities(entry.default_profile)),
    default_frequency: 'daily',
  };
}

export const COLLECTION_WORKFLOW_TEMPLATES: Record<string, CollectionWorkflowTemplate> =
  Object.fromEntries(
    listCatalogWorkflows().map((e) => [e.id, toLegacyTemplate(e)]),
  );

export function getWorkflowTemplate(id: string): CollectionWorkflowTemplate | undefined {
  const entry = getCatalogWorkflow(id);
  return entry ? toLegacyTemplate(entry) : undefined;
}

export function listWorkflowTemplates(): CollectionWorkflowTemplate[] {
  return listCatalogWorkflows().map(toLegacyTemplate);
}

export function collectorsForTarget(templateId: string, targetType: CollectionTargetType): string[] {
  const entry = getCatalogWorkflow(templateId);
  if (!entry) return [];
  if (!entry.target_types.includes(targetType) && targetType !== 'hostname') return [];
  return resolveWorkflowConnectors(entry.id, profileCapabilities(entry.default_profile));
}

export function defaultTemplateForAssetType(targetType: CollectionTargetType): string {
  return defaultWorkflowForAssetType(targetType);
}

export { normalizeWorkflowId };
