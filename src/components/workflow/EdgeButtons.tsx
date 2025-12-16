import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  EdgeProps,
} from '@xyflow/react';

interface CustomEdgeData {
  id: string;
  conn_edge: {
    source: string;
    target: string;
    custom_label?: string;
    disable_edge?: boolean;
    edgeColor: string;
    data?: {
      condition_eval?: boolean;
    };
  };
  project_view?: boolean;
  data?: {
    project_view?: boolean;
  };
}

export default function EdgeButtons(props: EdgeProps) {
  const { setEdges } = useReactFlow();
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, style: _style = {}, markerEnd: _markerEnd } = props;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.3,
  });

  const deleteEdge = () => {
    setEdges((es) => es.filter((e) => e.id !== id));
  };

  if (!data) return null;

  const edgeData = data as unknown as CustomEdgeData;
  const edge = edgeData.conn_edge;
  let project_view = edgeData.project_view;

  if (edgeData.data?.project_view) {
    project_view = edgeData.data.project_view;
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ strokeWidth: 2, stroke: edge.edgeColor }}/>
      <div>
        <EdgeLabelRenderer>
          {edge.custom_label &&
            <div style={{
              position: 'absolute',
              padding: '20px',
              background: edge.data?.condition_eval ? '#67C083' : 'white',
              border: '1px solid #444851',
              color: edge.data?.condition_eval ? 'white' : 'black',
              transform: `translate(-50%, 50%) translate(${labelX+50}px,${labelY-100}px)`,
              pointerEvents: 'all'
            }}>
              {edge.custom_label}
            </div>
          }
          {(!project_view && !edge.disable_edge) &&
            <div>
              <div className="add-step add-step-node" data-target="workflow-buttons.addStep"
                   data-point-position={edgeData.id}
                   data-edge-source={edge.source} data-edge-target={edge.target}
                   data-remote="true" style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX-20}px,${labelY}px)`,
                pointerEvents: 'all'
              }}>
                <i className="material-icons" style={{margin: 'auto'}}>add</i>
              </div>

              <div className="remove-step-edge"
                   onClick={deleteEdge}
                   style={{
                position: 'absolute',
                transform: `translate(-50%, -50%) translate(${labelX+30}px,${labelY}px)`,
                pointerEvents: 'all'
              }}>
                <i className="material-icons" style={{margin: 'auto'}}>remove</i>
              </div>
            </div>
          }
        </EdgeLabelRenderer>
      </div>
    </>
  );
}
