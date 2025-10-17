class Edges {
  constructor(id, source, target, animated, type, edgeColor) {
    this.id = id;
    this.source = source;
    this.target = target;
    this.animate = animated || false;
    this.noHandle = true;
    this.type = type;
    this.edgeColor = edgeColor;
  }

  static defaultEdge(id, source, target) {
    return new Edges(id, source, target, false, 'smoothstep', '#000000');
  }

  static straightEdge(id, source, target) {
    return new Edges(id, source, target, false, 'straight', '#000000');
  }

  static falseAnimatedEdge(id, source, target) {
    return new Edges(id, source, target, true, 'smoothstep', 'red');
  }

  static trueAnimatedEdge(id, source, target) {
    return new Edges(id, source, target, true, 'smoothstep', '#67C083');
  }

  static trueEdge(id, source, target) {
    return new Edges(id, source, target, false, 'smoothstep', '#67C083');
  }

  static falseEdge(id, source, target) {
    return new Edges(id, source, target, false, 'smoothstep', 'red');
  }

  static skippedEdge(id, source, target) {
    return new Edges(id, source, target, true, 'smoothstep', '#8F979D');
  }
}

export default Edges;
