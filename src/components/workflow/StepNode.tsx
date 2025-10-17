import React, { useCallback } from 'react';
import { Handle, Position, useHandleConnections } from '@xyflow/react';

export default function StepNode({ data }) {
  const onChange = useCallback((evt) => {
    console.log(evt.target.value);
  }, []);

  const sourceConnections = useHandleConnections({
    type: 'source',
  });

  const targetConnections = useHandleConnections({
    type: 'target',
  });

  let isSourceConnectable = data.id !== 'start'
  let isTargetConnectable = data.id !== 'start'

  if (data.id === 'system.succeed' || data.id === 'system.fail') {
    isTargetConnectable = true
    isSourceConnectable = false
  }

  let dragHandleClass = data.project_view ? 'drag-handle__custom_small' : 'drag-handle__custom'

  return (
    <div className={`nowheel ${data.project_view ? 'flow-project-view' : ''}`}>
      { (data.id !== 'start') &&
        <Handle
          type="target"
          position={Position.Left}
          className={data.stepType !== 'IfCondition' ? dragHandleClass : 'drag-handle__custom if-condition-left-handle'}
          isConnectable={!data.project_view && isTargetConnectable}
        />
      }

      <div className={`${data.className}`} style={{
          width: `${data.width}px`,
          height: `${data.height}px`,
          pointerEvents: 'all',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          willChange: 'top, left',
          backgroundColor: data.bgColor,
          borderRadius: `${data.borderRadius}px`,
          borderColor: data.borderColor,
          borderStyle: 'solid',
          textColor: data.textColor,
          color: data.textColor
      }}>
        <div dangerouslySetInnerHTML={{__html: data.data.html}}>

        </div>
      </div>
      { (data.id !== 'system.fail' && data.id !== 'system.succeed') &&
        <Handle
          type="source"
          position={Position.Right}
          className={data.stepType !== 'IfCondition' ? dragHandleClass : 'if-condition-handle'}
          isConnectable={data.stepType !== 'IfCondition' ? (!data.project_view && isSourceConnectable) : false}
        />
      }
    </div>
  );
}