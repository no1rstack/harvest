import React, { useCallback, useMemo, useRef } from 'react';
import { DockviewReact, type IDockviewPanelProps, type DockviewReadyEvent, type DockviewApi } from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { ArchitectureExplorer } from './ArchitectureExplorer';
import { SourceInventoryPanel } from './SourceInventoryPanel';
import { EnrichmentPanel } from './EnrichmentPanel';
import { RssSourcesPanel } from './RssSourcesPanel';
import { FindingsPanel } from './panels/FindingsPanel';
import { RegistryPanel } from './panels/RegistryPanel';
import { GraphPanel } from './panels/GraphPanel';
import { IntelligencePanel } from './panels/IntelligencePanel';
import { FeedsPanel } from './panels/FeedsPanel';
import { OpsPanel } from './panels/OpsPanel';
import { PlatformPanel } from './panels/PlatformPanel';
import { RetiredPanel } from './panels/RetiredPanel';

export interface DockPanel {
  id: string;
  name: string;
  component: string;
}

interface HarvestDockviewProps {
  className?: string;
  panels: DockPanel[];
  onReady?: (api: DockviewApi) => void;
  defaultOpen?: string[];
}

export const HarvestDockview: React.FC<HarvestDockviewProps> = ({
  className, panels, onReady, defaultOpen = ['findings'],
}) => {
  const apiRef = useRef<DockviewApi | null>(null);

  const components = useMemo(() => {
    const map: Record<string, React.FC<IDockviewPanelProps>> = {
      findings: FindingsPanel as unknown as React.FC<IDockviewPanelProps>,
      registry: RegistryPanel as unknown as React.FC<IDockviewPanelProps>,
      graph: GraphPanel as unknown as React.FC<IDockviewPanelProps>,
      intelligence: IntelligencePanel as unknown as React.FC<IDockviewPanelProps>,
      feeds: FeedsPanel as unknown as React.FC<IDockviewPanelProps>,
      ops: OpsPanel as unknown as React.FC<IDockviewPanelProps>,
      architecture: ArchitectureExplorer as unknown as React.FC<IDockviewPanelProps>,
      platform: PlatformPanel as unknown as React.FC<IDockviewPanelProps>,
      sources: SourceInventoryPanel as unknown as React.FC<IDockviewPanelProps>,
      enrichment: EnrichmentPanel as unknown as React.FC<IDockviewPanelProps>,
      'rss-sources': RssSourcesPanel as unknown as React.FC<IDockviewPanelProps>,
      retired: RetiredPanel as unknown as React.FC<IDockviewPanelProps>,
    };
    return map;
  }, []);

  const handleReady = useCallback((event: DockviewReadyEvent) => {
    apiRef.current = event.api;
    onReady?.(event.api);
    for (let i = 0; i < Math.min(defaultOpen.length, 3); i++) {
      const id = defaultOpen[i];
      const panel = panels.find(p => p.id === id);
      if (panel) {
        event.api.addPanel({ id, component: panel.component, position: i > 0 ? { direction: 'right' } : undefined });
      }
    }
  }, [defaultOpen, panels, onReady]);

  return (
    <div className={className} style={{ flex: 1, minHeight: 0 }}>
      <DockviewReact onReady={handleReady} components={components} className="dockview-theme-noir" />
    </div>
  );
};

export function useDockviewPanels(api: DockviewApi | null, panels: DockPanel[]) {
  const openPanel = useCallback((id: string) => {
    if (!api) return;
    const existing = api.getPanel(id);
    if (existing) {
      existing.focus();
    } else {
      const panel = panels.find(p => p.id === id);
      if (panel) api.addPanel({ id, component: panel.component, position: { direction: 'within' } });
    }
  }, [api, panels]);

  return { openPanel };
}
