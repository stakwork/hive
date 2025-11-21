import React, { useState } from "react";
import { useReactFlow, Node, NodeChange } from "@xyflow/react";
import { smartLayout } from "./layoutUtils";

interface SmartLayoutButtonProps {
  onNodesChange?: (changes: NodeChange[]) => void;
}

export function SmartLayoutButton({ onNodesChange }: SmartLayoutButtonProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const { getNodes, getEdges, setNodes, fitView } = useReactFlow();

  const applySmartLayout = async () => {
    if (isProcessing) return;

    setIsProcessing(true);
    try {
      console.log("Applying smart layout...");
      const originalNodes = getNodes();
      const layoutedNodes = await smartLayout(originalNodes, getEdges());

      // Apply with animation if supported
      if (typeof (document as any).startViewTransition === "function") {
        (document as any).startViewTransition(() => {
          setNodes(layoutedNodes);
          setTimeout(() => {
            fitView({ padding: 0.2 });
            saveNodePositions(layoutedNodes);
          }, 50);
        });
      } else {
        setNodes(layoutedNodes);
        setTimeout(() => {
          fitView({ padding: 0.2 });
          saveNodePositions(layoutedNodes);
        }, 50);
      }
    } catch (error) {
      console.error("Failed to apply layout:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Generate node change events to trigger position saving
  const saveNodePositions = (layoutedNodes: Node[]) => {
    // Skip if no onNodesChange handler
    if (!onNodesChange) return;

    // For each node, create a change object that simulates a drag operation
    const nodeChanges: NodeChange[] = layoutedNodes.map((node) => ({
      id: node.id,
      type: "position",
      position: node.position,
      dragging: false,
    }));

    // Call onNodesChange with these changes to trigger saving
    if (nodeChanges.length > 0) {
      console.log("Saving positions for", nodeChanges.length, "nodes");
      onNodesChange(nodeChanges);
    }
  };

  return (
    <button
      onClick={applySmartLayout}
      disabled={isProcessing}
      style={{
        position: "absolute",
        right: "10px",
        top: "10px",
        zIndex: 10,
        padding: "8px 15px",
        backgroundColor: "#f5f9ff",
        border: "1px solid #ddd",
        borderRadius: "4px",
        fontWeight: "bold",
        cursor: isProcessing ? "wait" : "pointer",
        opacity: isProcessing ? 0.7 : 1,
        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
      }}
    >
      {isProcessing ? "Arranging..." : "Smart Layout"}
    </button>
  );
}
