// =======================================
// GraphView.tsx (FULL COPY-PASTE VERSION)
// Fixes scaling mismatch by:
// 1) Forcing selected node depth = 0 everywhere (sizes + labels)
// 2) Strong depth-driven scaling (hub > ring > leaves)
// 3) Shader fades crisp ring for tiny nodes so leaves look like soft dots
// 4) Labels follow animated positions (no teleport)
// 5) Reuses edge buffers (no per-frame Float32Array allocations)
// =======================================

import { useRef, useMemo, useEffect, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { Graph, GraphEdge, ViewState } from "./types";
import { edgeKey } from "./types";
import { VIRTUAL_CENTER } from "./extract";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { PulseLayer } from "./PulseLayer";

export interface Pulse {
  src: number;
  dst: number;
  progress: number; // 0→1
}

interface GraphViewProps {
  graph: Graph;
  viewState: ViewState;
  onNodeClick: (id: number) => void;
  minimap?: boolean;
  whiteboardNodeId?: number | null;
  onEnterWhiteboard?: (id: number) => void;
  onExitWhiteboard?: () => void;
  onDetailNavigate?: (id: number) => void;
  searchMatches?: Set<number> | null;
  pulses?: Pulse[];
}

const tmpObj = new THREE.Object3D();
const tmpColor = new THREE.Color();

// Fisheye: module-level reusable objects
const _fishRaycaster = new THREE.Raycaster();
const _fishPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _fishHit = new THREE.Vector3();
const _fishPointer = new THREE.Vector2();
const FISHEYE_D = 2; // Sarkar-Brown distortion strength for labels
const FISHEYE_MIN_CHILDREN = 15;

interface RingData {
  onRing: Uint8Array;
  centerX: Float32Array;
  centerZ: Float32Array;
  baseAngle: Float32Array;
  radius: Float32Array;
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}


// --------- Billboard glow shader (tiny nodes become dim blobs) ---------
const glowVertexShader = /* glsl */ `
  attribute float instanceProgress;
  attribute float instanceAlpha;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vScale;
  varying float vProgress;
  varying float vAlpha;

  void main() {
    vUv = uv;
    vProgress = instanceProgress;
    vAlpha = instanceAlpha;

    #ifdef USE_INSTANCING_COLOR
      vColor = instanceColor;
    #else
      vColor = vec3(1.0);
    #endif

    // instance translation and scale
    vec3 instancePos = vec3(instanceMatrix[3]);
    float scaleX = length(vec3(instanceMatrix[0]));
    vScale = scaleX;

    // Billboard: offset in camera-local XY (screen-space constant size)
    vec3 localOffset = (position * scaleX);
    vec4 mvPosition = modelViewMatrix * vec4(instancePos, 1.0);
    float screenScale = -mvPosition.z / projectionMatrix[1][1];
    mvPosition.xy += localOffset.xy * screenScale * 0.08;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

const glowFragmentShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vScale;
  varying float vProgress;
  varying float vAlpha;

  void main() {
    vec2 coord = (vUv - 0.5) * 2.0;
    float r = length(coord);

    float centerDot = 1.0 - smoothstep(0.06, 0.15, r);

    float ringDist = abs(r - 0.55);
    float ring = smoothstep(0.035, 0.0, ringDist);

    float ringGlow = exp(-ringDist * ringDist * 60.0) * 0.45;
    float outerGlow = exp(-2.5 * max(r - 0.55, 0.0)) * 0.2;
    float innerFill = (1.0 - smoothstep(0.0, 0.55, r)) * 0.04;

    // Glow only on selected node (large scale)
    float s = clamp((vScale - 0.5) / 0.1, 0.0, 1.0);
    ringGlow *= s;
    outerGlow *= s;
    innerFill *= s;
    centerDot *= 0.8;

    float alpha = centerDot + ring + ringGlow + outerGlow + innerFill;
    if (alpha < 0.01) discard;

    float brightness = centerDot + ring + ringGlow * 0.7 + outerGlow * 0.4 + innerFill;
    brightness = min(brightness, 1.6);

    vec3 color = vColor;

    // Radial sweep fill for executing nodes (progress >= 0)
    if (vProgress >= 0.0) {
      // Angle from top (12 o'clock), clockwise 0..1
      float a = atan(coord.x, coord.y);
      float fill = a < 0.0 ? (a + 6.28318) / 6.28318 : a / 6.28318;

      float inFill = smoothstep(0.0, 0.015, vProgress - fill);

      // Bright edge at the progress boundary
      float edgeDist = abs(fill - vProgress);
      float edgeBright = exp(-edgeDist * edgeDist * 6000.0) * 0.8;

      vec3 fillColor = vec3(0.2, 1.0, 0.4);
      vec3 dimColor = color * 0.15;
      color = mix(dimColor, fillColor, inFill) + fillColor * edgeBright;
    }

    gl_FragColor = vec4(color * brightness, alpha * vAlpha);
  }
`;

// --------- Edge glow material (matches ring style) ---------
const edgeGlowVertexShader = /* glsl */ `
  attribute float alpha;
  uniform float opacity;
  varying float vOpacity;

  void main() {
    vOpacity = opacity * alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const edgeGlowFragmentShader = /* glsl */ `
  uniform vec3 color;
  varying float vOpacity;

  void main() {
    gl_FragColor = vec4(color * 1.2, vOpacity);
  }
`;

// --------- Helpers for custom sphere raycast ---------
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _sphere = new THREE.Sphere();
const _hitPoint = new THREE.Vector3();


const SHOW_HELPERS = false;

export function GraphView({ graph, viewState, onNodeClick, minimap, whiteboardNodeId, onExitWhiteboard, onDetailNavigate, searchMatches, pulses }: GraphViewProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const highlightLinesRef = useRef<THREE.LineSegments>(null);
  const trailLinesRef = useRef<THREE.LineSegments>(null);
  const crossLinesRef = useRef<THREE.LineSegments>(null);

  const [hovered, setHovered] = useState<number | null>(null);
  const detailPanelOpacity = useRef(0);
  const wbNodeId = whiteboardNodeId ?? null;

  // Approach indicator state (node id + 0-1 progress for "zoom to inspect" hint)
  const approachRef = useRef<{ nodeId: number; progress: number }>({ nodeId: -1, progress: 0 });
  const [approachState, setApproachState] = useState<{ nodeId: number; progress: number }>({ nodeId: -1, progress: 0 });

  const nodeCount = graph.nodes.length;

  const maxDegree = useMemo(
    () => Math.max(1, ...graph.nodes.map((n) => n.degree)),
    [graph]
  );

  const hoveredRelated = useMemo<Set<number> | null>(() => {
    if (hovered === null) return null;
    return new Set(graph.adj[hovered]);
  }, [hovered, graph.adj]);


  // Current animated state
  const currentPos = useRef(new Float32Array(nodeCount * 3));
  const currentScale = useRef(new Float32Array(nodeCount));
  const currentColor = useRef(new Float32Array(nodeCount * 3));
  const currentAlpha = useRef(new Float32Array(nodeCount));

  // Per-instance progress for executing nodes (-1 = inactive, 0..1 = progress)
  const progressArray = useRef(new Float32Array(nodeCount).fill(-1));
  const progressAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);
  const alphaAttrRef = useRef<THREE.InstancedBufferAttribute | null>(null);

  // Labels follow animation (updated at low fps)
  const [labelPos, setLabelPos] = useState(() => new Float32Array(nodeCount * 3));
  const labelAccum = useRef(0);
  // Fisheye label offsets: distorted positions for labels only (nodes stay fixed)
  const fisheyeLabelPos = useRef(new Float32Array(nodeCount * 3));
  // Per-node nimbus scale (cursor proximity on ring)
  const nimbusScale = useRef(new Float32Array(nodeCount).fill(1));

  // Cursor-reveal: cursor world position on XZ plane
  const cursorXZ = useRef({ x: 0, z: 0 });
  const [fisheyeRevealed, setFisheyeRevealed] = useState<Set<number>>(() => new Set());
  const fisheyeRevealedRef = useRef<Set<number>>(new Set());

  // Fisheye: precompute ring polar data from layout's childrenOf
  const ringData = useMemo((): RingData | null => {
    const childrenOf = graph.childrenOf;
    if (!childrenOf) return null;

    // Determine the active parent: selected node in subgraph mode, or virtual center / single root in overview
    let activeParentId: number | undefined;
    if (viewState.mode === "subgraph") {
      activeParentId = viewState.selectedNodeId;
    } else {
      // Overview: use virtual center if it exists, otherwise the layout root
      if (graph.initialDepthMap?.has(VIRTUAL_CENTER)) {
        activeParentId = VIRTUAL_CENTER;
      } else {
        // Single root: find it (depth 0 node)
        for (const [id, depth] of graph.initialDepthMap ?? []) {
          if (depth === 0) { activeParentId = id; break; }
        }
      }
    }

    if (activeParentId === undefined) return null;
    const children = childrenOf.get(activeParentId);
    if (!children || children.length < FISHEYE_MIN_CHILDREN) return null;

    const onRing = new Uint8Array(nodeCount);
    const centerX = new Float32Array(nodeCount);
    const centerZ = new Float32Array(nodeCount);
    const baseAngle = new Float32Array(nodeCount);
    const radius = new Float32Array(nodeCount);

    const cx = activeParentId === VIRTUAL_CENTER ? 0 : graph.nodes[activeParentId].position.x;
    const cz = activeParentId === VIRTUAL_CENTER ? 0 : graph.nodes[activeParentId].position.z;

    for (const childId of children) {
      const nx = graph.nodes[childId].position.x;
      const nz = graph.nodes[childId].position.z;
      const dx = nx - cx;
      const dz = nz - cz;
      const r = Math.sqrt(dx * dx + dz * dz);
      if (r < 0.01) continue;

      onRing[childId] = 1;
      centerX[childId] = cx;
      centerZ[childId] = cz;
      baseAngle[childId] = Math.atan2(dz, dx);
      radius[childId] = r;
    }

    return { onRing, centerX, centerZ, baseAngle, radius };
  }, [graph, viewState, nodeCount]);

  // Reuse edge buffers (avoid per-frame allocations)
  const edgePosRef = useRef<Float32Array>(new Float32Array(Math.max(1, graph.edges.length) * 6));
  const edgeAlphaRef = useRef<Float32Array>(new Float32Array(Math.max(1, graph.edges.length) * 2));
  const hlEdgePosRef = useRef<Float32Array>(new Float32Array(Math.max(1, graph.edges.length) * 6));
  const hlEdgeAlphaRef = useRef<Float32Array>(new Float32Array(Math.max(1, graph.edges.length) * 2));
  const trailEdgePosRef = useRef<Float32Array>(new Float32Array(64 * 6));
  const trailEdgeAlphaRef = useRef<Float32Array>(new Float32Array(64 * 2));
  // Cross-edge Bézier buffers (8 segments per edge)
  const crossEdgePosRef = useRef<Float32Array>(new Float32Array(256 * 6));
  const crossEdgeAlphaRef = useRef<Float32Array>(new Float32Array(256 * 2));
  const orbitLinesRef = useRef<THREE.LineSegments>(null);
  const orbitPosRef = useRef<Float32Array>(new Float32Array(512 * 6));
  const orbitAlphaRef = useRef<Float32Array>(new Float32Array(512 * 2));

  // Visible nodes set (subgraph mode)
  const visibleNodes = useMemo(() => {
    if (viewState.mode === "overview") return null;
    return new Set(viewState.visibleNodeIds);
  }, [viewState]);

  // Targets: positions/scales/colors
  const targets = useMemo(() => {
    const positions = new Float32Array(nodeCount * 3);
    const scales = new Float32Array(nodeCount);
    const colors = new Float32Array(nodeCount * 3);
    const alphas = new Float32Array(nodeCount);

    // Always use fixed positions from the graph — no repositioning on selection
    for (let i = 0; i < nodeCount; i++) {
      const node = graph.nodes[i];
      const i3 = i * 3;

      positions[i3] = node.position.x;
      positions[i3 + 1] = node.position.y;
      positions[i3 + 2] = node.position.z;
    }

    // Selected node = big with glow; everything else = same small point
    const SELECTED_SCALE = 0.6;
    const NODE_SCALE = 0.4;

    // Alpha drops per depth from selected; siblings denser than the rest
    const alphaByDepth = (d: number) =>
      d === 0 ? 1.0 : d === 1 ? 0.85 : d === 2 ? 0.35 : 0.15;

    // Base color for all nodes — alpha controls depth fading via color multiply
    const BASE_R = 0.45, BASE_G = 0.85, BASE_B = 0.95;

    if (viewState.mode === "overview") {
      const depthMap = graph.initialDepthMap;
      for (let i = 0; i < nodeCount; i++) {
        const i3 = i * 3;
        const depth = depthMap?.get(i) ?? 0;

        scales[i] = depth === 0 ? SELECTED_SCALE : NODE_SCALE;
        const a = alphaByDepth(depth);
        colors[i3] = BASE_R * a;
        colors[i3 + 1] = BASE_G * a;
        colors[i3 + 2] = BASE_B * a;
        alphas[i] = a;
      }
    } else {
      const selectedId = viewState.selectedNodeId;
      const visibleSet = new Set(viewState.visibleNodeIds);

      for (let i = 0; i < nodeCount; i++) {
        const i3 = i * 3;

        if (!visibleSet.has(i)) {
          scales[i] = 0;
          colors[i3] = 0;
          colors[i3 + 1] = 0;
          colors[i3 + 2] = 0;
          alphas[i] = 0;
          continue;
        }

        const relDepth = i === selectedId ? 0 : (viewState.depthMap.get(i) ?? 999);

        scales[i] = relDepth === 0 ? SELECTED_SCALE : NODE_SCALE;
        const a = relDepth === -1 ? 0.3 : alphaByDepth(relDepth);
        colors[i3] = BASE_R * a;
        colors[i3 + 1] = BASE_G * a;
        colors[i3 + 2] = BASE_B * a;
        alphas[i] = a;
      }
    }

    return { positions, scales, colors, alphas };
  }, [graph, viewState, nodeCount, maxDegree]);

  const { treeEdges, crossEdges, targetEdges } = useMemo(() => {
    let allEdges: GraphEdge[];
    if (viewState.mode === "overview") {
      allEdges = graph.edges;
    } else {
      const visibleSet = new Set(viewState.visibleNodeIds);
      const sel = viewState.selectedNodeId;
      const tes = graph.treeEdgeSet;
      allEdges = graph.edges.filter((e) => {
        if (!visibleSet.has(e.src) || !visibleSet.has(e.dst)) return false;
        // Always show edges touching the selected node
        if (e.src === sel || e.dst === sel) return true;
        // Otherwise only tree edges
        return tes ? tes.has(edgeKey(e.src, e.dst)) : true;
      });
    }

    const tes = graph.treeEdgeSet;
    if (!tes || tes.size === 0) {
      return { treeEdges: allEdges, crossEdges: [] as GraphEdge[], targetEdges: allEdges };
    }

    const tree: GraphEdge[] = [];
    const cross: GraphEdge[] = [];
    // Collect raw cross-edge keys (from original graph edges not in tree)
    const rawCrossKeys = new Set<string>();
    for (const e of graph.edges) {
      if (!tes.has(edgeKey(e.src, e.dst))) {
        rawCrossKeys.add(edgeKey(e.src, e.dst));
      }
    }
    // Classify: ring-chain synthetic edges are NOT in rawCrossKeys → treated as tree
    for (const e of allEdges) {
      if (rawCrossKeys.has(edgeKey(e.src, e.dst))) {
        cross.push(e);
      } else {
        tree.push(e);
      }
    }
    return { treeEdges: tree, crossEdges: cross, targetEdges: allEdges };
  }, [graph, viewState]);

  const selectedId = viewState.mode === "subgraph" ? viewState.selectedNodeId : null;
  const navigationHistory = viewState.mode === "subgraph" ? viewState.navigationHistory : [];



  const highlightedEdges = useMemo(() => {
    const ids = new Set<number>();
    if (hovered !== null) {
      ids.add(hovered);
      if (hoveredRelated) {
        for (const id of hoveredRelated) ids.add(id);
      }
    }
    if (selectedId !== null) ids.add(selectedId);
    if (ids.size === 0) return [];
    return targetEdges.filter((e) => ids.has(e.src) && ids.has(e.dst));
  }, [hovered, hoveredRelated, selectedId, targetEdges]);

  // Transition
  const transitionProgress = useRef(1);
  useEffect(() => {
    transitionProgress.current = 0;
  }, [targets, nodeCount]);

  // Initialize once
  useEffect(() => {
    for (let i = 0; i < nodeCount; i++) {
      const i3 = i * 3;
      currentPos.current[i3] = targets.positions[i3];
      currentPos.current[i3 + 1] = targets.positions[i3 + 1];
      currentPos.current[i3 + 2] = targets.positions[i3 + 2];
      currentScale.current[i] = targets.scales[i];
      currentColor.current[i3] = targets.colors[i3];
      currentColor.current[i3 + 1] = targets.colors[i3 + 1];
      currentColor.current[i3 + 2] = targets.colors[i3 + 2];
      currentAlpha.current[i] = targets.alphas[i];
    }
    setLabelPos(new Float32Array(currentPos.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Attach per-instance progress attribute
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const attr = new THREE.InstancedBufferAttribute(progressArray.current, 1);
    mesh.geometry.setAttribute("instanceProgress", attr);
    progressAttrRef.current = attr;
    const alphaAttr = new THREE.InstancedBufferAttribute(currentAlpha.current, 1);
    mesh.geometry.setAttribute("instanceAlpha", alphaAttr);
    alphaAttrRef.current = alphaAttr;
  }, [nodeCount]);

  // Custom sphere raycast (because planeGeometry is edge-on for triangle tests)
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    mesh.raycast = (raycaster, intersects) => {
      for (let i = 0; i < nodeCount; i++) {
        mesh.getMatrixAt(i, _mat4);
        _mat4.decompose(_pos, _quat, _scale);
        if (_scale.x < 0.01) continue;

        _sphere.center.copy(_pos);
        // Icon nodes have shrunken billboard scale; use base scale for hit testing
        const baseScale = graph.nodes[i].icon ? _scale.x / 0.3 : _scale.x;
        _sphere.radius = baseScale * 1.5;

        if (raycaster.ray.intersectSphere(_sphere, _hitPoint)) {
          const distance = raycaster.ray.origin.distanceTo(_hitPoint);
          if (distance >= raycaster.near && distance <= raycaster.far) {
            intersects.push({
              distance,
              point: _hitPoint.clone(),
              instanceId: i,
              object: mesh,
            } as THREE.Intersection);
          }
        }
      }
    };
  }, [nodeCount]);


  useFrame(({ camera, pointer }, delta) => {
    const mesh = meshRef.current;
    const lines = linesRef.current;
    if (!mesh) return;

    // Build per-node pulse intensity (0 = none, 1 = full)
    const pulseIntensity = new Float32Array(nodeCount);
    if (pulses && pulses.length > 0) {
      for (const p of pulses) {
        // Sharp flash: source peaks fast then fades, destination peaks at arrival
        const srcI = p.progress < 0.3 ? 1 : Math.max(0, 1 - (p.progress - 0.3) / 0.3);
        const dstI = p.progress < 0.5 ? 0 : Math.min(1, (p.progress - 0.5) / 0.2);
        pulseIntensity[p.src] = Math.max(pulseIntensity[p.src], srcI);
        pulseIntensity[p.dst] = Math.max(pulseIntensity[p.dst], dstI);
      }
    }

    // Fisheye: project cursor onto XZ ground plane
    if (ringData && !minimap) {
      _fishPointer.set(pointer.x, pointer.y);
      _fishRaycaster.setFromCamera(_fishPointer, camera);
      if (_fishRaycaster.ray.intersectPlane(_fishPlane, _fishHit)) {
        cursorXZ.current.x = _fishHit.x;
        cursorXZ.current.z = _fishHit.z;
      }
    }

    if (transitionProgress.current < 1) {
      transitionProgress.current = Math.min(1, transitionProgress.current + delta / 0.8);
    }
    const t = smoothstep(transitionProgress.current);

    // Animate nodes
    for (let i = 0; i < nodeCount; i++) {
      const i3 = i * 3;

      // Default: label at node position, nimbus = 1
      fisheyeLabelPos.current[i3] = targets.positions[i3];
      fisheyeLabelPos.current[i3 + 1] = targets.positions[i3 + 1];
      fisheyeLabelPos.current[i3 + 2] = targets.positions[i3 + 2];
      nimbusScale.current[i] += (1 - nimbusScale.current[i]) * 0.1;

      // Animate position (no distortion, always lerp to target)
      currentPos.current[i3] += (targets.positions[i3] - currentPos.current[i3]) * t;
      currentPos.current[i3 + 1] += (targets.positions[i3 + 1] - currentPos.current[i3 + 1]) * t;
      currentPos.current[i3 + 2] += (targets.positions[i3 + 2] - currentPos.current[i3 + 2]) * t;

      currentScale.current[i] += (targets.scales[i] - currentScale.current[i]) * t;

      currentColor.current[i3] += (targets.colors[i3] - currentColor.current[i3]) * t;
      currentColor.current[i3 + 1] += (targets.colors[i3 + 1] - currentColor.current[i3 + 1]) * t;
      currentColor.current[i3 + 2] += (targets.colors[i3 + 2] - currentColor.current[i3 + 2]) * t;

      currentAlpha.current[i] += (targets.alphas[i] - currentAlpha.current[i]) * t;

      // Update per-instance progress for shader
      progressArray.current[i] = graph.nodes[i].progress ?? -1;

      // Apply nimbus scale (fisheye proximity effect)
      const nimbus = nimbusScale.current[i];
      let s = graph.nodes[i].icon ? Math.max(currentScale.current[i] * nimbus * 0.3, 0.001) : Math.max(currentScale.current[i] * nimbus, 0.001);

      // Boost glow when camera is approaching this node
      if (approachRef.current.nodeId === i && approachRef.current.progress > 0) {
        s *= 1 + 0.5 * approachRef.current.progress;
      }

      // Shrink whiteboard node glow so the panel is readable
      if (wbNodeId !== null && i === wbNodeId) {
        s *= 0.01;
      }

      tmpObj.position.set(
        currentPos.current[i3],
        currentPos.current[i3 + 1],
        currentPos.current[i3 + 2]
      );
      tmpObj.scale.setScalar(s);
      tmpObj.updateMatrix();
      mesh.setMatrixAt(i, tmpObj.matrix);

      if (i === hovered) {
        tmpColor.setRGB(1.0, 0.2, 0.2);
      } else if (hoveredRelated && hoveredRelated.has(i)) {
        tmpColor.setRGB(0.8, 0.15, 0.15);
      } else if (graph.nodes[i].status === "executing") {
        tmpColor.setRGB(0.2, 1.0, 0.4);
      } else {
        tmpColor.setRGB(
          currentColor.current[i3],
          currentColor.current[i3 + 1],
          currentColor.current[i3 + 2],
        );
      }

      // Search match: bright pulsing highlight
      if (searchMatches && searchMatches.size > 0) {
        if (searchMatches.has(i)) {
          tmpColor.setRGB(1.0, 0.85, 0.2);
        } else {
          tmpColor.multiplyScalar(0.15);
        }
      }

      // Dim non-whiteboard nodes when detail panel is open
      if (wbNodeId !== null && i !== wbNodeId) {
        tmpColor.multiplyScalar(0.2);
      }

      // Pulse: hot white flash with scale burst
      const pi = pulseIntensity[i];
      if (pi > 0) {
        const flash = pi * pi; // sharper falloff
        tmpColor.r += (1.5 - tmpColor.r) * flash;
        tmpColor.g += (1.5 - tmpColor.g) * flash;
        tmpColor.b += (1.8 - tmpColor.b) * flash;
        s *= 1 + 1.2 * flash;
      }

      mesh.setColorAt(i, tmpColor);
    }

    // Semantic zoom disabled for performance
    approachRef.current = { nodeId: -1, progress: 0 };

    // Fisheye pass: find nearest ring nodes to cursor, enlarge them, shrink the rest
    if (ringData && !minimap) {
      const REVEAL_COUNT = 7;
      const REVEAL_ANGLE = Math.PI * 0.12; // angular window for reveal

      // Collect ring nodes with angular distance to cursor
      const ringCandidates: { idx: number; ad: number }[] = [];
      for (let i = 0; i < nodeCount; i++) {
        if (!ringData.onRing[i] || targets.scales[i] < 0.01) continue;
        const cx = ringData.centerX[i];
        const cz = ringData.centerZ[i];
        const focusAngle = Math.atan2(cursorXZ.current.z - cz, cursorXZ.current.x - cx);
        let ad = ringData.baseAngle[i] - focusAngle;
        if (ad > Math.PI) ad -= Math.PI * 2;
        if (ad < -Math.PI) ad += Math.PI * 2;
        ringCandidates.push({ idx: i, ad: Math.abs(ad) });
      }

      // Sort by angular distance, pick nearest
      ringCandidates.sort((a, b) => a.ad - b.ad);
      const revealed = new Set<number>();
      for (let j = 0; j < Math.min(REVEAL_COUNT, ringCandidates.length); j++) {
        if (ringCandidates[j].ad < REVEAL_ANGLE) {
          revealed.add(ringCandidates[j].idx);
        }
      }

      fisheyeRevealedRef.current = revealed;

      // Apply nimbus only when cursor is actually near the ring (has revealed nodes)
      if (revealed.size > 0) {
        for (const c of ringCandidates) {
          const ri = c.idx;
          const ri3 = ri * 3;
          if (revealed.has(ri)) {
            // Grow nimbus + compute distorted label position
            nimbusScale.current[ri] += (1.8 - nimbusScale.current[ri]) * 0.15;

            // Distorted label: spread revealed labels apart
            const cx = ringData.centerX[ri];
            const cz = ringData.centerZ[ri];
            const focusAngle = Math.atan2(cursorXZ.current.z - cz, cursorXZ.current.x - cx);
            let ad = ringData.baseAngle[ri] - focusAngle;
            if (ad > Math.PI) ad -= Math.PI * 2;
            if (ad < -Math.PI) ad += Math.PI * 2;
            const sign = ad >= 0 ? 1 : -1;
            const norm = Math.abs(ad) / Math.PI;
            const distorted = (FISHEYE_D + 1) * norm / (FISHEYE_D * norm + 1);
            const labelAngle = focusAngle + sign * Math.PI * distorted;
            const r = ringData.radius[ri];
            fisheyeLabelPos.current[ri3] = cx + Math.cos(labelAngle) * (r * 1.15);
            fisheyeLabelPos.current[ri3 + 2] = cz + Math.sin(labelAngle) * (r * 1.15);
          } else {
            // Gentle shrink for non-revealed ring nodes
            nimbusScale.current[ri] += (0.7 - nimbusScale.current[ri]) * 0.1;
          }

          // Re-apply nimbus to instance matrix
          const nimbus = nimbusScale.current[ri];
          const baseScale = currentScale.current[ri];
          const s = graph.nodes[ri].icon
            ? Math.max(baseScale * nimbus * 0.3, 0.001)
            : Math.max(baseScale * nimbus, 0.001);
          tmpObj.position.set(
            currentPos.current[ri3],
            currentPos.current[ri3 + 1],
            currentPos.current[ri3 + 2]
          );
          tmpObj.scale.setScalar(s);
          tmpObj.updateMatrix();
          mesh.setMatrixAt(ri, tmpObj.matrix);
        }
      } else {
        // Cursor not near any ring — restore all nimbus to 1.0
        for (const c of ringCandidates) {
          nimbusScale.current[c.idx] += (1 - nimbusScale.current[c.idx]) * 0.1;
        }
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (progressAttrRef.current) progressAttrRef.current.needsUpdate = true;
    if (alphaAttrRef.current) alphaAttrRef.current.needsUpdate = true;

    // Tree edges (straight lines — reuse buffer)
    if (lines) {
      const edgeCount = treeEdges.length;
      let pos = edgePosRef.current;
      if (pos.length < edgeCount * 6) {
        pos = new Float32Array(edgeCount * 6);
        edgePosRef.current = pos;
      }
      let eAlpha = edgeAlphaRef.current;
      if (eAlpha.length < edgeCount * 2) {
        eAlpha = new Float32Array(edgeCount * 2);
        edgeAlphaRef.current = eAlpha;
      }

      for (let i = 0; i < edgeCount; i++) {
        const e = treeEdges[i];
        const s3 = e.src * 3;
        const d3 = e.dst * 3;
        const base = i * 6;
        pos[base] = currentPos.current[s3];
        pos[base + 1] = currentPos.current[s3 + 1];
        pos[base + 2] = currentPos.current[s3 + 2];
        pos[base + 3] = currentPos.current[d3];
        pos[base + 4] = currentPos.current[d3 + 1];
        pos[base + 5] = currentPos.current[d3 + 2];
        const ab = i * 2;
        eAlpha[ab] = currentAlpha.current[e.src];
        eAlpha[ab + 1] = currentAlpha.current[e.dst];
      }

      const geom = lines.geometry as THREE.BufferGeometry;
      geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geom.setAttribute("alpha", new THREE.BufferAttribute(eAlpha, 1));
      geom.attributes.position.needsUpdate = true;
      geom.attributes.alpha.needsUpdate = true;
      geom.setDrawRange(0, edgeCount * 2);
    }

    // Cross-edges (Bézier curves — 8 line segments per edge)
    const crossLines = crossLinesRef.current;
    if (crossLines) {
      const SUBDIVS = 8;
      const crossCount = crossEdges.length;
      const segCount = crossCount * SUBDIVS;
      let cPos = crossEdgePosRef.current;
      if (cPos.length < segCount * 6) {
        cPos = new Float32Array(segCount * 6);
        crossEdgePosRef.current = cPos;
      }
      let cAlpha = crossEdgeAlphaRef.current;
      if (cAlpha.length < segCount * 2) {
        cAlpha = new Float32Array(segCount * 2);
        crossEdgeAlphaRef.current = cAlpha;
      }

      for (let i = 0; i < crossCount; i++) {
        const e = crossEdges[i];
        const s3 = e.src * 3;
        const d3 = e.dst * 3;
        const ax = currentPos.current[s3], ay = currentPos.current[s3 + 1], az = currentPos.current[s3 + 2];
        const bx = currentPos.current[d3], by = currentPos.current[d3 + 1], bz = currentPos.current[d3 + 2];

        // Control point: midpoint pulled toward origin + Y lift
        const mx = (ax + bx) * 0.5;
        const my = (ay + by) * 0.5;
        const mz = (az + bz) * 0.5;
        // Pull toward origin by 30%
        const cx = mx * 0.7;
        const cy = my + 3; // slight Y lift
        const cz = mz * 0.7;

        const alpha = Math.min(currentAlpha.current[e.src], currentAlpha.current[e.dst]);
        const baseIdx = i * SUBDIVS;

        for (let s = 0; s < SUBDIVS; s++) {
          const t0 = s / SUBDIVS;
          const t1 = (s + 1) / SUBDIVS;
          // Quadratic Bézier: B(t) = (1-t)²A + 2(1-t)tC + t²B
          const omt0 = 1 - t0, omt1 = 1 - t1;
          const p0x = omt0 * omt0 * ax + 2 * omt0 * t0 * cx + t0 * t0 * bx;
          const p0y = omt0 * omt0 * ay + 2 * omt0 * t0 * cy + t0 * t0 * by;
          const p0z = omt0 * omt0 * az + 2 * omt0 * t0 * cz + t0 * t0 * bz;
          const p1x = omt1 * omt1 * ax + 2 * omt1 * t1 * cx + t1 * t1 * bx;
          const p1y = omt1 * omt1 * ay + 2 * omt1 * t1 * cy + t1 * t1 * by;
          const p1z = omt1 * omt1 * az + 2 * omt1 * t1 * cz + t1 * t1 * bz;

          const vi = (baseIdx + s) * 6;
          cPos[vi] = p0x; cPos[vi + 1] = p0y; cPos[vi + 2] = p0z;
          cPos[vi + 3] = p1x; cPos[vi + 4] = p1y; cPos[vi + 5] = p1z;
          const ai = (baseIdx + s) * 2;
          cAlpha[ai] = alpha;
          cAlpha[ai + 1] = alpha;
        }
      }

      const crossGeom = crossLines.geometry as THREE.BufferGeometry;
      crossGeom.setAttribute("position", new THREE.BufferAttribute(cPos, 3));
      crossGeom.setAttribute("alpha", new THREE.BufferAttribute(cAlpha, 1));
      crossGeom.attributes.position.needsUpdate = true;
      crossGeom.attributes.alpha.needsUpdate = true;
      crossGeom.setDrawRange(0, segCount * 2);
    }

    // Highlighted edges
    const hl = highlightLinesRef.current;
    if (hl) {
      const hlCount = highlightedEdges.length;
      if (hlCount > 0) {
        let hlPos = hlEdgePosRef.current;
        if (hlPos.length < hlCount * 6) {
          hlPos = new Float32Array(hlCount * 6);
          hlEdgePosRef.current = hlPos;
        }
        let hlAlpha = hlEdgeAlphaRef.current;
        if (hlAlpha.length < hlCount * 2) {
          hlAlpha = new Float32Array(hlCount * 2);
          hlEdgeAlphaRef.current = hlAlpha;
        }

        for (let i = 0; i < hlCount; i++) {
          const e = highlightedEdges[i];
          const s3 = e.src * 3;
          const d3 = e.dst * 3;
          const base = i * 6;
          hlPos[base] = currentPos.current[s3];
          hlPos[base + 1] = currentPos.current[s3 + 1];
          hlPos[base + 2] = currentPos.current[s3 + 2];
          hlPos[base + 3] = currentPos.current[d3];
          hlPos[base + 4] = currentPos.current[d3 + 1];
          hlPos[base + 5] = currentPos.current[d3 + 2];
          const ab = i * 2;
          hlAlpha[ab] = currentAlpha.current[e.src];
          hlAlpha[ab + 1] = currentAlpha.current[e.dst];
        }

        const hlGeom = hl.geometry as THREE.BufferGeometry;
        hlGeom.setAttribute("position", new THREE.BufferAttribute(hlPos, 3));
        hlGeom.setAttribute("alpha", new THREE.BufferAttribute(hlAlpha, 1));
        hlGeom.attributes.position.needsUpdate = true;
        hlGeom.attributes.alpha.needsUpdate = true;
        hlGeom.setDrawRange(0, hlCount * 2);
      } else {
        (hl.geometry as THREE.BufferGeometry).setDrawRange(0, 0);
      }
    }

    // Breadcrumb trail edge (last two nodes only)
    const trail = trailLinesRef.current;
    if (trail) {
      const len = navigationHistory.length;
      if (len >= 2) {
        const srcId = navigationHistory[len - 2];
        const dstId = navigationHistory[len - 1];
        const s3 = srcId * 3;
        const d3 = dstId * 3;
        const tPos = trailEdgePosRef.current;
        tPos[0] = currentPos.current[s3];
        tPos[1] = currentPos.current[s3 + 1];
        tPos[2] = currentPos.current[s3 + 2];
        tPos[3] = currentPos.current[d3];
        tPos[4] = currentPos.current[d3 + 1];
        tPos[5] = currentPos.current[d3 + 2];
        const tAlpha = trailEdgeAlphaRef.current;
        tAlpha[0] = 0.6;
        tAlpha[1] = 0.6;

        const tGeom = trail.geometry as THREE.BufferGeometry;
        tGeom.setAttribute("position", new THREE.BufferAttribute(tPos, 3));
        tGeom.setAttribute("alpha", new THREE.BufferAttribute(tAlpha, 1));
        tGeom.attributes.position.needsUpdate = true;
        tGeom.attributes.alpha.needsUpdate = true;
        tGeom.setDrawRange(0, 2);
      } else {
        (trail.geometry as THREE.BufferGeometry).setDrawRange(0, 0);
      }
    }


    // Debug cylinders for ALL nodes with children
    const orbit = orbitLinesRef.current;
    if (orbit && SHOW_HELPERS) {
      const orbitGeom = orbit.geometry as THREE.BufferGeometry;
      const TAU = Math.PI * 2;
      const CIRC = 32;
      const normA = (v: number) => ((v % TAU) + TAU) % TAU;

      const selId = viewState.mode === "subgraph" ? viewState.selectedNodeId : -1;
      const subDepthMap = viewState.mode === "subgraph"
        ? (viewState as { depthMap: Map<number, number> }).depthMap : null;

      const getDepth = (id: number): number | undefined => {
        if (viewState.mode === "overview") return graph.initialDepthMap?.get(id);
        if (id === selId) return 0;
        return subDepthMap?.get(id);
      };

      let vi = 0, ai = 0;

      // Pre-size buffers generously (resize below if needed)
      const maxSegs = nodeCount * (CIRC * 2 + 30);
      let posBuf = orbitPosRef.current;
      if (posBuf.length < maxSegs * 6) {
        posBuf = new Float32Array(maxSegs * 6);
        orbitPosRef.current = posBuf;
      }
      let alphaBuf = orbitAlphaRef.current;
      if (alphaBuf.length < maxSegs * 2) {
        alphaBuf = new Float32Array(maxSegs * 2);
        orbitAlphaRef.current = alphaBuf;
      }

      for (let nodeId = 0; nodeId < nodeCount; nodeId++) {
        if (visibleNodes && !visibleNodes.has(nodeId)) continue;
        const nd = getDepth(nodeId);
        if (nd === undefined) continue;

        // Find children (depth + 1)
        const kids: number[] = [];
        for (const n of graph.adj[nodeId]) {
          if (visibleNodes && !visibleNodes.has(n)) continue;
          if (getDepth(n) === nd + 1) kids.push(n);
        }
        if (kids.length === 0) continue;

        const n3 = nodeId * 3;
        const px = currentPos.current[n3];
        const py = currentPos.current[n3 + 1];
        const pz = currentPos.current[n3 + 2];

        let totalR = 0, kidY = py;
        for (const cid of kids) {
          const c3 = cid * 3;
          const dx = currentPos.current[c3] - px;
          const dz = currentPos.current[c3 + 2] - pz;
          totalR += Math.sqrt(dx * dx + dz * dz);
          kidY = currentPos.current[c3 + 1];
        }
        const avgR = totalR / kids.length;
        if (avgR < 0.1) continue;

        const halfGap = (py - kidY) / 2;
        const topY = py + halfGap;
        const botY = py - halfGap;

        const isHovered = nodeId === hovered;
        const baseAlpha = isHovered ? 1.0 : 0.25;

        // Sort children by angle for wedge boundaries
        const childAngles = kids.map(cid => {
          const c3 = cid * 3;
          return normA(Math.atan2(
            currentPos.current[c3 + 2] - pz,
            currentPos.current[c3] - px,
          ));
        }).sort((x, y) => x - y);

        const bounds: number[] = [];
        for (let i = 0; i < childAngles.length; i++) {
          const ca = childAngles[i];
          const cb = i < childAngles.length - 1 ? childAngles[i + 1] : childAngles[0] + TAU;
          bounds.push((ca + cb) / 2);
        }

        // Ensure buffer space
        const needed = vi + (CIRC * 2 + bounds.length * 3) * 6;
        if (needed > posBuf.length) {
          const bigger = new Float32Array(needed * 2);
          bigger.set(posBuf);
          posBuf = bigger;
          orbitPosRef.current = posBuf;
          const biggerA = new Float32Array((needed / 3) * 2);
          biggerA.set(alphaBuf);
          alphaBuf = biggerA;
          orbitAlphaRef.current = alphaBuf;
        }

        // Top ring
        for (let i = 0; i < CIRC; i++) {
          const a1 = (i / CIRC) * TAU;
          const a2 = ((i + 1) / CIRC) * TAU;
          posBuf[vi++] = px + Math.cos(a1) * avgR; posBuf[vi++] = topY; posBuf[vi++] = pz + Math.sin(a1) * avgR;
          posBuf[vi++] = px + Math.cos(a2) * avgR; posBuf[vi++] = topY; posBuf[vi++] = pz + Math.sin(a2) * avgR;
          alphaBuf[ai++] = 0.5 * baseAlpha; alphaBuf[ai++] = 0.5 * baseAlpha;
        }

        // Bottom ring
        for (let i = 0; i < CIRC; i++) {
          const a1 = (i / CIRC) * TAU;
          const a2 = ((i + 1) / CIRC) * TAU;
          posBuf[vi++] = px + Math.cos(a1) * avgR; posBuf[vi++] = botY; posBuf[vi++] = pz + Math.sin(a1) * avgR;
          posBuf[vi++] = px + Math.cos(a2) * avgR; posBuf[vi++] = botY; posBuf[vi++] = pz + Math.sin(a2) * avgR;
          alphaBuf[ai++] = 0.5 * baseAlpha; alphaBuf[ai++] = 0.5 * baseAlpha;
        }

        // Vertical struts + boundary lines on both caps
        for (const bAngle of bounds) {
          const ex = px + Math.cos(bAngle) * avgR;
          const ez = pz + Math.sin(bAngle) * avgR;
          posBuf[vi++] = ex; posBuf[vi++] = topY; posBuf[vi++] = ez;
          posBuf[vi++] = ex; posBuf[vi++] = botY; posBuf[vi++] = ez;
          alphaBuf[ai++] = 0.4 * baseAlpha; alphaBuf[ai++] = 0.7 * baseAlpha;
          posBuf[vi++] = px; posBuf[vi++] = topY; posBuf[vi++] = pz;
          posBuf[vi++] = ex; posBuf[vi++] = topY; posBuf[vi++] = ez;
          alphaBuf[ai++] = 0.2 * baseAlpha; alphaBuf[ai++] = 0.4 * baseAlpha;
          posBuf[vi++] = px; posBuf[vi++] = botY; posBuf[vi++] = pz;
          posBuf[vi++] = ex; posBuf[vi++] = botY; posBuf[vi++] = ez;
          alphaBuf[ai++] = 0.3 * baseAlpha; alphaBuf[ai++] = 0.6 * baseAlpha;
        }
      }

      const totalVerts = vi / 3;
      orbitGeom.setAttribute("position", new THREE.BufferAttribute(posBuf, 3));
      orbitGeom.setAttribute("alpha", new THREE.BufferAttribute(alphaBuf, 1));
      orbitGeom.attributes.position.needsUpdate = true;
      orbitGeom.attributes.alpha.needsUpdate = true;
      orbitGeom.setDrawRange(0, totalVerts);
    }

    // Labels follow animation (10 fps)
    labelAccum.current += delta;
    if (labelAccum.current > 0.033) {
      labelAccum.current = 0;
      // Labels use fisheye-distorted positions (nodes stay fixed)
      const lp = new Float32Array(nodeCount * 3);
      for (let i = 0; i < nodeCount; i++) {
        const i3 = i * 3;
        // Lerp label toward fisheye target position
        lp[i3] = currentPos.current[i3] + (fisheyeLabelPos.current[i3] - currentPos.current[i3]) * 0.5;
        lp[i3 + 1] = currentPos.current[i3 + 1];
        lp[i3 + 2] = currentPos.current[i3 + 2] + (fisheyeLabelPos.current[i3 + 2] - currentPos.current[i3 + 2]) * 0.5;
      }
      setLabelPos(lp);
      // Sync fisheye-revealed nodes for label display
      setFisheyeRevealed(new Set(fisheyeRevealedRef.current));
      // Sync approach indicator to React state
      setApproachState({ ...approachRef.current });
    }

    // Animate detail panel opacity
    const targetOpacity = wbNodeId !== null ? 1.0 : 0.0;
    detailPanelOpacity.current += (targetOpacity - detailPanelOpacity.current) * Math.min(1, delta * 4);
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.instanceId === undefined) return;
    if (visibleNodes && !visibleNodes.has(e.instanceId)) return;
    e.stopPropagation();
    onNodeClick(e.instanceId);
  };


  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId === undefined) return;
    if (visibleNodes && !visibleNodes.has(e.instanceId)) return;
    e.stopPropagation();
    setHovered(e.instanceId);
    document.body.style.cursor = "pointer";
  };

  const handlePointerOut = () => {
    setHovered(null);
    document.body.style.cursor = "auto";
  };

  const edgeOpacity = viewState.mode === "overview" ? 0.08 : 0.3;

  return (
    <>
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, nodeCount]}
        frustumCulled={false}
        onClick={handleClick}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <planeGeometry args={[3, 3]} />
        <shaderMaterial
          key="glow-billboard"
          vertexShader={glowVertexShader}
          fragmentShader={glowFragmentShader}
          transparent
          blending={THREE.NormalBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>

      <lineSegments ref={linesRef} frustumCulled={false}>
        <bufferGeometry />
        <shaderMaterial
          vertexShader={edgeGlowVertexShader}
          fragmentShader={edgeGlowFragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          uniforms={{
            color: { value: new THREE.Color(0.2, 0.9, 1.0) },
            opacity: { value: edgeOpacity },
          }}
        />
      </lineSegments>

      <lineSegments ref={crossLinesRef} frustumCulled={false}>
        <bufferGeometry />
        <shaderMaterial
          vertexShader={edgeGlowVertexShader}
          fragmentShader={edgeGlowFragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          uniforms={{
            color: { value: new THREE.Color(0.6, 0.3, 0.9) },
            opacity: { value: viewState.mode === "overview" ? 0.15 : 0.2 },
          }}
        />
      </lineSegments>

      <lineSegments ref={highlightLinesRef} frustumCulled={false}>
        <bufferGeometry />
        <shaderMaterial
          vertexShader={edgeGlowVertexShader}
          fragmentShader={edgeGlowFragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          uniforms={{
            color: { value: new THREE.Color(1.0, 0.2, 0.2) },
            opacity: { value: 0.45 },
          }}
        />
      </lineSegments>

      <lineSegments ref={trailLinesRef} frustumCulled={false}>
        <bufferGeometry />
        <shaderMaterial
          vertexShader={edgeGlowVertexShader}
          fragmentShader={edgeGlowFragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          uniforms={{
            color: { value: new THREE.Color(1.0, 0.7, 0.2) },
            opacity: { value: 0.6 },
          }}
        />
      </lineSegments>

      {SHOW_HELPERS && (
        <lineSegments ref={orbitLinesRef} frustumCulled={false}>
          <bufferGeometry />
          <shaderMaterial
            vertexShader={edgeGlowVertexShader}
            fragmentShader={edgeGlowFragmentShader}
            transparent
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
            uniforms={{
              color: { value: new THREE.Color(1.0, 0.5, 0.1) },
              opacity: { value: 0.45 },
            }}
          />
        </lineSegments>
      )}


      {pulses && pulses.length > 0 && (
        <PulseLayer pulses={pulses} positionsRef={currentPos} />
      )}

      {!minimap && graph.nodes.map((node, i) => {
        if (targets.scales[i] < 0.01) return null;

        // Label gating: show for depth 0-1, hovered + neighbors, cursor-revealed
        const isSelected = viewState.mode === "subgraph" && i === viewState.selectedNodeId;
        const isHovered = i === hovered;
        const isHoverNeighbor = hoveredRelated?.has(i) ?? false;
        const isCursorRevealed = fisheyeRevealed.has(i);
        const isSearchMatch = searchMatches?.has(i) ?? false;
        const isProminent = isSelected || isHovered || isHoverNeighbor || isCursorRevealed || isSearchMatch;

        // Depth-based filter: allow depth 0-1, hide deeper unless prominent
        if (!isProminent) {
          if (viewState.mode === "overview") {
            const depth = graph.initialDepthMap?.get(i) ?? 0;
            if (depth > 1) return null;
          } else {
            const selectedId = viewState.selectedNodeId;
            const depth = i === selectedId ? 0 : viewState.depthMap.get(i);
            if (depth === undefined) return null;
            if (depth !== -1 && depth > 1) return null;
          }
        }

        const i3 = i * 3;
        const isExecuting = node.status === "executing";

        // Style tiers: search > hovered > selected > cursor-revealed > default
        const labelColor = isSearchMatch ? "rgba(255,220,80,0.95)"
          : isHovered ? "rgba(255,255,255,0.95)"
          : isSelected ? "rgba(100,220,255,0.95)"
          : isHoverNeighbor ? "rgba(200,200,200,0.85)"
          : isCursorRevealed ? "rgba(180,210,240,0.85)"
          : "rgba(190,200,210,0.75)";
        const labelSize = isSearchMatch ? 14
          : isHovered || isSelected ? 14
          : isCursorRevealed || isHoverNeighbor ? 12
          : 11;

        const iconColor = node.icon
          ? isHovered
            ? "rgb(255, 51, 51)"
            : isHoverNeighbor
              ? "rgb(204, 38, 38)"
              : isExecuting
                ? "rgb(51, 255, 102)"
                : `rgb(${Math.round(currentColor.current[i3] * 255)}, ${Math.round(currentColor.current[i3 + 1] * 255)}, ${Math.round(currentColor.current[i3 + 2] * 255)})`
          : undefined;

        return (
          <group key={node.id}>
            {node.icon && (
              <Html
                position={[
                  labelPos[i * 3],
                  labelPos[i * 3 + 1],
                  labelPos[i * 3 + 2],
                ]}
                style={{
                  color: iconColor,
                  fontSize: 36,
                  pointerEvents: "none",
                  userSelect: "none",
                  transform: "translate(-50%, -50%)",
                  textShadow: `0 0 8px ${iconColor}, 0 0 20px ${iconColor}`,
                  lineHeight: 1,
                  filter: "drop-shadow(0 0 4px rgba(0,0,0,0.9))",
                }}
                center
              >
                {node.icon}
              </Html>
            )}
            <Html
              position={[
                labelPos[i * 3],
                labelPos[i * 3 + 1],
                labelPos[i * 3 + 2],
              ]}
              style={{
                color: labelColor,
                fontSize: labelSize,
                fontFamily: "'Barlow', sans-serif",
                fontWeight: isHovered || isSelected ? 600 : 500,
                letterSpacing: "0.3px",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                userSelect: "none",
                textShadow: "0 0 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.7)",
                transform: "translate(-50%, 20px)",
              }}
            >
              {node.label}
            </Html>
          </group>
        );
      })}

      {!minimap && graph.nodes.map((node, i) => {
        if (node.status !== "executing") return null;
        if (targets.scales[i] < 0.01) return null;
        return (
          <Html
            key={`prog-${node.id}`}
            position={[
              labelPos[i * 3],
              labelPos[i * 3 + 1],
              labelPos[i * 3 + 2],
            ]}
            style={{
              pointerEvents: "none",
              userSelect: "none",
              transform: "translate(12px, -28px)",
            }}
            center
          >
            <div style={{
              background: "rgba(0, 20, 5, 0.85)",
              border: "1px solid rgba(0, 255, 100, 0.5)",
              borderRadius: "4px",
              padding: "1px 5px",
              color: "rgba(0, 255, 100, 0.95)",
              fontSize: "10px",
              fontFamily: "'Barlow', sans-serif",
              fontWeight: 600,
              whiteSpace: "nowrap",
              textShadow: "0 0 6px rgba(0,255,100,0.6)",
              boxShadow: "0 0 8px rgba(0,255,100,0.15)",
            }}>
              {`${Math.round((node.progress ?? 0) * 100)}%`}
            </div>
          </Html>
        );
      })}

      {/* Approach hint — "scroll to inspect" */}
      {approachState.nodeId >= 0 && approachState.progress > 0.05 && wbNodeId === null && (() => {
        const aNode = graph.nodes[approachState.nodeId];
        const p = approachState.progress;
        return (
          <Html
            position={[aNode.position.x, aNode.position.y, aNode.position.z]}
            center
            style={{
              pointerEvents: "none",
              userSelect: "none",
              opacity: p * 0.9,
              transform: `translateY(-48px) scale(${0.8 + 0.2 * p})`,
              transition: "opacity 0.15s ease-out",
            }}
          >
            <div style={{
              background: "rgba(5, 8, 18, 0.85)",
              backdropFilter: "blur(12px)",
              border: "1px solid rgba(77, 217, 232, 0.3)",
              borderRadius: 8,
              padding: "5px 12px",
              color: "rgba(77, 217, 232, 0.9)",
              fontSize: 11,
              fontFamily: "'Barlow', sans-serif",
              fontWeight: 500,
              whiteSpace: "nowrap",
              textShadow: "0 0 8px rgba(77, 217, 232, 0.3)",
              boxShadow: `0 0 ${12 + 8 * p}px rgba(77, 217, 232, ${0.08 + 0.12 * p})`,
              letterSpacing: "0.3px",
            }}>
              scroll to inspect
            </div>
          </Html>
        );
      })()}

      {/* Node detail panel (whiteboard zoom) — screen-space overlay, always faces camera */}
      {wbNodeId !== null && detailPanelOpacity.current > 0.01 && (() => {
        const wbNode = graph.nodes[wbNodeId];
        return (
          <Html
            position={[wbNode.position.x, wbNode.position.y, wbNode.position.z]}
            center
            style={{
              opacity: detailPanelOpacity.current,
              transform: `scale(${0.85 + 0.15 * detailPanelOpacity.current})`,
              pointerEvents: "auto",
              transition: "opacity 0.05s ease-out",
            }}
          >
            <NodeDetailPanel
              node={wbNode}
              graph={graph}
              viewState={viewState}
              onClose={() => onExitWhiteboard?.()}
              onNavigate={(id) => onDetailNavigate?.(id)}
            />
          </Html>
        );
      })()}
    </>
  );
}