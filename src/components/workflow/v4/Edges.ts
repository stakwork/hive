interface EdgeConfig {
  id: string;
  source: string;
  target: string;
  animated: boolean;
  type: "smoothstep" | "straight";
  edgeColor: string;
}

class Edges implements EdgeConfig {
  id: string;
  source: string;
  target: string;
  animated: boolean;
  noHandle: boolean;
  type: "smoothstep" | "straight";
  edgeColor: string;

  constructor(
    id: string,
    source: string,
    target: string,
    animated: boolean,
    type: "smoothstep" | "straight",
    edgeColor: string,
  ) {
    this.id = id;
    this.source = source;
    this.target = target;
    this.animated = animated || false;
    this.noHandle = true;
    this.type = type;
    this.edgeColor = edgeColor;
  }

  static defaultEdge(id: string, source: string, target: string): Edges {
    return new Edges(id, source, target, false, "smoothstep", "#000000");
  }

  static straightEdge(id: string, source: string, target: string): Edges {
    return new Edges(id, source, target, false, "straight", "#000000");
  }

  static falseAnimatedEdge(id: string, source: string, target: string): Edges {
    return new Edges(id, source, target, true, "smoothstep", "red");
  }

  static trueAnimatedEdge(id: string, source: string, target: string): Edges {
    return new Edges(id, source, target, true, "smoothstep", "#67C083");
  }

  static trueEdge(id: string, source: string, target: string): Edges {
    return new Edges(id, source, target, false, "smoothstep", "#67C083");
  }

  static falseEdge(id: string, source: string, target: string): Edges {
    return new Edges(id, source, target, false, "smoothstep", "red");
  }

  static skippedEdge(id: string, source: string, target: string): Edges {
    return new Edges(id, source, target, true, "smoothstep", "#8F979D");
  }
}

export default Edges;
