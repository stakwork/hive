import React from "react";
import { Handle, Position, NodeProps } from "@xyflow/react";

interface StepNodeData {
  id: string;
  className?: string;
  width?: number;
  height?: number;
  bgColor: string;
  borderRadius: number;
  borderColor?: string;
  textColor?: string;
  stepType?: string;
  project_view?: boolean;
  data: {
    html: string;
  };
}

export default function StepNode({ data: rawData }: NodeProps) {
  const data = rawData as unknown as StepNodeData;

  let isSourceConnectable = data.id !== "start";
  let isTargetConnectable = data.id !== "start";

  if (data.id === "system.succeed" || data.id === "system.fail") {
    isTargetConnectable = true;
    isSourceConnectable = false;
  }

  let dragHandleClass = data.project_view ? "workflow-drag-handle__custom_small" : "workflow-drag-handle__custom";

  return (
    <div className={`nowheel ${data.project_view ? "workflow-flow-project-view" : ""}`}>
      {data.id !== "start" && (
        <Handle
          type="target"
          position={Position.Left}
          className={
            data.stepType !== "IfCondition"
              ? dragHandleClass
              : "workflow-drag-handle__custom workflow-if-condition-left-handle"
          }
          isConnectable={!data.project_view && isTargetConnectable}
        />
      )}

      <div
        className={`${data.className || ""}`}
        style={{
          width: `${data.width || 100}px`,
          height: `${data.height || 50}px`,
          pointerEvents: "all",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          willChange: "top, left",
          backgroundColor: data.bgColor as React.CSSProperties["backgroundColor"],
          borderRadius: `${data.borderRadius}px`,
          borderWidth: "2px",
          borderStyle: "solid",
          borderColor: data.borderColor as React.CSSProperties["borderColor"],
          color: data.textColor as React.CSSProperties["color"],
        }}
      >
        <div style={{ width: "100%" }} dangerouslySetInnerHTML={{ __html: data.data.html }}></div>
      </div>
      {data.id !== "system.fail" && data.id !== "system.succeed" && (
        <Handle
          type="source"
          position={Position.Right}
          className={data.stepType !== "IfCondition" ? dragHandleClass : "workflow-if-condition-handle"}
          isConnectable={data.stepType !== "IfCondition" ? !data.project_view && isSourceConnectable : false}
        />
      )}
    </div>
  );
}
