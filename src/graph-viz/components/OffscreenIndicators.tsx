import { useRef, useEffect } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Graph, ViewState } from "../graph/types";

const MARGIN = 40;
const MAX_GROUPS = 16;
const SECTOR_SIZE = (Math.PI * 2) / MAX_GROUPS;

const _v3 = new THREE.Vector3();

interface Props {
  graph: Graph;
  viewState: ViewState;
  onNodeClick: (id: number) => void;
}

interface OffscreenNode {
  nodeId: number;
  angle: number;
  clampX: number;
  clampY: number;
  dist: number;
  label: string;
  nodeType: string;
}

function clampToEdge(sx: number, sy: number, w: number, h: number) {
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

  return { clampX, clampY, angle, dist: Math.sqrt(dx * dx + dy * dy) };
}

/** Capitalize first letter */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Build a summary label from type counts */
function typeSummaryLabel(nodes: OffscreenNode[]): string {
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const t = n.nodeType || "node";
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  // Sort by count descending
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length === 1) {
    const [type, count] = sorted[0];
    return `${count} ${capitalize(type)}${count > 1 ? "s" : ""}`;
  }
  return sorted.map(([t, c]) => `${c} ${capitalize(t)}${c > 1 ? "s" : ""}`).join(", ");
}

export function OffscreenIndicators({ graph, viewState, onNodeClick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const indicatorsRef = useRef<HTMLDivElement[]>([]);
  const dropdownLayerRef = useRef<HTMLDivElement | null>(null);
  const dropdownsRef = useRef<HTMLDivElement[]>([]);
  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;
  const hoveredIdx = useRef(-1);
  const groupDataRef = useRef<Map<number, OffscreenNode[]>>(new Map());
  const { camera, size, gl } = useThree();

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

    // Separate layer for dropdowns (no overflow clipping)
    const dropdownLayer = document.createElement("div");
    Object.assign(dropdownLayer.style, {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "61",
    });
    document.body.appendChild(dropdownLayer);
    dropdownLayerRef.current = dropdownLayer;

    const indicators: HTMLDivElement[] = [];
    const dropdowns: HTMLDivElement[] = [];

    for (let i = 0; i < MAX_GROUPS; i++) {
      const idx = i;

      // Indicator: pill-shaped chip with dot + count + label
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "absolute",
        display: "none",
        pointerEvents: "auto",
        cursor: "pointer",
        transform: "translate(-50%, -50%)",
      });

      // Chip container (the visible pill)
      const chip = document.createElement("div");
      Object.assign(chip.style, {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "4px 10px 4px 8px",
        borderRadius: "14px",
        background: "rgba(8, 12, 24, 0.85)",
        border: "1px solid rgba(77, 217, 232, 0.3)",
        backdropFilter: "blur(12px)",
        boxShadow: "0 2px 12px rgba(0,0,0,0.5), 0 0 8px rgba(77, 217, 232, 0.08)",
        transition: "border-color 0.15s, box-shadow 0.15s, background 0.15s",
        whiteSpace: "nowrap",
      });
      el.appendChild(chip);

      // Dot (directional indicator)
      const dot = document.createElement("div");
      Object.assign(dot.style, {
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: "rgba(77, 217, 232, 0.9)",
        boxShadow: "0 0 6px rgba(77, 217, 232, 0.5)",
        flexShrink: "0",
        transition: "background 0.15s, box-shadow 0.15s",
      });
      chip.appendChild(dot);

      // Badge (count)
      const badge = document.createElement("span");
      Object.assign(badge.style, {
        fontSize: "11px",
        fontFamily: "'Barlow', sans-serif",
        fontWeight: "700",
        color: "rgba(77, 217, 232, 0.95)",
        lineHeight: "1",
        transition: "color 0.15s",
      });
      chip.appendChild(badge);

      // Separator
      const sep = document.createElement("div");
      Object.assign(sep.style, {
        width: "1px",
        height: "12px",
        background: "rgba(77, 217, 232, 0.2)",
        flexShrink: "0",
      });
      chip.appendChild(sep);

      // Label
      const label = document.createElement("span");
      Object.assign(label.style, {
        fontSize: "11px",
        fontFamily: "'Barlow', sans-serif",
        fontWeight: "500",
        color: "rgba(180, 200, 210, 0.8)",
        maxWidth: "120px",
        overflow: "hidden",
        textOverflow: "ellipsis",
        lineHeight: "1",
        transition: "color 0.15s",
      });
      chip.appendChild(label);

      // Dropdown (in unclipped layer)
      const dropdown = document.createElement("div");
      Object.assign(dropdown.style, {
        position: "absolute",
        display: "none",
        pointerEvents: "auto",
        background: "rgba(8, 10, 22, 0.95)",
        border: "1px solid rgba(77, 217, 232, 0.2)",
        borderRadius: "10px",
        padding: "4px 0",
        maxHeight: "240px",
        overflowY: "auto",
        minWidth: "170px",
        backdropFilter: "blur(16px)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.7), 0 0 1px rgba(77, 217, 232, 0.2)",
        zIndex: "10",
      });
      dropdownLayer.appendChild(dropdown);

      // Click → navigate to nearest
      el.addEventListener("click", () => {
        const nid = (el as any).__nodeId as number | undefined;
        if (nid !== undefined) onNodeClickRef.current(nid);
      });

      const showDropdown = () => {
        hoveredIdx.current = idx;
        chip.style.borderColor = "rgba(255, 200, 100, 0.5)";
        chip.style.boxShadow = "0 2px 16px rgba(0,0,0,0.5), 0 0 12px rgba(255, 200, 100, 0.12)";
        chip.style.background = "rgba(20, 16, 8, 0.9)";
        dot.style.background = "rgba(255, 200, 100, 0.95)";
        dot.style.boxShadow = "0 0 8px rgba(255, 200, 100, 0.6)";
        badge.style.color = "rgba(255, 200, 100, 0.95)";
        label.style.color = "rgba(255, 220, 180, 0.9)";
        const nodes = groupDataRef.current.get(idx);
        if (nodes && nodes.length > 1) {
          buildDropdown(dropdown, nodes);
          const rect = el.getBoundingClientRect();
          positionDropdown(dropdown, rect);
          dropdown.style.display = "block";
        }
      };

      const hideDropdown = () => {
        hoveredIdx.current = -1;
        chip.style.borderColor = "rgba(77, 217, 232, 0.3)";
        chip.style.boxShadow = "0 2px 12px rgba(0,0,0,0.5), 0 0 8px rgba(77, 217, 232, 0.08)";
        chip.style.background = "rgba(8, 12, 24, 0.85)";
        dot.style.background = "rgba(77, 217, 232, 0.9)";
        dot.style.boxShadow = "0 0 6px rgba(77, 217, 232, 0.5)";
        badge.style.color = "rgba(77, 217, 232, 0.95)";
        label.style.color = "rgba(180, 200, 210, 0.8)";
        dropdown.style.display = "none";
        dropdown.innerHTML = "";
      };

      el.addEventListener("mouseenter", showDropdown);
      el.addEventListener("mouseleave", (e) => {
        const related = e.relatedTarget as Node | null;
        if (related && dropdown.contains(related)) return;
        hideDropdown();
      });
      dropdown.addEventListener("mouseleave", (e) => {
        const related = e.relatedTarget as Node | null;
        if (related && el.contains(related)) return;
        hideDropdown();
      });

      container.appendChild(el);
      indicators.push(el);
      dropdowns.push(dropdown);
    }
    indicatorsRef.current = indicators;
    dropdownsRef.current = dropdowns;

    return () => {
      document.body.removeChild(container);
      document.body.removeChild(dropdownLayer);
      containerRef.current = null;
      dropdownLayerRef.current = null;
      indicatorsRef.current = [];
      dropdownsRef.current = [];
    };
  }, []);

  function positionDropdown(dropdown: HTMLElement, rect: DOMRect) {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const nearRight = rect.left > vw * 0.7;
    const nearBottom = rect.top > vh * 0.7;

    if (nearRight) {
      dropdown.style.right = `${vw - rect.left + 8}px`;
      dropdown.style.left = "auto";
    } else {
      dropdown.style.left = `${rect.right + 8}px`;
      dropdown.style.right = "auto";
    }
    if (nearBottom) {
      dropdown.style.bottom = `${Math.max(8, vh - rect.bottom)}px`;
      dropdown.style.top = "auto";
    } else {
      dropdown.style.top = `${Math.max(8, rect.top)}px`;
      dropdown.style.bottom = "auto";
    }
  }

  function buildDropdown(dropdown: HTMLElement, nodes: OffscreenNode[]) {
    dropdown.innerHTML = "";

    // Group by nodeType
    const groups = new Map<string, OffscreenNode[]>();
    for (const n of nodes) {
      const t = n.nodeType || "node";
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t)!.push(n);
    }

    // Sort groups: most items first
    const sortedGroups = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

    for (const [type, groupNodes] of sortedGroups) {
      // Section header
      const header = document.createElement("div");
      Object.assign(header.style, {
        padding: "6px 12px 3px",
        fontSize: "10px",
        fontFamily: "'Barlow', sans-serif",
        fontWeight: "600",
        color: "rgba(77, 217, 232, 0.5)",
        letterSpacing: "0.5px",
        textTransform: "uppercase",
        borderTop: sortedGroups[0][0] === type ? "none" : "1px solid rgba(77, 217, 232, 0.1)",
        marginTop: sortedGroups[0][0] === type ? "0" : "4px",
      });
      header.textContent = `${capitalize(type)}s (${groupNodes.length})`;
      dropdown.appendChild(header);

      // Items sorted by distance
      groupNodes.sort((a, b) => a.dist - b.dist);
      for (const n of groupNodes) {
        const item = document.createElement("div");
        Object.assign(item.style, {
          padding: "5px 12px",
          fontSize: "12px",
          fontFamily: "'Barlow', sans-serif",
          fontWeight: "500",
          color: "rgba(200, 210, 220, 0.9)",
          cursor: "pointer",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "200px",
          borderRadius: "4px",
          margin: "1px 4px",
        });
        item.textContent = n.label;
        item.addEventListener("mouseenter", () => {
          item.style.background = "rgba(77, 217, 232, 0.12)";
          item.style.color = "rgba(77, 217, 232, 0.95)";
        });
        item.addEventListener("mouseleave", () => {
          item.style.background = "transparent";
          item.style.color = "rgba(200, 210, 220, 0.9)";
        });
        item.addEventListener("click", (e) => {
          e.stopPropagation();
          onNodeClickRef.current(n.nodeId);
        });
        dropdown.appendChild(item);
      }
    }
  }

  useFrame(() => {
    const indicators = indicatorsRef.current;
    if (!indicators.length) return;

    // Hide non-hovered indicators
    for (let i = 0; i < MAX_GROUPS; i++) {
      if (i !== hoveredIdx.current) {
        indicators[i].style.display = "none";
      }
    }

    if (viewState.mode !== "subgraph") {
      if (hoveredIdx.current >= 0) {
        indicators[hoveredIdx.current].style.display = "none";
        hoveredIdx.current = -1;
      }
      return;
    }

    const w = size.width;
    const h = size.height;
    const rect = gl.domElement.getBoundingClientRect();
    const ox = rect.left;
    const oy = rect.top;
    const selectedId = viewState.selectedNodeId;
    const depthMap = viewState.depthMap;

    const offscreen: OffscreenNode[] = [];

    for (const [nodeId, depth] of depthMap) {
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

      const { clampX, clampY, angle, dist } = clampToEdge(sx, sy, w, h);
      offscreen.push({
        nodeId, angle, clampX, clampY, dist,
        label: node.label,
        nodeType: node.nodeType || "node",
      });
    }

    // Bin by angular sector
    const newBuckets = new Map<number, OffscreenNode[]>();
    for (const n of offscreen) {
      const a = ((n.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const bucket = Math.floor(a / SECTOR_SIZE);
      if (!newBuckets.has(bucket)) newBuckets.set(bucket, []);
      newBuckets.get(bucket)!.push(n);
    }

    // Atomically update group data (don't clear — prevents hover race)
    const newGroupData = new Map<number, OffscreenNode[]>();
    let groupIdx = 0;

    for (const [, nodes] of newBuckets) {
      if (groupIdx >= MAX_GROUPS) break;

      nodes.sort((a, b) => a.dist - b.dist);
      const nearest = nodes[0];
      const count = nodes.length;

      const avgX = nodes.reduce((s, n) => s + n.clampX, 0) / count;
      const avgY = nodes.reduce((s, n) => s + n.clampY, 0) / count;

      newGroupData.set(groupIdx, nodes);

      // Skip repositioning hovered indicator to prevent jitter
      if (groupIdx === hoveredIdx.current) {
        groupIdx++;
        continue;
      }

      const el = indicators[groupIdx];
      (el as any).__nodeId = nearest.nodeId;
      el.style.display = "block";
      el.style.left = `${avgX + ox}px`;
      el.style.top = `${avgY + oy}px`;

      // chip > [dot, badge, sep, label]
      const chipEl = el.children[0] as HTMLElement;
      const badgeEl = chipEl.children[1] as HTMLElement;
      const sepEl = chipEl.children[2] as HTMLElement;
      const labelEl = chipEl.children[3] as HTMLElement;

      if (count > 1) {
        badgeEl.textContent = `${count}`;
        badgeEl.style.display = "inline";
        sepEl.style.display = "block";
        labelEl.textContent = typeSummaryLabel(nodes);
      } else {
        badgeEl.style.display = "none";
        sepEl.style.display = "none";
        labelEl.textContent = nearest.label;
      }

      groupIdx++;
    }

    // Replace group data atomically
    groupDataRef.current = newGroupData;
  });

  return null;
}
