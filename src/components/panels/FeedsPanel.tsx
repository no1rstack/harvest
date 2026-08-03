import React from 'react';
import { FeedIntelligenceExplorer } from '../FeedIntelligenceExplorer';

export const FeedsPanel: React.FC = () => {
  return (
    <div className="h-full overflow-auto">
      <div className="p-3">
        <FeedIntelligenceExplorer />
      </div>
    </div>
  );
};
