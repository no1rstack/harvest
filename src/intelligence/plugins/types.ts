/**
 * Intelligence Core plugin contracts — register capabilities without modifying core.
 */

import type { Pool } from 'pg';
import type { OntologyEntityType, OntologyKnowledgeType, OntologyObservableType, OntologyRelationshipType } from '../ontology/types.js';

export interface ConnectorPlugin {
  id: string;
  registerObservableTypes(): OntologyObservableType[];
}

export interface OntologyPlugin {
  id: string;
  version: string;
  registerEntityTypes(): OntologyEntityType[];
  registerEntityAliases(): Record<string, string>;
  registerRelationshipTypes(): OntologyRelationshipType[];
  registerKnowledgeTypes(): OntologyKnowledgeType[];
}

export interface IdentityPlugin {
  id: string;
  /** Future: registerIdentityRules() */
}

export interface KnowledgePlugin {
  id: string;
  /** Future: registerKnowledgeBuilders() */
}

export interface AutomationPlugin {
  id: string;
  /** Future: registerEventHandlers() */
}

export interface ExportPlugin {
  id: string;
  /** Future: registerExporters() — STIX, MISP, etc. */
}

export interface IntelligencePlugin {
  id: string;
  ontology?: OntologyPlugin;
  connector?: ConnectorPlugin;
  identity?: IdentityPlugin;
  knowledge?: KnowledgePlugin;
  automation?: AutomationPlugin;
  export?: ExportPlugin;
}

const registeredPlugins: IntelligencePlugin[] = [];

export function registerIntelligencePlugin(plugin: IntelligencePlugin): void {
  if (registeredPlugins.some((p) => p.id === plugin.id)) return;
  registeredPlugins.push(plugin);
}

export function listIntelligencePlugins(): IntelligencePlugin[] {
  return [...registeredPlugins];
}

/** Apply plugin ontology extensions to DB (after base v1 seed). */
export async function applyOntologyPlugins(pool: Pool, version: string): Promise<number> {
  let applied = 0;
  for (const plugin of registeredPlugins) {
    if (!plugin.ontology) continue;
    for (const et of plugin.ontology.registerEntityTypes()) {
      await pool.query(
        `INSERT INTO ontology_entity_types
          (version_id, id, label, stix_type, stix_identity_class, identifiers)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb)
         ON CONFLICT (version_id, id) DO NOTHING`,
        [version, et.id, et.label, et.stix_type, et.stix_identity_class, JSON.stringify(et.identifiers)],
      );
      applied++;
    }
    for (const [alias, entity_type_id] of Object.entries(plugin.ontology.registerEntityAliases())) {
      await pool.query(
        `INSERT INTO ontology_entity_aliases (version_id, alias, entity_type_id) VALUES ($1,$2,$3)
         ON CONFLICT (version_id, alias) DO NOTHING`,
        [version, alias.toLowerCase(), entity_type_id],
      );
    }
  }
  return applied;
}
