/**
 * H3XA Postgres schema — OASIS STIX 2.1 aligned.
 * Spec: https://docs.oasis-open.org/cti/stix/v2.1/os/stix-v2.1-os.html
 *
 * Industry mapping (your entities → STIX):
 *   Person / Organization → identity (identity_class)
 *   Domain               → domain-name (SCO)
 *   IP                   → ipv4-addr / ipv6-addr (SCO)
 *   Email                → email-addr (SCO)
 *   Phone                → x-h3xa-phone (custom SCO; STIX has no phone SCO)
 *   Username             → user-account (SCO)
 *   Event                → observed-data / report / indicator
 *   Document             → report (or artifact)
 *
 * OpenCTI, MISP (via STIX export), and IntelOwl ecosystems all speak STIX/TAXII.
 */

export const H3XA_STIX_SCHEMA_SQL = `
-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── STIX Domain / Cyber-observable Objects (SDOs + SCOs) ──
CREATE TABLE IF NOT EXISTS stix_objects (
  id TEXT PRIMARY KEY,                          -- e.g. domain-name--<uuid>
  type TEXT NOT NULL,                           -- STIX type: identity, domain-name, ipv4-addr, ...
  spec_version TEXT NOT NULL DEFAULT '2.1',
  created TIMESTAMPTZ,
  modified TIMESTAMPTZ,
  revoked BOOLEAN DEFAULT FALSE,
  confidence INTEGER,                           -- STIX 0-100
  name TEXT,                                    -- common display (identity.name, malware.name, …)
  value TEXT,                                   -- SCO value (domain, IP, email, …) normalized
  identity_class TEXT,                          -- individual | group | system | organization | class | unknown
  pattern TEXT,                                 -- indicator pattern
  pattern_type TEXT,
  object_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- full STIX object
  content_hash TEXT,                            -- for change detection
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stix_objects_type ON stix_objects(type);
CREATE INDEX IF NOT EXISTS idx_stix_objects_value ON stix_objects(value);
CREATE INDEX IF NOT EXISTS idx_stix_objects_name ON stix_objects(name);
CREATE INDEX IF NOT EXISTS idx_stix_objects_last_seen ON stix_objects(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_stix_objects_object_json ON stix_objects USING GIN (object_json);

-- Deterministic dedupe key for SCOs: type + normalized value
CREATE UNIQUE INDEX IF NOT EXISTS idx_stix_objects_type_value
  ON stix_objects(type, value)
  WHERE value IS NOT NULL AND type IN (
    'domain-name','ipv4-addr','ipv6-addr','email-addr','url',
    'user-account','mac-addr','autonomous-system','x-h3xa-phone','file'
  );

-- ── STIX Relationship Objects (SROs) ──
CREATE TABLE IF NOT EXISTS stix_relationships (
  id TEXT PRIMARY KEY,                          -- relationship--<uuid>
  relationship_type TEXT NOT NULL,              -- resolves-to, indicates, related-to, …
  source_ref TEXT NOT NULL REFERENCES stix_objects(id) ON DELETE CASCADE,
  target_ref TEXT NOT NULL REFERENCES stix_objects(id) ON DELETE CASCADE,
  description TEXT,
  start_time TIMESTAMPTZ,
  stop_time TIMESTAMPTZ,
  confidence INTEGER,
  object_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created TIMESTAMPTZ DEFAULT NOW(),
  modified TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (relationship_type, source_ref, target_ref)
);

CREATE INDEX IF NOT EXISTS idx_stix_rel_source ON stix_relationships(source_ref);
CREATE INDEX IF NOT EXISTS idx_stix_rel_target ON stix_relationships(target_ref);
CREATE INDEX IF NOT EXISTS idx_stix_rel_type ON stix_relationships(relationship_type);

-- ── External references (STIX common property) ──
CREATE TABLE IF NOT EXISTS stix_external_references (
  id BIGSERIAL PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES stix_objects(id) ON DELETE CASCADE,
  source_name TEXT NOT NULL,
  description TEXT,
  url TEXT,
  external_id TEXT,
  UNIQUE (object_id, source_name, external_id)
);

-- ── Multi-source observations (correlation / confidence) ──
-- Same STIX object seen from MISP + OpenCTI + IntelOwl + SpiderFoot
CREATE TABLE IF NOT EXISTS stix_object_sources (
  id BIGSERIAL PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES stix_objects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,                       -- misp | opencti | intelowl | spiderfoot | thehive
  native_id TEXT,                               -- platform-native id
  native_ref TEXT,                              -- URL / feed path
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb, -- source-specific attrs (for disagreement UI)
  confidence REAL,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (object_id, platform, native_id)
);

CREATE INDEX IF NOT EXISTS idx_stix_sources_platform ON stix_object_sources(platform);
CREATE INDEX IF NOT EXISTS idx_stix_sources_object ON stix_object_sources(object_id);

-- ── Ingest buffer (raw fusion cards before/alongside STIX normalize) ──
CREATE TABLE IF NOT EXISTS fusion_items (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT DEFAULT '',
  confidence REAL,
  tags_json JSONB DEFAULT '[]'::jsonb,
  link TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  content_hash TEXT,
  payload_json JSONB DEFAULT '{}'::jsonb,
  pulled_at TIMESTAMPTZ NOT NULL,
  stix_object_id TEXT REFERENCES stix_objects(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fusion_items_platform ON fusion_items(platform);
CREATE INDEX IF NOT EXISTS idx_fusion_items_last_seen ON fusion_items(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS fusion_cursors (
  connector TEXT NOT NULL,
  cursor_key TEXT NOT NULL,
  cursor_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (connector, cursor_key)
);

CREATE TABLE IF NOT EXISTS fusion_pull_status (
  connector TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ,
  last_ok_at TIMESTAMPTZ,
  last_error TEXT,
  last_collected INTEGER DEFAULT 0,
  last_persisted INTEGER DEFAULT 0,
  last_skipped INTEGER DEFAULT 0
);

-- ── Attribute history (source comparison / disagreement) ──
CREATE TABLE IF NOT EXISTS stix_attribute_history (
  id BIGSERIAL PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES stix_objects(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  attribute_key TEXT NOT NULL,                   -- e.g. country, whois_registrar
  attribute_value TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stix_attr_hist_object ON stix_attribute_history(object_id, attribute_key);
`;

/** Map analyst-facing entity labels → STIX 2.1 types */
export const ENTITY_TO_STIX: Record<string, { type: string; notes: string }> = {
  Person: { type: 'identity', notes: 'identity_class = individual' },
  Organization: { type: 'identity', notes: 'identity_class = organization' },
  Domain: { type: 'domain-name', notes: 'SCO value' },
  IP: { type: 'ipv4-addr', notes: 'or ipv6-addr' },
  Email: { type: 'email-addr', notes: 'SCO value' },
  Phone: { type: 'x-h3xa-phone', notes: 'STIX has no phone SCO — custom extension' },
  Username: { type: 'user-account', notes: 'SCO account_login / user_id' },
  Event: { type: 'observed-data', notes: 'or report / indicator for IOC events' },
  Document: { type: 'report', notes: 'or artifact for raw files' },
};

export const STIX_SCO_TYPES = [
  'domain-name',
  'ipv4-addr',
  'ipv6-addr',
  'email-addr',
  'url',
  'file',
  'user-account',
  'mac-addr',
  'autonomous-system',
  'x-h3xa-phone',
] as const;

export const STIX_SDO_TYPES = [
  'identity',
  'indicator',
  'observed-data',
  'malware',
  'threat-actor',
  'intrusion-set',
  'campaign',
  'attack-pattern',
  'vulnerability',
  'tool',
  'report',
  'note',
  'grouping',
] as const;
