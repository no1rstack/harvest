/**
 * Harvest platform modules — explicit service contracts for cross-product integration.
 */

export type HarvestModuleId = 'community-feeds' | 'collection' | 'intelligence';

export type ModuleServiceKind = 'api' | 'worker' | 'store' | 'scheduler';

export interface ModuleServiceEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  /** Judicium proxy path when consumed via workbench */
  judiciumProxyPath?: string;
  auth?: 'public' | 'session' | 'collection-token' | 'internal';
}

export interface ModuleConsumerObligation {
  /** Product id e.g. judicium */
  consumer: string;
  role: 'read' | 'write' | 'admin';
  mustNot?: string[];
  mustUse?: string[];
}

export interface HarvestModuleContract {
  id: HarvestModuleId;
  version: string;
  name: string;
  description: string;
  owner: 'harvest';
  store: {
    database: 'harvest-postgres';
    tables: string[];
  };
  services: Array<{
    id: string;
    kind: ModuleServiceKind;
    description: string;
    basePath: string;
    endpoints: ModuleServiceEndpoint[];
  }>;
  workers: Array<{
    id: string;
    description: string;
    schedulerKinds?: string[];
  }>;
  consumers: ModuleConsumerObligation[];
  configKeys: string[];
}

export interface HarvestModuleSummary {
  id: HarvestModuleId;
  version: string;
  name: string;
  enabled: boolean;
  owner: 'harvest';
  apiBase: string;
}
