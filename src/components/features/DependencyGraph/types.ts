import type { Node as ReactFlowNode, Edge } from "@xyflow/react";

export interface GraphEntity {
  id: string;
  [key: string]: any;
}

export interface DependencyGraphProps<T extends GraphEntity> {
  entities: T[];
  getDependencies: (entity: T) => string[];
  renderNode: (entity: T) => React.ReactNode;
  onNodeClick?: (entityId: string) => void;
  direction?: "TB" | "LR";
  emptyStateMessage?: string;
  noDependenciesMessage?: {
    title: string;
    description: string;
  };
}

export interface LayoutConfig {
  nodeWidth: number;
  nodeHeight: number;
  direction?: "TB" | "LR";
  ranksep?: number;
  nodesep?: number;
}

export interface LayoutResult {
  nodes: ReactFlowNode[];
  edges: Edge[];
}
