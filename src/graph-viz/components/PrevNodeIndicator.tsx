import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Graph, ViewState } from "../graph/types";

const _v3 = new THREE.Vector3();

interface Props {
  graph: Graph;
  viewState: ViewState;
  onNodeClick: (id: number) => void;
}

export function PrevNodeIndicator({ graph, viewState, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bracketRef = useRef<HTMLDivElement | null>(null);
  const chevronRef = useRef<HTMLDivElement | null>(null);
  const onClickRef = useRef(onNodeClick);
  onClickRef.current = onNodeClick;
  const { camera, size, gl } = useThree();

  const navigationHistory = viewState.mode === "subgraph" ? viewState.navigationHistory : [];
  const prevNodeId = navigationHistory.length >= 2 ? navigationHistory[navigationHistory.length - 2] : null;
  const prevNodeIdRef = useRef(prevNodeId);
  prevNodeIdRef.current = prevNodeId;

  useEffect(() => {
    const container = document.createElement("div");
    Object.assign(container.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "60",
      overflow: "hidden",
    });
    document.body.appendChild(container);
    containerRef.current = container;

    // --- Bracket (4 corner marks) ---
    const bracket = document.createElement("div");
    Object.assign(bracket.style, {
      position: "absolute",
      width: "42px",
      height: "42px",
      pointerEvents: "auto",
      cursor: "pointer",
      display: "none",
    });

    const cornerStyle = {
      position: "absolute",
      width: "10px",
      height: "10px",
      borderColor: "rgba(255, 128, 38, 0.55)",
      borderStyle: "solid",
      borderWidth: "0",
    };
    const corners = [
      { top: "0", left: "0", borderTopWidth: "2px", borderLeftWidth: "2px" },
      { top: "0", right: "0", borderTopWidth: "2px", borderRightWidth: "2px" },
      { bottom: "0", left: "0", borderBottomWidth: "2px", borderLeftWidth: "2px" },
      { bottom: "0", right: "0", borderBottomWidth: "2px", borderRightWidth: "2px" },
    ];
    for (const c of corners) {
      const el = document.createElement("div");
      Object.assign(el.style, cornerStyle, c);
      bracket.appendChild(el);
    }

    bracket.addEventListener("click", () => { if (prevNodeIdRef.current !== null) onClickRef.current(prevNodeIdRef.current); });
    bracket.addEventListener("mouseenter", () => {
      for (const child of bracket.children) {
        (child as HTMLElement).style.borderColor = "rgba(255, 200, 100, 0.8)";
      }
    });
    bracket.addEventListener("mouseleave", () => {
      for (const child of bracket.children) {
        (child as HTMLElement).style.borderColor = "rgba(255, 128, 38, 0.35)";
      }
    });

    container.appendChild(bracket);
    bracketRef.current = bracket;

    // --- Chevron (arrow pointing toward prev) ---
    const chevron = document.createElement("div");
    Object.assign(chevron.style, {
      position: "absolute",
      pointerEvents: "auto",
      cursor: "pointer",
      display: "none",
      width: "30px",
      height: "30px",
    });

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("width", "30");
    svg.setAttribute("height", "30");
    svg.style.overflow = "visible";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    // Chevron pointing right: two lines meeting at a point
    path.setAttribute("d", "M6 4 L14 10 L6 16");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "rgba(255, 128, 38, 0.5)");
    path.setAttribute("stroke-width", "2");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.appendChild(path);
    chevron.appendChild(svg);

    chevron.addEventListener("click", () => { if (prevNodeIdRef.current !== null) onClickRef.current(prevNodeIdRef.current); });
    chevron.addEventListener("mouseenter", () => {
      path.setAttribute("stroke", "rgba(255, 200, 100, 1.0)");
    });
    chevron.addEventListener("mouseleave", () => {
      path.setAttribute("stroke", "rgba(255, 128, 38, 0.5)");
    });

    container.appendChild(chevron);
    chevronRef.current = chevron;

    return () => {
      document.body.removeChild(container);
      containerRef.current = null;
      bracketRef.current = null;
      chevronRef.current = null;
    };
  }, []);

  useFrame(() => {
    const bracket = bracketRef.current;
    const chevron = chevronRef.current;
    if (!bracket || !chevron) return;

    if (viewState.mode !== "subgraph" || prevNodeId === null) {
      bracket.style.display = "none";
      chevron.style.display = "none";
      return;
    }

    const selectedId = viewState.selectedNodeId;
    const prevNode = graph.nodes[prevNodeId];
    const selNode = graph.nodes[selectedId];
    if (!prevNode || !selNode) return;

    const w = size.width;
    const h = size.height;
    const rect = gl.domElement.getBoundingClientRect();
    const ox = rect.left;
    const oy = rect.top;

    // Project prev node
    _v3.set(prevNode.position.x, prevNode.position.y, prevNode.position.z).project(camera);
    if (_v3.z > 1) {
      bracket.style.display = "none";
      chevron.style.display = "none";
      return;
    }
    const prevSx = ((_v3.x + 1) / 2) * w + ox;
    const prevSy = ((-_v3.y + 1) / 2) * h + oy;

    // Project selected node
    _v3.set(selNode.position.x, selNode.position.y, selNode.position.z).project(camera);
    const selSx = ((_v3.x + 1) / 2) * w + ox;
    const selSy = ((-_v3.y + 1) / 2) * h + oy;

    // --- Position bracket centered on prev node ---
    bracket.style.display = "block";
    bracket.style.left = `${prevSx - 21}px`;
    bracket.style.top = `${prevSy - 21}px`;

    // --- Position chevron near selected node, pointing toward prev ---
    const dx = prevSx - selSx;
    const dy = prevSy - selSy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) {
      chevron.style.display = "none";
      return;
    }

    const angle = Math.atan2(dy, dx);
    const offset = 35; // px from selected node center
    const chevX = selSx + (dx / dist) * offset;
    const chevY = selSy + (dy / dist) * offset;

    chevron.style.display = "block";
    chevron.style.left = `${chevX - 15}px`;
    chevron.style.top = `${chevY - 15}px`;
    const rotDeg = (angle * 180) / Math.PI;
    chevron.style.transform = `rotate(${rotDeg}deg)`;
  });

  return null;
}
