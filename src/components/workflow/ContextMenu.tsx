import React, { useCallback } from "react";
import { openImportNodeModal } from "./ImportNodeModal";

interface ContextMenuProps {
  top?: number | string;
  left?: number | string;
  right?: number | string;
  bottom?: number | string;
  position: { x: number; y: number };
  workflowId: string;
  workflowVersionId: string;
  [key: string]: any;
}

export default function ContextMenu({
  top,
  left,
  right,
  bottom,
  position,
  workflowId,
  workflowVersionId,
  ...props
}: ContextMenuProps) {
  const importNode = useCallback(() => {
    // Open the modal and pass along the workflow IDs
    openImportNodeModal(workflowId, workflowVersionId, position);
  }, [workflowId, workflowVersionId, position]);

  const addNode = useCallback(() => {
    // Construct the URL with query parameters
    const url = `/admin/workflows/wizard.js?workflow_id=${workflowId}&version=${workflowVersionId}&position=${JSON.stringify(position)}`;

    // Make a fetch request to the Rails endpoint
    fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/javascript",
        "X-Requested-With": "XMLHttpRequest",
      },
      credentials: "same-origin", // Include cookies for authentication
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Network response was not ok: ${response.status}`);
        }
        return response.text(); // For JS responses, use text() instead of json()
      })
      .then((data) => {
        // Rails would typically return JavaScript that self-executes
        const script = document.createElement("script");
        script.textContent = data;
        document.body.appendChild(script);
        document.body.removeChild(script);
      })
      .catch((error) => {
        console.error("Error adding node:", error);
      });
  }, [workflowId, workflowVersionId, position]);

  console.log("position", position);

  return (
    <div style={{ top, left, right, bottom }} className="reactflow-context-menu" {...props}>
      <div className="context-menu-header">
        <span>Actions</span>
      </div>
      <button onClick={addNode}>Add Step</button>
      <button onClick={importNode}>Import Step</button>
    </div>
  );
}
