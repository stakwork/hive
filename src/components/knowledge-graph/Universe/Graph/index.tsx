import { deepEqual } from "@/lib/utils/deepEqual";
import { getStoreBundle } from "@/stores/createStoreFactory";
import { useStoreId } from "@/stores/StoreProvider";
import { useSchemaStore } from "@/stores/useSchemaStore";
import { useDataStore, useGraphStore, useSimulationStore } from "@/stores/useStores";
import { NodeExtended } from "@Universe/types";
import { useEffect, useRef } from "react";
import { Group } from "three";
import { Line2 } from "three-stdlib";
import { EdgesGPU } from "./Connections/EdgeCpu";
import { Cubes } from "./Cubes";
import { HighlightedNodesLayer } from "./HighlightedNodes";
import { HtmlNodesLayer } from "./HtmlNodesLayer";
import { LayerLabels } from "./LayerLabels";
import { NodeDetailsPanel } from "./UI";
import { calculateRadius } from "./utils/calculateGroupRadius";

export type LinkPosition = {
  sx: number;
  sy: number;
  sz: number;
  tx: number;
  ty: number;
  tz: number;
};

export type NodePosition = {
  x: number;
  y: number;
  z: number;
};

export const Graph = () => {
  const { dataInitial, dataNew, resetDataNew } = useDataStore((s) => s);
  const groupRef = useRef<Group>(null);
  const { normalizedSchemasByType } = useSchemaStore((s) => s);
  const prevRadius = useRef(0);
  const storeId = useStoreId();

  const linksPositionRef = useRef(new Map<string, LinkPosition>());
  const nodesPositionRef = useRef(new Map<string, NodePosition>());
  const justWokeUpRef = useRef(false);

  const { graphStyle, setGraphRadius, activeFilterTab } = useGraphStore((s) => s);

  const {
    simulation,
    simulationCreate,
    addClusterForce,
    addNodesAndLinks,
    simulationRestart,
    updateSimulationVersion,
    removeSimulation,
    setForces,
    setSimulationInProgress,
    isSleeping,
    setIsSleeping,
  } = useSimulationStore((s) => s);

  const highlightNodes = useGraphStore((s) => s.highlightNodes);

  // Wake up the simulation when component mounts
  useEffect(() => {
    // Check if we're returning from a sleeping state
    const wasSleeping = isSleeping;

    if (wasSleeping) {
      // Mark that we just woke up to prevent immediate setForces()
      justWokeUpRef.current = true;

      // If we have existing simulation and data, set alpha to almost min to quickly trigger end event
      if (simulation && dataInitial?.nodes?.length) {
        simulation.alpha(0.001).restart(); // Almost minimum alpha to quickly trigger 'end' event
      }

      // Reset the flag after a brief delay to allow normal operation
      setTimeout(() => {
        justWokeUpRef.current = false;
      }, 100);
    }

    // Always wake up the simulation
    setIsSleeping(false);

    // Clean up: put simulation to sleep when component unmounts
    return () => {
      setIsSleeping(true);
    };
  }, [setIsSleeping, isSleeping, simulation, dataInitial]);

  useEffect(() => {
    if (highlightNodes.length) {
      addClusterForce();
      simulationRestart();
    }
  }, [highlightNodes, addClusterForce, simulationRestart]);

  useEffect(() => {
    if (!dataNew) {
      return;
    }

    const nodes = dataNew.nodes || [];
    const links = dataNew.links || [];

    const nodesClone = structuredClone(nodes);
    const linksClone = structuredClone(links);

    if (simulation) {
      const replace = deepEqual(dataNew, dataInitial);

      addNodesAndLinks(nodesClone, linksClone, replace);
    }

    if (!simulation) {
      simulationCreate(nodesClone);
    }
  }, [dataNew, simulation, simulationCreate, dataInitial, addNodesAndLinks]);

  // useEffect(() => {
  //   ; () => removeSimulation()
  // }, [removeSimulation])

  useEffect(() => {
    if (!simulation || isSleeping || justWokeUpRef.current) {
      return;
    }

    setForces();
  }, [graphStyle, setForces, simulation, isSleeping]);

  useEffect(() => {
    if (!simulation) {
      return;
    }

    if (!groupRef?.current) {
      return;
    }

    const { selectedNode } = getStoreBundle(storeId).graph.getState();

    const gr = groupRef.current.getObjectByName("simulation-3d-group__nodes") as Group;
    const grPoints = groupRef.current.getObjectByName("simulation-3d-group__node-points") as Group;
    const grConnections = groupRef.current.getObjectByName("simulation-3d-group__connections") as Group;

    simulation.on("tick", () => {
      if (groupRef?.current) {
        if (gr && grPoints) {
          const nodes = simulation.nodes();

          const maxLength = Math.max(gr.children.length);

          for (let index = 0; index < maxLength; index += 1) {
            const simulationNode = nodes[index];

            if (simulationNode) {
              nodesPositionRef.current.set(simulationNode.ref_id, {
                x: simulationNode.x,
                y: simulationNode.y,
                z: simulationNode.z || 0,
              });

              if (gr.children[index]) {
                gr.children[index].position.set(simulationNode.x, simulationNode.y, simulationNode.z);
              }

              if (grPoints.children[0].children[index]) {
                grPoints.children[0].children[index].position.set(simulationNode.x, simulationNode.y, simulationNode.z);
              }
            }
          }
        }

        linksPositionRef.current.clear();

        dataInitial?.links.forEach((link) => {
          const sourceId = typeof link.source === "string" ? link.source : (link.source as any)?.ref_id;
          const targetId = typeof link.target === "string" ? link.target : (link.target as any)?.ref_id;

          const sourceNode = sourceId ? nodesPositionRef.current.get(sourceId) : { x: 0, y: 0, z: 0 };
          const targetNode = targetId ? nodesPositionRef.current.get(targetId) : { x: 0, y: 0, z: 0 };

          const { x: sx, y: sy, z: sz } = sourceNode || { x: 0, y: 0, z: 0 };
          const { x: tx, y: ty, z: tz } = targetNode || { x: 0, y: 0, z: 0 };

          // Set positions for the link
          linksPositionRef.current.set(link.ref_id, {
            sx: sx || 0,
            sy: sy || 0,
            sz: sz || 0,
            tx: tx || 0,
            ty: ty || 0,
            tz: tz || 0,
          });
        });

        if (grConnections) {
          grConnections.children.forEach((g, i) => {
            const r = g.children[0]; // Assuming Line is the first child
            const text = g.children[1]; // Assuming Text is the second child

            if (r instanceof Line2) {
              // Ensure you have both Line and Text
              const Line = r as Line2;
              const link = dataInitial?.links[i];

              if (link) {
                const sourceNode = (link.source as any).ref_id
                  ? nodesPositionRef.current.get((link.source as any).ref_id as string)
                  : { x: 0, y: 0, z: 0 };
                const targetNode = (link.target as any).ref_id
                  ? nodesPositionRef.current.get((link.target as any).ref_id as string)
                  : { x: 0, y: 0, z: 0 };

                if (!sourceNode || !targetNode) {
                  return;
                }

                const { x: sx, y: sy, z: sz } = sourceNode || { x: 0, y: 0, z: 0 };
                const { x: tx, y: ty, z: tz } = targetNode || { x: 0, y: 0, z: 0 };

                text.position.set((sx + tx) / 2, (sy + ty) / 2, (sz + tz) / 2);

                // Set line color and properties
                // const lineColor = normalizedSchemasByType[sourceNode.node_type]?.primary_color || 'white'

                Line.geometry.setPositions([sx, sy, sz, tx, ty, tz]);

                const { material } = Line;

                // material.color = new Color(lineColor)
                material.transparent = true;
                material.opacity = 0.3;
              }
            }
          });
        }
      }
    });

    simulation.on("end", () => {
      resetDataNew();

      simulation.nodes().forEach((i: NodeExtended) => {
        i.fx = i.x;

        i.fy = i.y;

        i.fz = i.z || 0;
        nodesPositionRef.current.set(i.ref_id, { x: i.x, y: i.y, z: i.z || 0 });
      });

      if (groupRef?.current) {
        if (gr && grPoints) {
          const nodes = simulation.nodes();

          const maxLength = Math.max(gr.children.length, grPoints.children[0].children.length);

          for (let index = 0; index < maxLength; index += 1) {
            const simulationNode = nodes[index];

            if (simulationNode) {
              if (gr.children[index]) {
                gr.children[index].position.set(simulationNode.x, simulationNode.y, simulationNode.z);
              }

              if (grPoints.children[0].children[index]) {
                grPoints.children[0].children[index].position.set(simulationNode.x, simulationNode.y, simulationNode.z);
              }
            }
          }
        }

        linksPositionRef.current.clear();

        dataInitial?.links.forEach((link) => {
          const sourceId = typeof link.source === "string" ? link.source : (link.source as any)?.ref_id;
          const targetId = typeof link.target === "string" ? link.target : (link.target as any)?.ref_id;
          const sourceNode = sourceId ? nodesPositionRef.current.get(sourceId) : { x: 0, y: 0, z: 0 };
          const targetNode = targetId ? nodesPositionRef.current.get(targetId) : { x: 0, y: 0, z: 0 };

          const { x: sx, y: sy, z: sz } = sourceNode || { x: 0, y: 0, z: 0 };
          const { x: tx, y: ty, z: tz } = targetNode || { x: 0, y: 0, z: 0 };

          // Set positions for the link
          linksPositionRef.current.set(link.ref_id, {
            sx: sx || 0,
            sy: sy || 0,
            sz: sz || 0,
            tx: tx || 0,
            ty: ty || 0,
            tz: tz || 0,
          });
        });

        if (grConnections) {
          grConnections.children.forEach((g, i) => {
            const r = g.children[0]; // Assuming Line is the first child
            const text = g.children[1]; // Assuming Text is the second child

            if (r instanceof Line2) {
              // Ensure you have both Line and Text
              const Line = r as Line2;
              const link = dataInitial?.links[i];

              if (link) {
                const sourceNode = (link.source as any).ref_id
                  ? nodesPositionRef.current.get((link.source as any).ref_id as string)
                  : { x: 0, y: 0, z: 0 };
                const targetNode = (link.target as any).ref_id
                  ? nodesPositionRef.current.get((link.target as any).ref_id as string)
                  : { x: 0, y: 0, z: 0 };

                if (!sourceNode || !targetNode) {
                  return;
                }

                const { x: sx, y: sy, z: sz } = sourceNode || { x: 0, y: 0, z: 0 };
                const { x: tx, y: ty, z: tz } = targetNode || { x: 0, y: 0, z: 0 };

                text.position.set((sx + tx) / 2, (sy + ty) / 2, (sz + tz) / 2);

                // Set line color and properties
                // const lineColor = normalizedSchemasByType[sourceNode.node_type]?.primary_color || 'white'

                Line.geometry.setPositions([sx, sy, sz, tx, ty, tz]);

                const { material } = Line;

                // material.color = new Color(lineColor)
                material.transparent = true;
                material.opacity = 0.3;
              }
            }
          });
        }

        if (gr) {
          if (selectedNode) {
            return;
          }

          const newRadius = calculateRadius(gr);

          if (prevRadius.current === 0 || Math.abs(prevRadius.current - newRadius) > 200) {
            setGraphRadius(newRadius);
            prevRadius.current = newRadius;
          }
        }

        setSimulationInProgress(false);
        updateSimulationVersion();
      }
    });
  }, [
    dataInitial,
    simulation,
    setGraphRadius,
    normalizedSchemasByType,
    resetDataNew,
    updateSimulationVersion,
    setSimulationInProgress,
  ]);

  if (!simulation) {
    return null;
  }

  console.log("activeFilterTab", activeFilterTab);
  console.log("graphStyle", graphStyle);

  return (
    <group ref={groupRef}>
      <group>
        <Cubes />

        {/* <Connections linksPosition={linksPositionRef.current} /> */}
        <EdgesGPU linksPosition={linksPositionRef.current} />
      </group>
      <HighlightedNodesLayer />
      {graphStyle === "sphere" && activeFilterTab === "concepts" && <HtmlNodesLayer nodeTypes={["Feature"]} enabled />}
      {graphStyle === "split" ? <LayerLabels /> : null}
      <NodeDetailsPanel />
    </group>
  );
};
