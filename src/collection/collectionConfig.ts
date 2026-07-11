/**
 * Runtime Collection Platform config — readable without process restart.
 * Env vars seed defaults; internal API can override in memory.
 */

export interface CollectionRuntimeConfig {
  observation_batch_size: number;
  max_step_body_bytes: number;
  connector_max_retries: number;
  step_http_timeout_ms: number;
  breaker_error_threshold_pct: number;
  breaker_reset_timeout_ms: number;
}

const DEFAULTS: CollectionRuntimeConfig = {
  observation_batch_size: 500,
  max_step_body_bytes: 1024 * 1024,
  connector_max_retries: 3,
  step_http_timeout_ms: 120000,
  breaker_error_threshold_pct: 50,
  breaker_reset_timeout_ms: 30000,
};

let runtime: CollectionRuntimeConfig = {
  observation_batch_size:
    parseInt(process.env.COLLECTION_OBSERVATION_BATCH_SIZE || '', 10) || DEFAULTS.observation_batch_size,
  max_step_body_bytes:
    parseInt(process.env.COLLECTION_MAX_STEP_BODY_BYTES || '', 10) || DEFAULTS.max_step_body_bytes,
  connector_max_retries:
    parseInt(process.env.COLLECTION_CONNECTOR_MAX_RETRIES || '', 10) || DEFAULTS.connector_max_retries,
  step_http_timeout_ms:
    parseInt(process.env.COLLECTION_STEP_HTTP_TIMEOUT_MS || '', 10) || DEFAULTS.step_http_timeout_ms,
  breaker_error_threshold_pct:
    parseInt(process.env.COLLECTION_BREAKER_ERROR_THRESHOLD_PCT || '', 10) ||
    DEFAULTS.breaker_error_threshold_pct,
  breaker_reset_timeout_ms:
    parseInt(process.env.COLLECTION_BREAKER_RESET_TIMEOUT_MS || '', 10) ||
    DEFAULTS.breaker_reset_timeout_ms,
};

export function getCollectionConfig(): CollectionRuntimeConfig {
  return { ...runtime };
}

export function setCollectionConfig(partial: Partial<CollectionRuntimeConfig>): CollectionRuntimeConfig {
  if (partial.observation_batch_size != null) {
    runtime.observation_batch_size = Math.max(1, Math.min(5000, partial.observation_batch_size));
  }
  if (partial.max_step_body_bytes != null) {
    runtime.max_step_body_bytes = Math.max(64 * 1024, Math.min(10 * 1024 * 1024, partial.max_step_body_bytes));
  }
  if (partial.connector_max_retries != null) {
    runtime.connector_max_retries = Math.max(0, Math.min(10, partial.connector_max_retries));
  }
  if (partial.step_http_timeout_ms != null) {
    runtime.step_http_timeout_ms = Math.max(5000, Math.min(300000, partial.step_http_timeout_ms));
  }
  if (partial.breaker_error_threshold_pct != null) {
    runtime.breaker_error_threshold_pct = Math.max(10, Math.min(95, partial.breaker_error_threshold_pct));
  }
  if (partial.breaker_reset_timeout_ms != null) {
    runtime.breaker_reset_timeout_ms = Math.max(5000, Math.min(300000, partial.breaker_reset_timeout_ms));
  }
  return getCollectionConfig();
}

export function observationBatchSize(): number {
  return getCollectionConfig().observation_batch_size;
}
