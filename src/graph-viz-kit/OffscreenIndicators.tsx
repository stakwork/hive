import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Graph, ViewState } from "./types";

const MARGIN = 40;
const MAX_INDICATORS = 30;

const _v3 = new THREE.Vector3();

interface Props {
  graph: Graph;
  viewState: ViewState;
  onNodeClick: (id: number) => void;
}

export function OffscreenIndicators({ graph, viewState, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const indicatorsRef = useRef<HTMLDivElement[]>([]);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const { camera, size } = useThree();

  useEffect(() => {
    const container = document.createElement("div");
    Object.assign(container.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "10",
      overflow: "hidden",
    });
    document.body.appendChild(container);
    containerRef.current = container;

    const indicators: HTMLDivElement[] = [];
    for (let i = 0; i < MAX_INDICATORS; i++) {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute",
        display: "none",
        pointerEvents: "auto",
        cursor: "pointer",
      });
      el.addEventListener("click", () => {
        const nid = (el as any).__nodeId as number | undefined;
        if (nid !== undefined) onNodeClickRef.current(nid);
      });
      el.addEventListener("mouseenter", () => {
        const pip = el.children[0] as HTMLElement;
        const diamond = pip?.children[0] as HTMLElement;
        const label = el.children[2] as HTMLElement;
        if (diamond) {
          diamond.style.background = "rgba(255, 200, 100, 0.95)";
          diamond.style.boxShadow = "0 0 8px rgba(255, 200, 100, 0.8), 0 0 16px rgba(255, 200, 100, 0.3)";
        }
        if (label) label.style.color = "rgba(255, 200, 100, 0.95)";
      });
      el.addEventListener("mouseleave", () => {
        const pip = el.children[0] as HTMLElement;
        const diamond = pip?.children[0] as HTMLElement;
        const label = el.children[2] as HTMLElement;
        if (diamond) {
          diamond.style.background = "rgba(77, 217, 232, 0.9)";
          diamond.style.boxShadow = "0 0 6px rgba(77, 217, 232, 0.6), 0 0 12px rgba(77, 217, 232, 0.2)";
        }
        if (label) label.style.color = "rgba(77, 217, 232, 0.85)";
      });

      // Diamond pip
      const pip = document.createElement("div");
      Object.assign(pip.style, {
        position: "absolute",
        width: "8px",
        height: "8px",
        left: "-4px",
        top: "-4px",
      });

      const diamond = document.createElement("div");
      Object.assign(diamond.style, {
        position: "absolute",
        inset: "0",
        background: "rgba(77, 217, 232, 0.9)",
        transform: "rotate(45deg)",
        borderRadius: "1px",
        boxShadow: "0 0 6px rgba(77, 217, 232, 0.6), 0 0 12px rgba(77, 217, 232, 0.2)",
      });
      pip.appendChild(diamond);

      const ring = document.createElement("div");
      Object.assign(ring.style, {
        position: "absolute",
        inset: "-4px",
        border: "1px solid rgba(77, 217, 232, 0.25)",
        borderRadius: "50%",
      });
      pip.appendChild(ring);

      el.appendChild(pip);

      // Trail line (rotated independently)
      const trail = document.createElement("div");
      Object.assign(trail.style, {
        position: "absolute",
        height: "1px",
        background: "linear-gradient(90deg, rgba(77, 217, 232, 0.4), transparent)",
        transformOrigin: "left center",
        width: "20px",
        left: "0",
        top: "0",
      });
      el.appendChild(trail);

      // Label (positioned independently, always readable)
      const label = document.createElement("div");
      Object.assign(label.style, {
        position: "absolute",
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: "11px",
        fontWeight: "500",
        letterSpacing: "0.5px",
        color: "rgba(77, 217, 232, 0.85)",
        whiteSpace: "nowrap",
        maxWidth: "90px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        textShadow: "0 0 8px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,1)",
      });
      el.appendChild(label);

      container.appendChild(el);
      indicators.push(el);
    }
    indicatorsRef.current = indicators;

    return () => {
      document.body.removeChild(container);
      containerRef.current = null;
      indicatorsRef.current = [];
    };
  }, []);

  useFrame(() => {
    const indicators = indicatorsRef.current;
    if (!indicators.length) return;

    for (let i = 0; i < MAX_INDICATORS; i++) {
      indicators[i].style.display = "none";
    }

    if (viewState.mode !== "subgraph") return;

    const w = size.width;
    const h = size.height;
    const selectedId = viewState.selectedNodeId;
    const depthMap = viewState.depthMap;

    let count = 0;

    for (const [nodeId, depth] of depthMap) {
      if (count >= MAX_INDICATORS) break;
      if (depth !== 1 || nodeId === selectedId) continue;

      const node = graph.nodes[nodeId];
      if (!node) continue;

      _v3.set(node.position.x, node.position.y, node.position.z);
      _v3.project(camera);

      const sx = ((_v3.x + 1) / 2) * w;
      const sy = ((-_v3.y + 1) / 2) * h;

      if (_v3.z > 1) continue;

      const onScreen =
        sx >= MARGIN && sx <= w - MARGIN &&
        sy >= MARGIN && sy <= h - MARGIN;
      if (onScreen) continue;

      const cx = w / 2;
      const cy = h / 2;
      const dx = sx - cx;
      const dy = sy - cy;
      const angle = Math.atan2(dy, dx);

      const edgeX = w / 2 - MARGIN;
      const edgeY = h / 2 - MARGIN;
      const absCos = Math.abs(Math.cos(angle));
      const absSin = Math.abs(Math.sin(angle));

      let clampX: number, clampY: number;
      if (edgeX * absSin <= edgeY * absCos) {
        clampX = cx + Math.sign(dx) * edgeX;
        clampY = cy + Math.tan(angle) * Math.sign(dx) * edgeX;
      } else {
        clampX = cx + (Math.sign(dy) * edgeY) / Math.tan(angle);
        clampY = cy + Math.sign(dy) * edgeY;
      }

      clampX = Math.max(MARGIN, Math.min(w - MARGIN, clampX));
      clampY = Math.max(MARGIN, Math.min(h - MARGIN, clampY));

      const el = indicators[count];
      (el as any).__nodeId = nodeId;
      el.style.display = "block";
      el.style.left = `${clampX}px`;
      el.style.top = `${clampY}px`;

      // Rotate trail to point outward (toward the off-screen node)
      const trailEl = el.children[1] as HTMLElement;
      const rotDeg = (angle * 180) / Math.PI;
      trailEl.style.transform = `rotate(${rotDeg}deg)`;

      // Position label on the inward side (toward screen center)
      const labelEl = el.children[2] as HTMLElement;
      labelEl.textContent = node.label;

      // Determine which edge we're on and offset label inward
      const onRight = clampX > w - MARGIN - 5;
      const onLeft = clampX < MARGIN + 5;
      const onBottom = clampY > h - MARGIN - 5;
      const onTop = clampY < MARGIN + 5;

      if (onRight) {
        labelEl.style.right = "14px";
        labelEl.style.left = "auto";
        labelEl.style.textAlign = "right";
      } else if (onLeft) {
        labelEl.style.left = "14px";
        labelEl.style.right = "auto";
        labelEl.style.textAlign = "left";
      } else {
        // Horizontal center — offset based on angle
        if (dx > 0) {
          labelEl.style.right = "14px";
          labelEl.style.left = "auto";
          labelEl.style.textAlign = "right";
        } else {
          labelEl.style.left = "14px";
          labelEl.style.right = "auto";
          labelEl.style.textAlign = "left";
        }
      }

      if (onTop) {
        labelEl.style.top = "10px";
        labelEl.style.bottom = "auto";
      } else if (onBottom) {
        labelEl.style.bottom = "10px";
        labelEl.style.top = "auto";
      } else {
        labelEl.style.top = "-5px";
        labelEl.style.bottom = "auto";
      }

      count++;
    }
  });

  return null;
}
