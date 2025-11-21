import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useSelectedNode } from "@/stores/useStores";
import { useSchemaStore } from "@/stores/useSchemaStore";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useNodeNavigation } from "@Universe/useNodeNavigation";
import { GitBranch, GitMerge, Loader2, TestTube, X } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Group, Vector3 } from "three";

const reuseableVector3 = new Vector3();

export const NodeControls = memo(() => {
  const ref = useRef<Group | null>(null);
  const { normalizedSchemasByType, setSelectedActionDetail } = useSchemaStore((s) => s);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [nodeActionLoading, setLoadActionLoading] = useState<boolean>(false);

  const selectedNode = useSelectedNode();
  const { navigateToNode } = useNodeNavigation();

  const nodeType = selectedNode?.node_type;

  let action: string[] | undefined;

  if (normalizedSchemasByType && normalizedSchemasByType[nodeType!] && normalizedSchemasByType[nodeType!].action) {
    action = normalizedSchemasByType[nodeType!].action;
  }

  useFrame(() => {
    setPosition();
  });

  const setPosition = useCallback(() => {
    if (ref.current && selectedNode) {
      const { x, y, z, fx, fy, fz } = selectedNode;
      console.log(x, y, z);
      const newPosition = reuseableVector3.set(x || fx || 0, y || fy || 0, z || fz || 0);
      ref.current.position.copy(newPosition);
    }
  }, [selectedNode]);

  const buttons = useMemo(() => {
    return [
      {
        key: "control-key-3",
        icon: <X size={14} />,
        className: "exit",
        variant: "destructive" as const,
        onClick: () => {
          navigateToNode("");
        },
      },
    ];
  }, [navigateToNode]);

  if (!selectedNode) {
    return null;
  }

  const handleClose = () => {
    setPopoverOpen(false);
  };

  const mergeTopicModal = () => {
    console.log("Merge topic modal");
  };

  const addEdgeToNodeModal = () => {
    console.log("Add edge to node modal");
  };

  const isRepository = selectedNode?.node_type?.toLowerCase() === "repository";

  return (
    <group ref={ref} position={[selectedNode.x, selectedNode.y, selectedNode.z]}>
      <Html
        center
        className="control-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerOut={(e) => e.stopPropagation()}
        onPointerOver={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        sprite
        zIndexRange={[0, 0]}
      >
        <div className="flex items-center gap-3 -translate-y-20">
          {buttons.map((b) => {
            // For the add button, wrap it in a Popover
            if (b.className === "add") {
              return (
                <Popover key={b.key} open={popoverOpen} onOpenChange={setPopoverOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant={b.variant}
                      size="icon"
                      className={cn(
                        "w-9 h-9 rounded-full shadow-lg backdrop-blur-sm border transition-all duration-200 hover:scale-110",
                        "bg-blue-600/90 hover:bg-blue-700/90 text-white border-blue-500/50 hover:border-blue-400",
                      )}
                      onClick={(e) => {
                        e.stopPropagation();
                        b.onClick();
                      }}
                    >
                      {b.icon}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-auto p-1 bg-gray-900/95 backdrop-blur-sm border-gray-700/80 rounded-xl shadow-xl"
                    sideOffset={12}
                  >
                    {!isRepository ? (
                      <>
                        {action && action.length > 0 ? (
                          <>
                            {nodeActionLoading && (
                              <div className="flex items-center justify-center py-6">
                                <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <button
                              data-testid="merge"
                              className="flex items-center gap-3 px-4 py-3 text-sm text-white hover:bg-gray-800/80 transition-all duration-200 cursor-pointer w-full text-left first:rounded-t-xl hover:translate-x-1"
                              onClick={() => {
                                mergeTopicModal();
                                handleClose();
                              }}
                            >
                              <GitMerge className="w-4 h-4 text-green-400" />
                              Merge
                            </button>
                            <button
                              data-testid="add_edge"
                              className="flex items-center gap-3 px-4 py-3 text-sm text-white hover:bg-gray-800/80 transition-all duration-200 cursor-pointer w-full text-left last:rounded-b-xl hover:translate-x-1"
                              onClick={() => {
                                addEdgeToNodeModal();
                                handleClose();
                              }}
                            >
                              <GitBranch className="w-4 h-4 text-blue-400" />
                              Add edge
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      <button
                        data-testid="generate_tests"
                        className="flex items-center gap-3 px-4 py-3 text-sm text-white hover:bg-gray-800/80 transition-all duration-200 cursor-pointer w-full text-left rounded-xl hover:translate-x-1"
                        onClick={() => {
                          if (selectedNode?.properties?.name) {
                            console.log(selectedNode?.properties?.name);
                          }
                          handleClose();
                        }}
                      >
                        <TestTube className="w-4 h-4 text-purple-400" />
                        Analyze Test Coverage
                      </button>
                    )}
                  </PopoverContent>
                </Popover>
              );
            }

            return (
              <Button
                key={b.key}
                variant={b.variant}
                size="icon"
                className={cn(
                  "w-9 h-9 rounded-full shadow-lg backdrop-blur-sm border transition-all duration-200 hover:scale-110",
                  b.variant === "destructive"
                    ? "bg-red-600/90 hover:bg-red-700/90 text-white border-red-500/50 hover:border-red-400"
                    : b.variant === "secondary"
                      ? "bg-gray-600/90 hover:bg-gray-700/90 text-white border-gray-500/50 hover:border-gray-400"
                      : "bg-green-600/90 hover:bg-green-700/90 text-white border-green-500/50 hover:border-green-400",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  b.onClick();
                }}
              >
                {b.icon}
              </Button>
            );
          })}
        </div>
      </Html>
    </group>
  );
});

NodeControls.displayName = "NodeControls";
