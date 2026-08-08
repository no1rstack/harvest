export type CatalogCategory =
  | 'knowledge'
  | 'collections'
  | 'intelligence'
  | 'community'
  | 'ontology'
  | 'execution'
  | 'system'
  | 'schema-bleed';

export type CatalogOwner = 'harvest' | 'judicium' | 'h3xa' | 'cascades' | 'shared';
export type CatalogLifecycle = 'active' | 'inactive' | 'schema-bleed' | 'planned';
export type CatalogHeat = 'healthy' | 'append-only' | 'update-heavy' | 'unused' | 'needs-attention';

export interface TableRegistryEntry {
  table: string;
  category: CatalogCategory;
  owner: CatalogOwner;
  lifecycle: CatalogLifecycle;
  purpose: string;
  service?: string;
  apis?: string[];
  canDelete: boolean;
  canArchive: boolean;
  canPartition: boolean;
  references?: string[];
  referencedBy?: string[];
}

/** Human-readable documentation — see src/data-catalog/narratives.ts */
export interface TableNarrative {
  purpose: string;
  purposeDetail: string;
  whyItExists: string;
  consumers?: string[];
  produces?: string[];
  generatedBy?: string[];
}

export interface LineageStep {
  id: string;
  label: string;
  table?: string;
  owner?: CatalogOwner | 'judicium-ui';
  kind: 'source' | 'process' | 'store' | 'consumer';
  description?: string;
}

export interface DataLineageView {
  journey: {
    id: string;
    title: string;
    subtitle: string;
    steps: LineageStep[];
  };
  highlightStepId: string;
  highlightIndex: number;
}

export interface TableLiveStats {
  rows: number;
  deadRows: number;
  sizeBytes: number;
  sizePretty: string;
  seqScan: number;
  idxScan: number;
  idxPct: number;
  inserts: number;
  updates: number;
  deletes: number;
  heat: CatalogHeat;
  growthToday?: number | null;
  growthPct?: number | null;
}

export interface CatalogTableCard {
  database: string;
  databaseLabel: string;
  table: string;
  registry: TableRegistryEntry;
  live: TableLiveStats | null;
  statusLabel: string;
}

export interface CatalogDatabaseSummary {
  id: string;
  label: string;
  owner: string;
  connected: boolean;
  tableCount: number;
  totalRows: number;
  totalSizePretty: string;
  error?: string;
}

export interface PipelineNode {
  id: string;
  label: string;
  owner: CatalogOwner;
  tables: string[];
  description: string;
}

export interface PipelineEdge {
  from: string;
  to: string;
  label?: string;
}

export interface CatalogSnapshot {
  capturedAt: string;
  databases: Record<string, Record<string, number>>;
}

export interface LivingArchitectureSummary {
  growing: CatalogTableCard[];
  idle: CatalogTableCard[];
  expensive: CatalogTableCard[];
  duplicated: Array<{ table: string; databases: string[] }>;
  orphaned: CatalogTableCard[];
  sharedSchema: CatalogTableCard[];
  needsAttention: CatalogTableCard[];
}

export interface DataCatalogResponse {
  generatedAt: string;
  databases: CatalogDatabaseSummary[];
  categories: Record<CatalogCategory, CatalogTableCard[]>;
  tables: CatalogTableCard[];
  pipeline: { nodes: PipelineNode[]; edges: PipelineEdge[] };
  living: LivingArchitectureSummary;
  cascades?: {
    connected: boolean;
    url?: string;
    health?: unknown;
    error?: string;
    workflowCount?: number;
    workflows?: Array<{
      id: string;
      name: string;
      description?: string;
      status?: string;
      version?: number;
      createdAt?: string;
      updatedAt?: string;
    }>;
  };
  events?: Array<{
    id: string;
    event_type: string;
    aggregate_type?: string;
    aggregate_id?: string;
    created_at: string;
    payload?: unknown;
  }>;
}
