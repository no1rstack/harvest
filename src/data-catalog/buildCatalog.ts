import {
  collectDatabaseStats,
  fetchCascadesHealth,
  fetchDomainEvents,
  getDatabaseConfigs,
  loadSnapshots,
  priorRowCounts,
  sampleTableRows,
  saveSnapshot,
} from './collector.js';
import { inferRegistry, PIPELINE_EDGES, PIPELINE_NODES, statusLabel, TABLE_REGISTRY } from './registry.js';
import { getLineageForTable, getNarrativeForTable, defaultNarrative } from './narratives.js';
import type { CatalogCategory, CatalogTableCard, DataCatalogResponse, LivingArchitectureSummary, TableNarrative } from './types.js';

const CATEGORY_ORDER: CatalogCategory[] = [
  'knowledge', 'collections', 'intelligence', 'community', 'ontology', 'execution', 'system', 'schema-bleed',
];

function emptyCategories(): Record<CatalogCategory, CatalogTableCard[]> {
  return { knowledge: [], collections: [], intelligence: [], community: [], ontology: [], execution: [], system: [], 'schema-bleed': [] };
}

function buildLiving(cards: CatalogTableCard[]): LivingArchitectureSummary {
  const byTable = new Map<string, string[]>();
  for (const c of cards) {
    if (c.live && c.live.rows > 0) {
      const list = byTable.get(c.table) || [];
      list.push(c.database);
      byTable.set(c.table, list);
    }
  }
  return {
    growing: [...cards].filter((c) => (c.live?.growthToday ?? 0) > 0).sort((a, b) => (b.live?.growthToday ?? 0) - (a.live?.growthToday ?? 0)).slice(0, 12),
    idle: cards.filter((c) => c.live?.heat === 'unused'),
    expensive: [...cards].filter((c) => c.live).sort((a, b) => (b.live?.sizeBytes ?? 0) - (a.live?.sizeBytes ?? 0)).slice(0, 12),
    duplicated: [...byTable.entries()].filter(([, d]) => d.length > 1).map(([table, databases]) => ({ table, databases })),
    orphaned: cards.filter((c) => c.live?.rows === 0 && !TABLE_REGISTRY[c.table]),
    sharedSchema: cards.filter((c) => c.registry.category === 'schema-bleed'),
    needsAttention: cards.filter((c) => c.live?.heat === 'needs-attention'),
  };
}

export async function buildDataCatalog(): Promise<DataCatalogResponse> {
  const snapshots = loadSnapshots();
  const configs = getDatabaseConfigs();
  const categories = emptyCategories();
  const allCards: CatalogTableCard[] = [];
  const dbSummaries = [];
  const snapshotPayload: Record<string, Record<string, number>> = {};

  for (const config of configs) {
    const stats = await collectDatabaseStats(config, priorRowCounts(snapshots, config.id));
    const rowMap: Record<string, number> = {};
    let totalRows = 0;
    let totalBytes = 0;
    for (const { table, live } of stats.tables) {
      rowMap[table] = live.rows;
      totalRows += live.rows;
      totalBytes += live.sizeBytes;
      const registry = inferRegistry(table, config.id);
      const card: CatalogTableCard = { database: config.id, databaseLabel: config.label, table, registry, live, statusLabel: statusLabel(registry, live.rows, config.id) };
      categories[registry.category].push(card);
      allCards.push(card);
    }
    snapshotPayload[config.id] = rowMap;
    dbSummaries.push({
      id: config.id, label: config.label, owner: config.owner, connected: stats.connected,
      tableCount: stats.tables.length, totalRows,
      totalSizePretty: totalBytes < 1024 * 1024 ? `${(totalBytes / 1024).toFixed(1)} KB` : `${(totalBytes / (1024 * 1024)).toFixed(1)} MB`,
      error: stats.error,
    });
  }
  saveSnapshot(snapshots, snapshotPayload);
  for (const cat of CATEGORY_ORDER) categories[cat].sort((a, b) => (b.live?.rows ?? 0) - (a.live?.rows ?? 0));
  const harvestUrl = configs.find((c) => c.id === 'harvest')?.url;
  const [cascades, events] = await Promise.all([fetchCascadesHealth(), harvestUrl ? fetchDomainEvents(harvestUrl) : Promise.resolve([])]);
  return { generatedAt: new Date().toISOString(), databases: dbSummaries, categories, tables: allCards, pipeline: { nodes: PIPELINE_NODES, edges: PIPELINE_EDGES }, living: buildLiving(allCards), cascades, events };
}

export async function getTableDetail(databaseId: string, table: string) {
  const config = getDatabaseConfigs().find((c) => c.id === databaseId);
  if (!config) return { error: 'Unknown database' };
  const registry = inferRegistry(table, databaseId);
  const stats = await collectDatabaseStats(config);
  const live = stats.tables.find((t) => t.table === table)?.live ?? null;
  const narrative: TableNarrative =
    getNarrativeForTable(table) ?? defaultNarrative(table, registry.purpose, registry.owner);
  const lineage = getLineageForTable(table);
  return {
    database: config,
    table,
    registry,
    narrative,
    lineage,
    live,
    statusLabel: statusLabel(registry, live?.rows ?? 0, databaseId),
    sample: await sampleTableRows(config, table),
  };
}
