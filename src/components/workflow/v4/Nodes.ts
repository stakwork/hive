class Nodes {
  edges = []
  constructor(
    id,
    position,
    data,
    width,
    height,
    bgColor,
    className,
    textColor,
    targetPosition,
    sourcePosition,
    sourceNode,
    targetNode,
    stepName,
    stepType,
    clickCallback,
    borderRadius,
    childNodes,
    borderColor,
    status,
    nextStep,
    result,
    rotation,
    connection_edges,
    deletable
  ) {
    this.id = id;
    this.position = position;
    this.data = data;
    this.width = width;
    this.height = height;
    this.bgColor = bgColor || '#F5F6F8';
    this.className = className;
    this.textColor = textColor;
    this.targetPosition = targetPosition || 'right';
    this.sourcePosition = sourcePosition || 'left';
    this.sourceNode = sourceNode;
    this.targetNode = targetNode;
    this.stepName = stepName;
    this.stepType = stepType;
    this.clickCallback = clickCallback;
    this.borderRadius = borderRadius;
    this.childNodes = childNodes;
    this.borderColor = borderColor || '#B0B7BC';
    this.status = status;
    this.nextStep = nextStep;
    this.result = result;
    this.rotation = rotation || "0";
    this.connection_edges = connection_edges;
    this.deletable = true
  }

  static standardNode(
    id,
    position,
    data,
    bgColor,
    className,
    textColor,
    targetPosition,
    sourcePosition,
    sourceNode,
    targetNode,
    stepName,
    stepType,
    clickCallback
  ) {
    const newNode = new Nodes(
      id,
      { x: position.x, y: position.y - 136 },
      data,
      304,
      496,
      '#F5F6F8',
      'standard-node active-node',
      '#444851',
      'left',
      'right',
      sourceNode,
      targetNode,
      stepName,
      'Step',
      clickCallback,
      8
    );

    newNode.deletable = (id !== 'set_var')

    return newNode
  }

  static loopNode(
    id,
    position,
    data,
    bgColor,
    className,
    textColor,
    targetPosition,
    sourcePosition,
    sourceNode,
    targetNode,
    stepName,
    stepType,
    clickCallback
  ) {
    return new Nodes(
      id,
      { x: position.x, y: position.y - 136 },
      data,
      304,
      496,
      '#F5F6F8',
      'standard-node loop-node',
      '#444851',
      targetPosition,
      sourcePosition,
      sourceNode,
      targetNode,
      stepName,
      'Step',
      clickCallback,
      8
    );
  }

  static automatedNode(
    id,
    position,
    data,
    bgColor,
    className,
    textColor,
    targetPosition,
    sourcePosition,
    sourceNode,
    targetNode,
    stepName,
    stepType,
    clickCallback
  ) {
    const newNode = new Nodes(
      id,
      { x: position.x, y: position.y - 100 },
      data,
      304,
      424,
      '#F5F6F8',
      'automated-node',
      '#444851',
      targetPosition,
      sourcePosition,
      sourceNode,
      targetNode,
      stepName,
      'Step',
      clickCallback,
      8
    );

    newNode.deletable = (id !== 'set_var')

    return newNode
  }

  static fileNode(
    id,
    position,
    data,
    bgColor,
    className,
    textColor,
    targetPosition,
    sourcePosition,
    sourceNode,
    targetNode,
    stepName,
    stepType,
    clickCallback
  ) {
    return new Nodes(
      id,
      position,
      data,
      352,
      100,
      'white',
      'file-node',
      textColor,
      'right',
      'left',
      sourceNode,
      targetNode,
      stepName,
      'finished',
      clickCallback,
      8,
      null,
      null,
      'finished'
    );
  }

  static ifConditionNode({
    show_only,
    id,
    uniqueId,
    position,
    data,
    targetPosition,
    sourcePosition,
    sourceNode,
    targetNode,
    stepName,
    stepType,
    clickCallback,
    borderRadius,
    childNodes,
    borderColor,
    status,
    nextStep,
    result,
    rotation,
    connection_edges,
    project_id
  }) {
    let dataElem;
    let questionFill
    let currentUrl = new URL(window.location.href);
    let newPath = `/admin/projects/${project_id}/workflow_steps/${id}`;
    let icon = `<svg xmlns="http://www.w3.org/2000/svg" width="33" height="33" viewBox="0 0 256 256" fill="none">
    <path d="M127.52 185.6C130.88 185.6 133.72 184.44 136.04 182.12C138.36 179.8 139.52 176.96 139.52 173.6C139.52 170.24 138.36 167.4 136.04 165.08C133.72 162.76 130.88 161.6 127.52 161.6C124.16 161.6 121.32 162.76 119 165.08C116.68 167.4 115.52 170.24 115.52 173.6C115.52 176.96 116.68 179.8 119 182.12C121.32 184.44 124.16 185.6 127.52 185.6ZM128 224C114.72 224 102.24 221.48 90.56 216.44C78.88 211.4 68.72 204.56 60.08 195.92C51.44 187.28 44.6 177.12 39.56 165.44C34.52 153.76 32 141.28 32 128C32 114.72 34.52 102.24 39.56 90.56C44.6 78.88 51.44 68.72 60.08 60.08C68.72 51.44 78.88 44.6 90.56 39.56C102.24 34.52 114.72 32 128 32C141.28 32 153.76 34.52 165.44 39.56C177.12 44.6 187.28 51.44 195.92 60.08C204.56 68.72 211.4 78.88 216.44 90.56C221.48 102.24 224 114.72 224 128C224 141.28 221.48 153.76 216.44 165.44C211.4 177.12 204.56 187.28 195.92 195.92C187.28 204.56 177.12 211.4 165.44 216.44C153.76 221.48 141.28 224 128 224ZM128.96 86.72C132.96 86.72 136.44 88 139.4 90.56C142.36 93.12 143.84 96.32 143.84 100.16C143.84 103.68 142.76 106.8 140.6 109.52C138.44 112.24 136 114.8 133.28 117.2C129.6 120.4 126.36 123.92 123.56 127.76C120.76 131.6 119.36 135.92 119.36 140.72C119.36 142.96 120.2 144.84 121.88 146.36C123.56 147.88 125.52 148.64 127.76 148.64C130.16 148.64 132.2 147.84 133.88 146.24C135.56 144.64 136.64 142.64 137.12 140.24C137.76 136.88 139.2 133.88 141.44 131.24C143.68 128.6 146.08 126.08 148.64 123.68C152.32 120.16 155.48 116.32 158.12 112.16C160.76 108 162.08 103.36 162.08 98.24C162.08 90.08 158.76 83.4 152.12 78.2C145.48 73 137.76 70.4 128.96 70.4C122.88 70.4 117.08 71.68 111.56 74.24C106.04 76.8 101.84 80.72 98.96 86C97.84 87.92 97.48 89.96 97.88 92.12C98.28 94.28 99.36 95.92 101.12 97.04C103.36 98.32 105.68 98.72 108.08 98.24C110.48 97.76 112.48 96.4 114.08 94.16C115.84 91.76 118.04 89.92 120.68 88.64C123.32 87.36 126.08 86.72 128.96 86.72Z" fill="#444851"/>
    </svg>`;

    if (show_only === 'false') {
       questionFill = icon;
    } else {
    // make make questionFill a link to '/step_details_modal' and pass the uniqueId as a param
      questionFill = `<a href="${newPath}" class="fill-div" data-turbo-stream=true></a>${icon}`;
    }
    if(status){
      // set fill for questionOutline to red
      questionFill = questionFill.replace('fill="#444851"', 'fill="#FFFFFF"');
    }
    if(show_only === false || show_only === 'false'){
      dataElem = `<div class="ifcon-inner"><span class="ifcon-icon"><img>${questionFill}</span>IfCondition<div class="ifconText">${data}</div><div class="ifcon-edit step-menu-edit" data-unique-id="${uniqueId}" data-wizard-step="true"><i class="material-icons">edit</i></div></div>`;
    }else{
      dataElem = `<div class="ifcon-inner"><span class="ifcon-icon">${questionFill}</span>IfCondition<div class="ifconText">${data}</div></div>`;
    }
    const ifNode = new Nodes(
      id,
      { x: position.x, y: position.y - 50 },
      { html: dataElem},
      140,
      140,
      'white',
      'IfCondition',
      '#8F979D',
      targetPosition,
      sourcePosition,
      sourceNode,
      targetNode,
      stepName,
      'IfCondition',
      clickCallback,
      8,
      null,
      borderColor,
      status,
      nextStep,
      result,
      rotation,
      connection_edges
    );

    ifNode.borderColor = '#8F979D';
    ifNode.status = status;

    return ifNode
  }

  static startNode(
    id,
    position,
    className,
    sourceNode,
    targetNode,
    stepName,
    clickCallback
  ) {
    const newNode = new Nodes(
      'start',
      { x: position.x, y: position.y - 15 },
      { html: '<p class="start-text">Start</p>' },
      135,
      80,
      '#67C083',
      className,
      'white',
      'right',
      'left',
      sourceNode,
      targetNode,
      stepName,
      'Start',
      clickCallback,
      200
    );

    newNode.deletable = false

    return newNode
  }

  static endNodes(
    id,
    position,
    className,
    textColor,
    targetPosition,
    sourcePosition,
    sourceNode,
    targetNode,
    stepName,
    stepType,
    clickCallback
  ) {
    const endNode = new Nodes(
      'system.succeed',
      { x: position.x, y: position.y - 15},
      { html: '<p class="start-text">End</p>' },
      135,
      80,
      '#444851',
      className,
      'white',
      targetPosition,
      sourcePosition,
      sourceNode,
      targetNode,
      stepName,
      'End',
      clickCallback,
      50
    );
    endNode.deletable = false
    endNode.borderColor = '#444851';
    const haltNode = new Nodes.haltNode(
      'system.fail',
      { x: endNode.position.x, y: endNode.position.y + 180 },
      className,
      textColor,
      targetPosition,
      sourcePosition,
      sourceNode,
      targetNode,
      stepName,
      stepType,
      clickCallback
    );
    haltNode.borderColor = '#8F979D';
    haltNode.deletable = false
    return [endNode, haltNode];
  }

  static haltNode(
    id,
    position,
    className,
    textColor,
    targetPosition,
    sourcePosition,
    sourceNode,
    targetNode,
    stepName,
    stepType,
    clickCallback
  ) {
    const newNode = new Nodes(
      id,
      position,
      { html: '<p class="start-text">Halt</p>' },
      135,
      80,
      '#8F979D',
      className,
      'white',
      targetPosition,
      sourcePosition,
      sourceNode,
      targetNode,
      stepName,
      'Halt',
      clickCallback,
      8
    );

    newNode.deletable = false

    return newNode
  }

  static booleanResultNode({
    id,
    position,
    data,
    bgColor,
    className,
    textColor,
    targetPosition,
    sourcePosition,
    sourceNode,
    targetNode,
    stepName,
    stepType,
    clickCallback,
    result,
    borderColor,
    status
  }){
      return new Nodes(
        id,
        position,
        data,
        122,
        64,
        bgColor,
        className,
        'white',
        targetPosition,
        sourcePosition,
        sourceNode,
        targetNode,
        stepName,
        'output',
        clickCallback,
        8,
        null,
        '#9747FF',
        status
      );
    }

    static polyNode(
      id,
      position,
      data,
    ) {
      return new Nodes(
        id,
      position,
      data,
      352,
      100,
      'white',
      'file-node',
      null,
      'right',
      'left',
      null,
      null,
      null,
      'finished',
      null,
      8,
      null,
      null,
      'finished');
    }


  addClass(node, className) {
    node.className += ` ${className}`;
  }
}

export default Nodes;
