import React from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  getStraightPath,
} from '@xyflow/react';

export default function EdgeButtons({
                                      id,
                                      sourceX,
                                      sourceY,
                                      targetX,
                                      targetY,
                                      sourcePosition,
                                      targetPosition,
                                      data,
                                      style = {},
                                      markerEnd,
                                    }) {
  const { setEdges } = useReactFlow();
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
    // console.log("id", id)

    setEdges((es) => es.filter((e) => e.id !== id))
  }

  const edge = data.conn_edge

  let project_view = data.project_view

  if (data.data.project_view) {
    project_view = data.data.project_view
  }

  // console.log("edge data>>>>", data)

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={{ strokeWidth: 2, stroke: edge.edgeColor }}/>
      <div>
        <EdgeLabelRenderer>
          {edge.custom_label &&
            <div style={{
              position: 'absolute',
              padding: '20px',
              background: edge.data && edge.data.condition_eval ? '#67C083' : 'white',
              border: '1px solid #444851',
              color: edge.data && edge.data.condition_eval ? 'white' : 'black',
              transform: `translate(-50%, 50%) translate(${labelX+50}px,${labelY-100}px)`,
              pointerEvents: 'all'
            }}>
              {edge.custom_label}
            </div>
          }
          {(!project_view && !edge.disable_edge) &&
            <div>
              <div className="add-step add-step-node" data-target="workflow-buttons.addStep"
                   data-point-position={data.id}
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