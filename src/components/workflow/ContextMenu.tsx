import React, { useCallback } from 'react';
import { openImportNodeModal } from './ImportNodeModal';

export default function ContextMenu({
                                      top,
                                      left,
                                      right,
                                      bottom,
                                      position,
                                      workflowId,
                                      workflowVersionId,
                                      ...props
                                    }) {
  const importNode = useCallback(() => {
    // Open the modal and pass along the workflow IDs
    openImportNodeModal(workflowId, workflowVersionId, position);
  }, [workflowId, workflowVersionId, position]);

  const addNode = useCallback(() => {
    // Construct the URL with query parameters
    const url = `/admin/workflows/wizard.js?workflow_id=${workflowId}&version=${workflowVersionId}&position=${JSON.stringify(position)}`;

    // Make a fetch request to the Rails endpoint
    fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/javascript',
        'X-Requested-With': 'XMLHttpRequest'
      },
      credentials: 'same-origin' // Include cookies for authentication
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Network response was not ok: ${response.status}`);
        }
        return response.text(); // For JS responses, use text() instead of json()
      })
      .then(data => {
        // Rails would typically return JavaScript that self-executes
        // You might need to handle this response based on your Rails setup
        // If the JS response opens a modal or performs some action, you may need to eval it
        // (though eval should be used carefully for security reasons)
        const script = document.createElement('script');
        script.textContent = data;
        document.body.appendChild(script);
        document.body.removeChild(script);
      })
      .catch(error => {
        console.error('Error adding node:', error);
      });
  }, [workflowId, workflowVersionId]);

  console.log("position", position)

  return (
    <div
      style={{top, left, right, bottom}}
      className="reactflow-context-menu"
      {...props}
    >
      <div className="context-menu-header">
        <span>Actions</span>
      </div>
      <button onClick={addNode}>Add Step</button>
      <button onClick={importNode}>Import Step</button>
    </div>
  );
}