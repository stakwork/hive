import React, { useCallback } from 'react';

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
                                    }) {
  const deleteNode = useCallback(() => {
    console.log("delete nodes", nodes)
    deleteCallback(nodes)
  }, [nodes]);

  const exportNodeWR = useCallback(() => {
    console.log("export node", nodes)
    exportCallback(nodes, 'WorkflowRunner')
  }, [nodes]);

  const exportNodeFE = useCallback(() => {
    console.log("export node", nodes)
    exportCallback(nodes, 'ForEachCondition')
  }, [nodes]);

  const exportNodeWL = useCallback(() => {
    console.log("export node", nodes)
    exportCallback(nodes, 'WhileLoop')
  }, [nodes]);

  const plural = nodes.length > 1 ? 's' : ''

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