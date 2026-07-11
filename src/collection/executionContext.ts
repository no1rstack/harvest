import crypto from 'crypto';

/**
 * Execution linkage between Cascades workflow runs and Harvest observations.
 */

export const COLLECTION_WORKFLOW_VERSION = '1.0';
export const CONNECTOR_VERSION = '1.0';

export interface CollectionExecutionContext {
  workflow_template: string;
  workflow_version: string;
  workflow_run_id: string;
  node_id: string;
  connector_id?: string;
  request_id: string;
  target_id?: string;
  collection_event_id?: string;
}

export function parseExecutionContext(body: Record<string, unknown>): CollectionExecutionContext | undefined {
  const raw = body.execution as Record<string, unknown> | undefined;
  if (!raw?.workflow_run_id || !raw?.node_id) return undefined;
  return {
    workflow_template: String(raw.workflow_template || 'passive-domain-collection'),
    workflow_version: String(raw.workflow_version || COLLECTION_WORKFLOW_VERSION),
    workflow_run_id: String(raw.workflow_run_id),
    node_id: String(raw.node_id),
    connector_id: raw.connector_id ? String(raw.connector_id) : undefined,
    request_id: String(raw.request_id || ''),
    target_id: raw.target_id ? String(raw.target_id) : undefined,
    collection_event_id: raw.collection_event_id ? String(raw.collection_event_id) : undefined,
  };
}

export function buildExecutionContext(
  partial: Partial<CollectionExecutionContext> & Pick<CollectionExecutionContext, 'workflow_run_id' | 'node_id'>,
): CollectionExecutionContext {
  return {
    workflow_template: partial.workflow_template || 'passive-domain-collection',
    workflow_version: partial.workflow_version || COLLECTION_WORKFLOW_VERSION,
    workflow_run_id: partial.workflow_run_id,
    node_id: partial.node_id,
    connector_id: partial.connector_id,
    request_id: partial.request_id || crypto.randomUUID(),
    target_id: partial.target_id,
    collection_event_id: partial.collection_event_id,
  };
}

export type CollectionTerminalStatus =
  | 'completed'
  | 'completed_with_warnings'
  | 'failed'
  | 'cancelled';

export function deriveTerminalStatus(opts: {
  persistFailed?: boolean;
  inserted?: number;
  connectorErrors?: string[];
  connectorFailures?: number;
}): CollectionTerminalStatus {
  if (opts.persistFailed) return 'failed';
  const errors = opts.connectorErrors?.length ?? 0;
  const failures = opts.connectorFailures ?? 0;
  if (failures > 0 && (opts.inserted ?? 0) === 0 && errors > 0) return 'failed';
  if (errors > 0 || failures > 0) return 'completed_with_warnings';
  return 'completed';
}
