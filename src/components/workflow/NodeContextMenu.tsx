import React, { useCallback } from 'react';
import { logger } from "@/lib/logger";

interface NodeContextMenuProps {
  top?: number | string;
  left?: number | string;
  right?: number | string;
  bottom?: number | string;
  position?: { x: number; y: number };
  nodes: any[];
  deleteCallback: (nodes: any[]) => void;
  exportCallback: (nodes: any[], exportType: string) => void;
  [key: string]: any;
}

export default function NodeContextMenu({
  top,
  left,
  right,
  bottom,
  position,
  nodes,
  deleteCallback,
  exportCallback,
  ...props
}: NodeContextMenuProps) {
  const deleteNode = useCallback(() => {
    logger.debug("delete nodes", "workflow/NodeContextMenu", { nodes });
    deleteCallback(nodes);
  }, [nodes, deleteCallback]);

  const exportNodeWR = useCallback(() => {
    logger.debug("export node", "workflow/NodeContextMenu", { nodes });
    exportCallback(nodes, 'WorkflowRunner');
  }, [nodes, exportCallback]);

  const exportNodeFE = useCallback(() => {
    logger.debug("export node", "workflow/NodeContextMenu", { nodes });
    exportCallback(nodes, 'ForEachCondition');
  }, [nodes, exportCallback]);

  const exportNodeWL = useCallback(() => {
    logger.debug("export node", "workflow/NodeContextMenu", { nodes });
    exportCallback(nodes, 'WhileLoop');
  }, [nodes, exportCallback]);

  const plural = nodes.length > 1 ? 's' : '';

  return (
    <div
      style={{top, left, right, bottom}}
      className="reactflow-context-menu"
      {...props}
    >
      <div className="context-menu-header">
        <span>Actions</span>
      </div>
      <button onClick={deleteNode}>Delete Step{plural}</button>
      <button onClick={exportNodeWR}>Export To Workflow Runner</button>
      <button onClick={exportNodeFE}>Export To For Each</button>
      <button onClick={exportNodeWL}>Export To While Loop</button>
    </div>
  );
}
