// EdgesGPU.tsx
import { useStoreId } from '@/stores/StoreProvider';
import { getStoreBundle } from '@/stores/createStoreFactory';
import { useDataStore } from '@/stores/useStores';
import { Link } from '@Universe/types';
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { LinkPosition } from "../..";


const edgeSettings = {
    color: "#9194A4",
    opacity: 0.05,
    lineWidth: 1,
    hoveredColor: "#ffffff",
    hoveredOpacity: 0.4,
    hoveredLineWidth: 0.3,
    selectedColor: "#ffffff",
    selectedOpacity: 0.2,
    selectedLineWidth: 0.5,
    dimmedOpacity: 0.01,  // Much lower opacity for non-related edges when there's active hover/selection
}

type Props = {
    linksPosition: Map<string, LinkPosition>
}


export function EdgesGPU({
    linksPosition,
}: Props) {
    const meshRef = useRef<THREE.Mesh>(null);
    const startRef = useRef<Float32Array>(new Float32Array());
    const endRef = useRef<Float32Array>(new Float32Array());
    const highlightRef = useRef<Float32Array>(new Float32Array()); // 0 = normal, 1 = hovered, 2 = selected

    const { size } = useThree();
    const storeId = useStoreId();
    const { nodesNormalized, linksNormalized } = useDataStore((s) => s);

    const linksArray = [...linksPosition.values()];
    const edgeCount = linksArray.length;

    // 🛡 1. Fully safe geometry creation
    const geoAndMat = useMemo(() => {
        if (edgeCount === 0) return null;

        const vCount = edgeCount * 4;
        const iCount = edgeCount * 6;

        const aStart = new Float32Array(vCount * 3);
        const aEnd = new Float32Array(vCount * 3);
        const aSide = new Float32Array(vCount);
        const aT = new Float32Array(vCount);
        const aHighlight = new Float32Array(vCount);
        const indices = new Uint32Array(iCount);

        startRef.current = aStart;
        endRef.current = aEnd;
        highlightRef.current = aHighlight;

        for (let e = 0; e < edgeCount; e++) {
            const v = e * 4;
            const i = e * 6;

            aSide[v] = -1;
            aSide[v + 1] = +1;
            aSide[v + 2] = -1;
            aSide[v + 3] = +1;

            aT[v] = 0;
            aT[v + 1] = 0;
            aT[v + 2] = 1;
            aT[v + 3] = 1;

            indices[i] = v;
            indices[i + 1] = v + 2;
            indices[i + 2] = v + 1;
            indices[i + 3] = v + 2;
            indices[i + 4] = v + 3;
            indices[i + 5] = v + 1;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        geometry.setAttribute("aStart", new THREE.BufferAttribute(aStart, 3));
        geometry.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 3));
        geometry.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
        geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 1));
        geometry.setAttribute("aHighlight", new THREE.BufferAttribute(aHighlight, 1));

        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uColor: { value: new THREE.Color(edgeSettings.color) },
                uOpacity: { value: edgeSettings.opacity },
                uLineWidth: { value: edgeSettings.lineWidth },
                uHoveredColor: { value: new THREE.Color(edgeSettings.hoveredColor) },
                uHoveredOpacity: { value: edgeSettings.hoveredOpacity },
                uHoveredLineWidth: { value: edgeSettings.hoveredLineWidth },
                uSelectedColor: { value: new THREE.Color(edgeSettings.selectedColor) },
                uSelectedOpacity: { value: edgeSettings.selectedOpacity },
                uSelectedLineWidth: { value: edgeSettings.selectedLineWidth },
                uDimmedOpacity: { value: edgeSettings.dimmedOpacity },
                uHasActiveNode: { value: 0 }, // 1 if there's any hovered or selected node, 0 otherwise
                uResolution: { value: new THREE.Vector2(1, 1) },
            },
            vertexShader: `
        uniform vec2 uResolution;
        uniform float uLineWidth;
        uniform float uHoveredLineWidth;
        uniform float uSelectedLineWidth;

        attribute vec3 aStart;
        attribute vec3 aEnd;
        attribute float aSide;
        attribute float aT;
        attribute float aHighlight;

        varying float vHighlight;

        void main() {
          vHighlight = aHighlight;
          vec4 sc = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
          vec4 ec = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);

          vec4 clip = mix(sc, ec, aT);

          vec2 sN = sc.xy / sc.w;
          vec2 eN = ec.xy / ec.w;
          vec2 dir = normalize(eN - sN);
          vec2 normal = vec2(-dir.y, dir.x);

          float aspect = uResolution.x / uResolution.y;
          normal.x *= aspect;

          // Calculate line width based on highlight state: 0 = normal, 1 = hovered, 2 = selected
          float lineWidth = uLineWidth;
          if (aHighlight > 1.5) {
            lineWidth = uSelectedLineWidth; // Selected state
          } else if (aHighlight > 0.5) {
            lineWidth = uHoveredLineWidth; // Hovered state
          }

          vec2 offset = normal * aSide * lineWidth / uResolution.y * 2.0;

          vec2 ndc = clip.xy / clip.w;
          ndc += offset;

          clip.xy = ndc * clip.w;
          gl_Position = clip;
        }
      `,
            fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform vec3 uHoveredColor;
        uniform float uHoveredOpacity;
        uniform vec3 uSelectedColor;
        uniform float uSelectedOpacity;
        uniform float uDimmedOpacity;
        uniform float uHasActiveNode;

        varying float vHighlight;

        void main() {
          vec3 color = uColor;
          float opacity = uOpacity;

          // Apply colors based on highlight state: 0 = normal, 1 = hovered, 2 = selected
          if (vHighlight > 1.5) {
            color = uSelectedColor;
            opacity = uSelectedOpacity;
          } else if (vHighlight > 0.5) {
            color = uHoveredColor;
            opacity = uHoveredOpacity;
          } else if (uHasActiveNode > 0.5) {
            // If there's an active node but this edge isn't highlighted, dim it
            opacity = uDimmedOpacity;
          }

          gl_FragColor = vec4(color, opacity);
        }
      `,
        });

        return { geometry, material };
    }, [edgeCount]);



    // 🛡 2. Guard: If geo not ready – don't render anything
    useFrame(() => {
        if (!geoAndMat || !startRef.current || !endRef.current || !highlightRef.current) return;

        const { geometry, material } = geoAndMat;
        const aStart = startRef.current;
        const aEnd = endRef.current;
        const aHighlight = highlightRef.current;
        const max = aStart.length;

        // Get current graph state for highlighting logic
        const { hoveredNode, selectedNode, selectedNodeTypes, selectedLinkTypes, searchQuery } =
            getStoreBundle(storeId).graph.getState();

        // Determine if there's any active interaction that should dim non-related edges
        const hasActiveNode = !!(hoveredNode || selectedNode);
        material.uniforms.uHasActiveNode.value = hasActiveNode ? 1 : 0;

        let v = 0;

        for (const [linkRefId, linkPos] of linksPosition.entries()) {
            if (v + 11 >= max) break; // prevents overflow

            const { sx, sy, sz, tx, ty, tz } = linkPos;

            // Find the corresponding link data to get source/target info
            const linkData = linksNormalized?.get(linkRefId) as Link;
            let highlightState = 0; // 0 = normal, 1 = hovered, 2 = selected

            if (linkData) {
                const sourceId = typeof linkData.source === 'string' ? linkData.source : (linkData.source as Link)?.ref_id;
                const targetId = typeof linkData.target === 'string' ? linkData.target : (linkData.target as Link)?.ref_id;

                const sourceNode = nodesNormalized.get(sourceId);
                const targetNode = nodesNormalized.get(targetId);

                if (sourceNode && targetNode) {
                    // Check if this link should be highlighted (same logic as LineComponent)
                    const activeLink =
                        selectedLinkTypes.includes(linkData.edge_type) ||
                        (selectedNodeTypes.includes(sourceNode.node_type) && selectedNodeTypes.includes(targetNode.node_type));

                    const connectedToSelectedNode =
                        selectedNode?.ref_id === sourceId || selectedNode?.ref_id === targetId;

                    const connectedToHoveredNode =
                        hoveredNode?.ref_id === sourceId || hoveredNode?.ref_id === targetId;

                    // Priority: selected > hovered > active link/search > normal
                    if (activeLink || searchQuery || connectedToSelectedNode || connectedToHoveredNode) {
                        if (connectedToSelectedNode) {
                            highlightState = 2; // Selected state (green, thickest)
                        } else if (connectedToHoveredNode) {
                            highlightState = 1; // Hovered state (white, medium)
                        } else {
                            highlightState = 1; // Active link/search state (white, medium)
                        }
                    }
                }
            }

            // Set positions and highlight for all 4 vertices of this edge
            for (let k = 0; k < 4; k++) {
                aStart[v] = sx;
                aStart[v + 1] = sy;
                aStart[v + 2] = sz;

                aEnd[v] = tx;
                aEnd[v + 1] = ty;
                aEnd[v + 2] = tz;

                aHighlight[v / 3] = highlightState; // Per-vertex highlight state

                v += 3;
            }
        }

        geometry.attributes.aStart.needsUpdate = true;
        geometry.attributes.aEnd.needsUpdate = true;
        geometry.attributes.aHighlight.needsUpdate = true;

        material.uniforms.uResolution.value.set(size.width, size.height);
    });

    if (!geoAndMat) return null;

    const { geometry, material } = geoAndMat;

    // 🛡 3. SAFE update loop

    return (
        <mesh
            ref={meshRef}
            geometry={geometry}
            material={material}
            frustumCulled={false}
        />
    );
}