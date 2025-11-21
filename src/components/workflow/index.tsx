import React, { useMemo, useCallback, useEffect, useState, useRef } from "react";
import axios from "axios";
import ImportNodeModal from "./ImportNodeModal";
import RequestQueue from "./RequestQueue";
import { useToastContext } from "@/components/ui/toast-provider";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

declare global {
  interface Window {
    searchTimeout: any;
  }
}

import {
  ReactFlow,
  MiniMap,
  Controls,
  ControlButton,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
} from "@xyflow/react";

import "@xyflow/react/dist/style.css";
import "./workflow.css";
import NodeArray from "./v4/NodeArray";
import StepNode from "./StepNode";
import WorkflowTransition from "./channels/WorkflowTransition";
import WorkflowEdit from "./channels/WorkflowEdit";
import EdgeButtons from "./EdgeButtons";

let manualNavigation = false;
let windowWidth = window.innerWidth;
let windowHeight = window.innerHeight * 0.8;

const edgeTypes = {
  "custom-edge": EdgeButtons,
};

import ContextMenu from "./ContextMenu";
import NodeContextMenu from "./NodeContextMenu";

import { SmartLayoutButton } from "./SmartLayoutButton";

interface SearchResult {
  unique_id: string;
  workflow_version_id: string;
  id: string;
  workflow_name: string;
  title: string;
  skill: string;
}

const SearchButton = ({ workflowId }: { workflowId: string }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  // Close search when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsExpanded(false);
        setShowResults(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setIsLoading(true);
    try {
      // Replace with your actual API endpoint
      const response = await fetch(
        `/admin/workflow_tools/search?workflow_id=${workflowId}&term=${encodeURIComponent(query)}`,
      );
      const results = await response.json();
      setSearchResults(results);
      setShowResults(true);
    } catch (error) {
      console.error("Search failed:", error);
      setSearchResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);

    // Debounce search
    clearTimeout((window as any).searchTimeout);
    (window as any).searchTimeout = setTimeout(() => {
      handleSearch(value);
    }, 300);
  };

  return (
    <div ref={searchRef} className="search-control-inline">
      <ControlButton onClick={() => setIsExpanded(!isExpanded)} title="Search">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
          <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
      </ControlButton>

      {isExpanded && (
        <div className="search-expandable">
          <div className="search-input-container">
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={handleInputChange}
              placeholder="Search..."
              className="search-input"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsExpanded(false);
                  setShowResults(false);
                }
              }}
            />
            {isLoading && (
              <div className="search-loading">
                <svg className="spinner" width="12" height="12" viewBox="0 0 24 24">
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="2"
                    fill="none"
                    strokeDasharray="32"
                    strokeDashoffset="32"
                  >
                    <animate attributeName="stroke-dashoffset" dur="1s" values="32;0;32" repeatCount="indefinite" />
                  </circle>
                </svg>
              </div>
            )}
          </div>

          {showResults && searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((result, index) => (
                <div
                  key={index}
                  className="search-result-item"
                  data-controller="project-buttons"
                  data-action="click->project-buttons#redirectToWorkflow"
                  data-unique-id={result.unique_id}
                  data-workflow-version={result.workflow_version_id}
                  data-workflow-id={result.id}
                >
                  <div className="result-title">{result.workflow_name}</div>
                  <div className="result-description">
                    {result.title} ({result.skill})
                  </div>
                </div>
              ))}
            </div>
          )}

          {showResults && searchResults.length === 0 && searchQuery.trim() && !isLoading && (
            <div className="search-results">
              <div className="no-results">No results found</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const getUrlParameter = (name: string): string | null => {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
};

interface WorkflowAppProps {
  props: {
    workflowData?: any;
    kflowformdata?: string;
    show_only: boolean | string;
    mode: string;
    projectId?: string;
    isAdmin: boolean;
    workflowId: string;
    workflowVersion: string;
    defaultZoomLevel?: number;
    useAssistantDimensions?: boolean;
    projectProgress?: string;
    rails_env: string;
  };
}

export default function App(workflowApp: WorkflowAppProps) {
  const { showToast } = useToastContext();
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    onConfirm: () => void;
    variant?: "default" | "destructive";
  }>({ open: false, title: "", description: "", onConfirm: () => {} });

  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);
  const [nodesSelected, setNodesSelected] = useState<any[]>([]);
  const [updateConnections, setUpdateConnections] = useState(false);
  const nodeTypes = useMemo(() => ({ stepNode: StepNode }), []);
  const [customConnections, setCustomConnections] = useState<any[]>([]);
  const [updateCustomConnections, setUpdateCustomConnections] = useState(false);
  const [menu, setMenu] = useState<any>(null);
  const [nodeMenu, setNodeMenu] = useState<any>(null);
  const ref = useRef<any>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<any>(null);
  const hasAutoClickedRef = useRef<boolean>(false);
  const hasInitialFitViewRef = useRef<boolean>(false);

  const requestQueue = useRef<RequestQueue>(new RequestQueue());
  const [hasPendingUpdates, setHasPendingUpdates] = useState(false);

  // Ref for workflow spec field
  const workflowSpecRef = useRef<HTMLInputElement | null>(null);

  // Helper to show toast messages (replaces window.showFlashMessage)
  const showFlashMessage = useCallback(
    (message: string, type: "success" | "info" | "error") => {
      const variant = type === "error" ? "destructive" : type === "success" ? "success" : "default";
      showToast({
        title: message,
        variant,
        duration: 3000,
      });
    },
    [showToast],
  );

  // Helper to show error dialog (replaces swal for errors)
  const showErrorDialog = useCallback((title: string, message: string) => {
    setConfirmDialog({
      open: true,
      title,
      description: message,
      variant: "destructive",
      onConfirm: () => setConfirmDialog((prev) => ({ ...prev, open: false })),
    });
  }, []);

  // Helper to trigger change event on workflow spec field (replaces jQuery trigger)
  const triggerWorkflowSpecChange = useCallback(() => {
    const workflowSpecField = document.querySelector("#workflow_spec") as HTMLInputElement | null;
    if (workflowSpecField) {
      const changeEvent = new Event("change", { bubbles: true });
      workflowSpecField.dispatchEvent(changeEvent);
    }
  }, []);

  const {
    workflowData,
    kflowformdata,
    show_only,
    mode,
    projectId,
    isAdmin,
    workflowId,
    workflowVersion,
    defaultZoomLevel,
    useAssistantDimensions,
    projectProgress,
    rails_env,
  } = workflowApp.props;

  let zoomLevel = defaultZoomLevel || 0.65;

  const [targetPosition, setTargetPosition] = useState({ x: 100, y: 260, zoom: zoomLevel });
  const [workflowVersionId, setWorkflowVersionId] = useState(workflowVersion);

  const [isDragging, setIsDragging] = useState(false);
  const dragEndTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const DRAG_END_DELAY = 300;

  const showStep = getUrlParameter("show_step");

  // Update useEffect to monitor queue status
  useEffect(() => {
    const checkQueueStatus = () => {
      setHasPendingUpdates(requestQueue.current.length > 0);
    };

    // Check every second and on queue changes
    const intervalId = setInterval(checkQueueStatus, 1000);

    return () => {
      clearInterval(intervalId);
      requestQueue.current.clear(); // Clean up queue on component unmount
    };
  }, []);

  const onStepGoto = useCallback(
    (stepId: string) => {
      const step = nodes.find((node) => node.id === stepId);

      if (step) {
        (document as any).startViewTransition(function () {
          setTargetPosition({ ...targetPosition, x: 400 - step.position.x * zoomLevel });
        });
      }
    },
    [nodes, targetPosition, zoomLevel],
  ); // Dependencies array: recreate onStepGoto only when nodes change

  useEffect(() => {
    const handleStepGoto = (e: any) => {
      onStepGoto(e.detail.step); // Use the memoized function
    };

    window.addEventListener("gotoStep", handleStepGoto);

    // Clean up the listener on component unmount
    return () => {
      window.removeEventListener("gotoStep", handleStepGoto);
    };
  }, [onStepGoto]); // Add onStepGoto to dependencies array

  useEffect(() => {
    if (projectId) {
      const workflowChannel = new WorkflowTransition(rails_env, projectId, onWorkflowUpdate);
      workflowChannel.subscribe();
    } else if (workflowId) {
      const workflowEditChannel = new WorkflowEdit(rails_env, workflowId, onWorkflowEdit);
      workflowEditChannel.subscribe();
    }
  }, []);

  useEffect(() => {
    const handlePublishWorkflow = (event: any) => {
      // Create the request function for the queue
      const requestFn = () => {
        return axios.put(`/admin/workflows/${workflowId}/publish.json?workflow_version_id=${workflowVersionId}`);
      };

      // Queue the request with metadata
      requestQueue.current
        .enqueue(requestFn, {
          type: "publishWorkflow",
        })
        .then((response) => {
          const response_data = response.data;

          if (!response_data.success) {
            showErrorDialog("There was an error while publishing this workflow", response_data.error.message);
            return;
          }

          const data = response_data.data;

          if (!data.valid) {
            return;
          }

          showFlashMessage("Workflow Published", "success");
          updateDiagram(data.workflow_diagram);
          updateWorkflowVersionId(response);
        })
        .catch((error) => {
          console.error("Failed to publish workflow:", error);
          showErrorDialog("There was an error while publishing this workflow", error.message || error);
        });
    };

    const handleCopyStep = (event: any) => {
      const unique_id = event.detail.uniqueId;

      setConfirmDialog({
        open: true,
        title: "Copy Step",
        description: "Are you sure you want to copy this step?",
        onConfirm: () => {
          setConfirmDialog((prev) => ({ ...prev, open: false }));

          // Create the request function for the queue
          const requestFn = () => {
            const params = {
              workflow_version_id: workflowVersionId, // Use latest version from queue
            };

            return axios.put(`/admin/workflows/${workflowId}/steps/${unique_id}/copy.json`, params);
          };

          // Queue the request with metadata
          requestQueue.current
            .enqueue(requestFn, {
              type: "copyStep",
              nodeIds: [unique_id], // Track the node being copied
            })
            .then((response) => {
              const response_data = response.data;

              if (!response_data.success) {
                showErrorDialog("There was an error while copying this step", response_data.error.message);
                return;
              }

              const data = response_data.data;

              if (!data.valid) {
                return;
              }

              showFlashMessage("Step copied", "info");
              updateDiagram(data.workflow_diagram);
              debouncedUpdateWorkflowVersion(response);
            })
            .catch((error) => {
              console.error("Failed to copy step:", error);
              showErrorDialog("There was an error while copying this step", error.message || error);
            });
        },
      });
    };

    const handleWorkflowSave = (event: any) => {
      const workflowToSave = event.detail.workflowData;

      // Create the request function for the queue
      const requestFn = () => {
        const params = {
          workflow: {
            spec: workflowToSave,
            version_id: workflowVersionId, // Use latest version from queue
          },
        };

        return axios.put(`/admin/workflows/${workflowId}.json`, params);
      };

      // Queue the request with metadata - this is a "whole workflow" operation
      requestQueue.current
        .enqueue(requestFn, {
          type: "saveWorkflow",
          // No specific nodeIds, this affects the entire workflow
        })
        .then((response) => {
          const response_data = response.data;

          if (!response_data.success) {
            showErrorDialog("There was an error while saving your Workflow", response_data.error.message);
            return;
          }

          const data = response_data.data;

          if (!data.valid) {
            return;
          }

          showFlashMessage("Workflow Updated", "info");
          updateDiagram(data.workflow_diagram);
          debouncedUpdateWorkflowVersion(response);
        })
        .catch((error) => {
          console.error("Failed to save workflow:", error);
          showErrorDialog("There was an error while saving this Workflow", error.message || error);
        });
    };

    document.addEventListener("workflow-save-requested", handleWorkflowSave);
    document.addEventListener("step-copy-requested", handleCopyStep);
    document.addEventListener("workflow-publish-requested", handlePublishWorkflow);

    return () => {
      document.removeEventListener("workflow-save-requested", handleWorkflowSave);
      document.removeEventListener("step-copy-requested", handleCopyStep);
      document.removeEventListener("workflow-publish-requested", handlePublishWorkflow);
    };
  }, [workflowId, workflowVersionId, requestQueue]); // Add requestQueue to dependencies

  useEffect(() => {
    let data;

    if (projectProgress) {
      data = JSON.parse(projectProgress);
    } else if (kflowformdata) {
      data = JSON.parse(kflowformdata).workflowFormData;
    } else if (workflowData) {
      data = workflowData;
    }

    let transitions = data.transitions;
    let connections = data.connections;

    updateDiagram({ transitions, connections });
  }, [setNodes, setEdges, workflowData]);

  useEffect(() => {
    if (useAssistantDimensions) {
      const container = document.querySelector(".assistant-preview-wrapper > div");
      if (container) {
        const containerWidth = container.clientWidth;
        const containerHeight = 350;

        windowWidth = containerWidth;
        windowHeight = containerHeight * 0.8;

        setTargetPosition({ ...targetPosition, x: 200, y: 50 });
      }
    }
  }, [useAssistantDimensions]);

  // Auto-fit view for project workflows on initial load
  useEffect(() => {
    if (projectId && reactFlowInstance && nodes.length > 0 && !hasInitialFitViewRef.current) {
      hasInitialFitViewRef.current = true;

      // Small delay to ensure nodes are rendered
      setTimeout(() => {
        reactFlowInstance.fitView({
          padding: 0.2,
          duration: 300,
        });
      }, 100);
    }
  }, [projectId, reactFlowInstance, nodes.length]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const node = nodes.find((node) => node.id === connection.source);

      if (!node) {
        return null;
      }

      if (node.data.connection_edges && node.data.connection_edges.length > 0) {
        const conn_edge = node.data.connection_edges.find((conn: any) => conn.target_id === connection.target);

        if (conn_edge) {
          (connection as any).custom_label = conn_edge.name;
          (connection as any).disable_edge = true;
        }
      }

      const edge = {
        id: `${connection.source}-${connection.target}`,
        source: connection.source,
        target: connection.target,
        data: { ...node, conn_edge: connection },
        type: "custom-edge",
      };

      setEdges((eds) => addEdge(edge, eds));
      setUpdateConnections(true);
    },
    [setEdges, nodes],
  );

  const updateConnectionsWorkflow = (workflowId: string, connections: any[]) => {
    const connectionIds = connections.map((conn: any) => conn.id);

    const requestFn = (version: any) => {
      return axios.put(`/admin/workflows/${workflowId}/connections`, {
        connections: connections,
        workflow_version_id: version,
      });
    };

    requestQueue.current
      .enqueue(
        requestFn,
        {
          type: "updateConnections",
          connectionIds: connectionIds,
        },
        workflowVersionId,
      )
      .then((response) => {
        updateWorkflowVersionId(response);
        updateJSONSpecConnections(connections);
      })
      .catch((error) => {
        console.error("Failed to update connections:", error);
      });
  };

  useEffect(() => {
    if (!updateConnections || !edges.length) return; // Early return if not triggered

    const connectionsToUpdate = edges.map(({ source, target }) => ({ id: `${source}-${target}`, source, target }));

    if (!connectionsToUpdate || connectionsToUpdate.length === 0) {
      return;
    }

    updateConnectionsWorkflow(workflowId, connectionsToUpdate);

    setUpdateConnections(false);
  }, [workflowVersionId, updateConnections, edges]);

  const updateDiagram = (data: any) => {
    // console.log("data", data)
    let updatedNodes = new NodeArray(
      data.transitions,
      data.connections,
      show_only,
      mode,
      projectId,
      isAdmin,
      workflowId,
      workflowVersionId,
    );

    const workflowSpecField = document.querySelector("#workflow_spec");

    const node_edges: any[] = [];
    let myNodes = updatedNodes.nodes.map((node: any) => {
      node.project_view = projectId !== undefined;

      if (node.edges.length > 0) {
        node.edges.forEach((e: any) => {
          node_edges.push({ node: node, edge: e });
        });
      }

      return {
        id: node.id,
        type: "stepNode",
        position: node.position,
        deletable: node.deletable,
        sourcePosition: "top",
        targetPosition: "bottom",
        data: { ...node },
      };
    });

    let myEdges: any[] = [];
    let dedupNodes: any = {};

    if (data.connections && Array.isArray(data.connections) && data.connections.length > 0) {
      // console.log("saved connections detected", data.connections)
      myEdges = data.connections
        .map((e: any, x: number) => {
          const node = myNodes.find((node: any) => node.id === e.source);

          if (!node || e.source === "" || e.target === "") {
            return null;
          }

          const targetNode = myNodes.find((node: any) => node.id === e.target);

          if (!targetNode) {
            return null;
          }

          if (node.data.connection_edges && node.data.connection_edges.length > 0) {
            const conn_edge = node.data.connection_edges.find((conn: any) => conn.target_id === e.target);

            if (conn_edge) {
              e.custom_label = conn_edge.name;
              e.disable_edge = true;
            }
          }

          if (dedupNodes[e.id]) {
            return null;
          }

          dedupNodes[e.id] = true;

          return {
            id: e.id,
            source: e.source,
            target: e.target,
            data: { ...node, datapos: x, conn_edge: e },
            type: "custom-edge",
          };
        })
        .flat()
        .filter((n: any) => n);

      const changes: any[] = [];
      myEdges.forEach((edge: any) => {
        if (edge.source === "start") {
          const targetNode = myNodes.find((node: any) => node.id === edge.target);
          if (targetNode) {
            changes.push({
              sourceNode: edge.source,
              targetNode: targetNode,
              newPosition: targetNode.position.x - 500,
            });
          }
        } else if (edge.target === "system.succeed") {
          const sourceNode = myNodes.find((node: any) => node.id === edge.source);
          if (sourceNode) {
            changes.push({
              sourceNode: edge.target,
              node: sourceNode,
              newPosition: sourceNode.position.x + 500,
            });

            changes.push({
              sourceNode: "system.fail",
              node: sourceNode,
              newPosition: sourceNode.position.x + 500,
            });
          }
        }
      });

      changes.forEach((change: any) => {
        myNodes = myNodes.map((node: any) => {
          if (node.id === change.sourceNode) {
            node.position.x = change.newPosition;
          }
          return node;
        });
      });

      const connections = myEdges.map(({ source, target, custom_label, disable_edge }) => ({
        id: `${source}-${target}`,
        source,
        target,
        custom_label,
        disable_edge,
      }));

      setCustomConnections(connections);
    } else {
      // console.log("no connections detected")
      myEdges = node_edges
        .flat()
        .map((opts: any, x: number) => {
          const node = opts.node;
          const e = opts.edge;

          return {
            id: e.id,
            source: e.source,
            target: e.target,
            data: { ...node, datapos: x, conn_edge: e },
            type: "custom-edge",
          };
        })
        .flat();

      if (workflowSpecField) {
        const connections = myEdges.map(({ source, target, custom_label, disable_edge }) => ({
          id: `${source}-${target}`,
          source,
          target,
          custom_label,
          disable_edge,
        }));

        // console.log("saving connections first time", connections)

        setCustomConnections(connections);
        setUpdateCustomConnections(true);

        updateJSONSpecConnections(connections);
      }
    }

    document.startViewTransition(function () {
      setNodes(myNodes);
      setEdges(myEdges.flat());

      if (manualNavigation) {
        return;
      }

      if (updatedNodes.getCompletedStepPos()) {
        const paneElement = document.querySelector(".react-flow");
        if (paneElement) {
          const pane = paneElement.getBoundingClientRect();

          let lastNode = updatedNodes.getCompletedStepPos();
          const finishNode = updatedNodes.getFinishNode();
          if (finishNode) {
            lastNode = finishNode;
          }

          if (lastNode) {
            const screenPoint = {
              x: (lastNode.x - pane.left - 600) * -zoomLevel,
              y: (lastNode.y - pane.top - 200) * -zoomLevel,
            };

            setTargetPosition({ ...targetPosition, x: screenPoint.x, y: screenPoint.y });
          }
        }
      }
    });
  };

  const updateJSONSpecConnections = (connections: any) => {
    // console.log("saving connections into JSON spec", connections)
    const workflowSpecField = document.querySelector("#workflow_spec") as HTMLInputElement | null;
    if (!workflowSpecField) {
      return;
    }

    const json_spec = JSON.parse(workflowSpecField.value);
    json_spec.connections = JSON.stringify(connections);
    const specField = document.querySelector("#workflow_spec") as HTMLInputElement;
    if (specField) {
      specField.value = JSON.stringify(json_spec);
    }
    triggerWorkflowSpecChange();
  };

  const updateWorkflowVersionId = (response: any) => {
    const response_data = response.data;

    if (!response_data.success) {
      return;
    }

    const data = response_data.data;

    if (!data.valid) {
      return;
    }

    const eventDetail = { workflow_version_id: data.workflow_version_id };

    setWorkflowVersionId(data.workflow_version_id);

    // NOTE: Turbo Stream functionality commented out during Next.js migration
    // This was used to update the workflow versions dropdown via Rails Turbo Streams
    // If this functionality is needed in Next.js, implement a React-based version dropdown
    // fetch(`/admin/workflows/${workflowId}/versions?version=${data.workflow_version_id}&tag_name=edit_workflows_versions_dropdown`, {
    //   headers: {
    //     Accept: "text/vnd.turbo-stream.html"
    //   }
    // }).then(r => r.text())
    //   .then(function(html) {
    //     Turbo.renderStreamMessage(html)
    // })

    const event = new CustomEvent("updateWorkflowVersion", { detail: eventDetail });
    document.dispatchEvent(event);

    history.pushState({}, "", location.protocol + "//" + location.host + location.pathname + location.hash);
  };

  useEffect(() => {
    if (!updateCustomConnections || !customConnections.length) return; // Early return if not triggered

    // console.log("customConnections", customConnections)

    if (!customConnections || customConnections.length === 0) {
      // console.log("skipping connections saving")

      return;
    }

    // console.log("saving connections in DB")

    const connectionsToUpdate = customConnections.map(({ source, target }) => ({
      id: `${source}-${target}`,
      source,
      target,
    }));

    updateConnectionsWorkflow(workflowId, connectionsToUpdate);
  }, [workflowVersionId, updateCustomConnections, customConnections]);

  const onWorkflowEdit = (data: any) => {
    const workflow_id = data.workflow_id;
    axios.get(`/admin/workflows/${workflow_id}.json`).then((response) => {
      const workflow = response.data.spec;

      updateDiagram(workflow);

      const workflowSpecField = document.querySelector("#workflow_spec") as HTMLInputElement | null;
      if (workflowSpecField) {
        workflowSpecField.value = response.data.workflow;
      }

      const workflow_form = document.querySelector("#edit_workflow") as HTMLFormElement | null;
      if (workflow_form) {
        workflow_form.requestSubmit();
      }
    });
  };

  const onWorkflowUpdate = (data: any) => {
    const project_id = data.project_id;
    axios.get(`/api/v1/projects/${project_id}.json`).then((response) => {
      const project_progress = response.data.response;

      updateDiagram(project_progress);
    });
  };

  const getCookieKey = () => {
    return `position_${workflowId}`;
  };

  useEffect(() => {
    const cookieKey = getCookieKey();
    const savedPosition = localStorage.getItem(cookieKey);

    if (savedPosition && !projectId) {
      try {
        const parsedPosition = JSON.parse(savedPosition);
        setTargetPosition(parsedPosition);
      } catch (error) {
        console.error("Failed to parse position from cookie:", error);
      }
    }
  }, [workflowId]);

  const viewportChange = (change: any) => {
    manualNavigation = true;
    setTargetPosition(change);

    if (!projectId) {
      const cookieKey = getCookieKey();
      localStorage.setItem(cookieKey, JSON.stringify(change));
    }
  };

  const updateWorkflowWithNode = (changed_nodes: any[]) => {
    const workflowSpecField = document.querySelector("#workflow_spec") as HTMLInputElement | null;
    if (!workflowSpecField) return;

    const json_spec = JSON.parse(workflowSpecField.value);

    // Apply node position changes to the local spec
    changed_nodes.forEach((changed_node: any) => {
      const step_index = json_spec.transitions.findIndex((node: any) => node.id === changed_node.id);
      if (step_index !== -1) {
        json_spec.transitions[step_index]["position"] = changed_node.position;
      }
    });

    // Update local UI right away for responsiveness
    const specField = document.querySelector("#workflow_spec") as HTMLInputElement;
    if (specField) {
      specField.value = JSON.stringify(json_spec);
    }
    triggerWorkflowSpecChange();

    // Prepare node IDs for tracking
    const nodeIds = changed_nodes.map((node: any) => node.id);

    // Create the request function
    const requestFn = (version: any) => {
      const params = {
        changed_nodes: changed_nodes,
        workflow_version_id: version,
      };

      return axios.put(`/admin/workflows/${workflowId}/steps/batch.json`, params);
    };

    // Queue the request with metadata
    requestQueue.current
      .enqueue(
        requestFn,
        {
          type: "updateNodes",
          nodeIds: nodeIds,
        },
        workflowVersionId,
      )
      .then((response) => {
        const response_data = response.data;

        if (!response_data.success) {
          showErrorDialog("Operation not permitted", response_data.error.message);
          return;
        }

        debouncedUpdateWorkflowVersion(response);
      })
      .catch((error) => {
        console.error("Failed to update workflow nodes:", error);
        showErrorDialog("Failed to update nodes", error.message || "An unexpected error occurred");
      });
  };

  const debouncedUpdateWorkflowVersion = (response: any) => {
    const data = response.data.data;

    if (!data.valid) {
      return;
    }

    const specField = document.querySelector("#workflow_spec") as HTMLInputElement;
    if (specField) {
      specField.value = JSON.stringify(data.workflow_spec);
    }
    triggerWorkflowSpecChange();

    updateWorkflowVersionId(response);

    updateJSONSpecConnections(data.workflow_spec.connections);
  };

  const exportSteps = (nodes_to_export: any[], node_type: string) => {
    console.log("exporting nodes", nodes_to_export);

    const nodeIds = nodes_to_export.map((node: any) => node.id);

    setConfirmDialog({
      open: true,
      title: "Export Steps",
      description: `Are you sure you want to export the following steps into a ${node_type}? ${nodes_to_export.map((n) => n.id).join(", ")}`,
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));

        const requestFn = (version: any) => {
          const params = {
            steps: nodeIds,
            workflow_version_id: version,
            node_type: node_type,
          };

          return axios.post(`/admin/workflows/${workflowId}/steps/export_to.json`, params);
        };

        requestQueue.current
          .enqueue(
            requestFn,
            {
              type: "exportNodesToNew",
              nodeIds: nodeIds,
            },
            workflowVersionId,
          )
          .then((response) => {
            const response_data = response.data;

            if (!response_data.success) {
              showErrorDialog("Operation not permitted", response_data.error.message);
              return;
            }

            showFlashMessage(`Steps exported ${nodeIds.join(", ")}`, "info");

            handleImportSuccess(response_data);

            // debouncedUpdateWorkflowVersion(response);
          })
          .catch((error) => {
            console.error("Failed to delete workflow nodes:", error);
            showErrorDialog("Failed to export steps", error.message || "An unexpected error occurred");
          });
      },
    });
  };

  const deleteStepWorkflowWithNode = (nodes_to_delete: any[]) => {
    const nodeIds = nodes_to_delete.map((node: any) => node.id);

    setConfirmDialog({
      open: true,
      title: "Delete Steps",
      description: `Are you sure you want to delete the following steps? ${nodes_to_delete.map((n) => n.id).join(", ")}`,
      variant: "destructive",
      onConfirm: () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));

        const requestFn = (version: any) => {
          const params = {
            step_ids: nodeIds,
            workflow_version_id: version,
          };

          return axios.put(`/admin/workflows/${workflowId}/steps/batch_delete.json`, params);
        };

        requestQueue.current
          .enqueue(
            requestFn,
            {
              type: "deleteNodes",
              nodeIds: nodeIds,
            },
            workflowVersionId,
          )
          .then((response) => {
            const response_data = response.data;

            if (!response_data.success) {
              showErrorDialog("Operation not permitted", response_data.error.message);
              return;
            }

            showFlashMessage(`Steps deleted ${nodeIds.join(", ")}`, "info");

            // Remove nodes from state using setNodes directly
            setNodes((nds) => nds.filter((n) => !nodeIds.includes(n.id)));

            debouncedUpdateWorkflowVersion(response);
          })
          .catch((error) => {
            console.error("Failed to delete workflow nodes:", error);
            showErrorDialog("Failed to delete steps", error.message || "An unexpected error occurred");
          });
      },
    });
  };

  const onCustomNodesDelete = (nodes_to_delete: any[]) => {
    deleteStepWorkflowWithNode(nodes_to_delete);
  };

  const onCustomNodesChanged = useCallback(
    (nodes: any) => {
      const isAutoLayoutChange =
        nodes.length > 1 && nodes.every((change: any) => change.type === "position" && change.dragging === false);

      if (isAutoLayoutChange) {
        console.log("Processing batch position changes from auto-layout");

        // Extract the changed nodes with their new positions
        const changedNodes = nodes.map((change: any) => ({
          id: change.id,
          position: change.position,
        }));

        // Save all positions at once
        updateWorkflowWithNode(changedNodes);

        // Also apply the changes to the local state
        onNodesChange(nodes);
        return;
      }

      if (nodes[0].dragging === true) {
        setIsDragging(true);

        onNodesChange(nodes);
        return;
      }

      if (nodes[0].dragging === false) {
        setIsDragging(false);

        if (dragEndTimeoutRef.current) {
          clearTimeout(dragEndTimeoutRef.current);
        }

        if (isDragging) {
          // console.log("Drag ending, setting timeout");

          dragEndTimeoutRef.current = setTimeout(() => {
            // console.log("Processing after delay");
            processChangeNode(nodes);
            dragEndTimeoutRef.current = null;
          }, DRAG_END_DELAY);

          setIsDragging(false);
        }
      }

      onNodesChange(nodes);
    },
    [isDragging, onNodesChange],
  );

  useEffect(() => {
    return () => {
      if (dragEndTimeoutRef.current) {
        clearTimeout(dragEndTimeoutRef.current);
      }
    };
  }, []);

  const processChangeNode = useCallback((nodes: any) => {
    // Only update if no operations are pending for these nodes
    const hasConflicts = nodes.some((node: any) => requestQueue.current.hasPendingChanges(node.id));

    if (!hasConflicts) {
      updateWorkflowWithNode(nodes);
    } else {
      console.log("Skipping update due to pending changes for these nodes");
    }
  }, []);

  const customOnEdgesChange = (edges: any) => {
    if (edges[0].type === "remove") {
      onEdgesChange(edges);

      setUpdateConnections(true);
    }
  };

  const onPaneContextMenu = useCallback(
    (event: any) => {
      if (!reactFlowInstance) return;

      // Prevent native context menu from showing
      event.preventDefault();

      setNodeMenu(null);

      const paneElement = document.querySelector(".react-flow");
      if (!paneElement) return;

      const pane = paneElement.getBoundingClientRect();

      const screenPoint = {
        x: event.clientX - pane.left,
        y: event.clientY - pane.top,
      };

      // Convert to flow coordinates (accounts for zoom and pan)
      const flowPosition = reactFlowInstance.screenToFlowPosition(screenPoint);

      setMenu({
        top: screenPoint.y,
        left: screenPoint.x,
        right: pane.right,
        bottom: pane.bottom,
        position: flowPosition,
        workflowId: workflowId,
        workflowVersionId: workflowVersionId,
      });
    },
    [reactFlowInstance, setMenu, setNodeMenu],
  );

  const onPaneClick = useCallback(() => {
    setMenu(null);
    setNodeMenu(null);
  }, [setMenu, setNodeMenu]);

  const onNodePaneClick = useCallback(() => {
    setMenu(null);
    setNodeMenu(null);
  }, [setMenu, setNodeMenu]);

  const handleImportSuccess = (responseData: any, contextData?: any) => {
    if (responseData.data.workflow_spec) {
      const newVersionId = responseData.data.workflow_version_id;
      if (newVersionId) {
        setWorkflowVersionId(newVersionId);
        requestQueue.current.latestVersion = newVersionId;
      }

      if (responseData.data.workflow_diagram) {
        updateDiagram(responseData.data.workflow_diagram);

        const specField = document.querySelector("#workflow_spec") as HTMLInputElement;
        if (specField) {
          specField.value = JSON.stringify(responseData.data.workflow_spec);
        }
        triggerWorkflowSpecChange();
      }

      updateWorkflowVersionId({ data: responseData });
    }
  };

  // Store the instance when the flow is initialized
  const onInit = useCallback((instance: any) => {
    setReactFlowInstance(instance);
  }, []);

  const renderPendingIndicator = () => {
    if (hasPendingUpdates) {
      return (
        <div className="pending-updates-indicator">
          <span>Syncing changes...</span>
        </div>
      );
    }
    return null;
  };

  const onNodeContextMenu = useCallback(
    (event: any, node: any) => {
      if (!reactFlowInstance) return;

      // Prevent native context menu from showing
      event.preventDefault();

      setMenu(null);

      const paneElement = document.querySelector(".react-flow");
      if (!paneElement) return;

      const pane = paneElement.getBoundingClientRect();

      const screenPoint = {
        x: event.clientX - pane.left,
        y: event.clientY - pane.top,
      };

      const nodeToAction = nodesSelected.length > 0 ? nodesSelected : [node];

      setNodeMenu({
        id: node.id,
        top: screenPoint.y,
        left: screenPoint.x,
        right: pane.right,
        bottom: pane.bottom,
        nodes: nodeToAction,
        deleteCallback: deleteStepWorkflowWithNode,
        exportCallback: exportSteps,
      });
    },
    [reactFlowInstance, setNodeMenu, setMenu, nodesSelected],
  );

  const onSelectionChange = useCallback(
    (params: any) => {
      setNodesSelected(params["nodes"]);
    },
    [setNodesSelected],
  );

  useEffect(() => {
    if (showStep && nodes.length > 0 && reactFlowInstance && !hasAutoClickedRef.current) {
      // Find the node with matching step name/id
      const targetNode = nodes.find(
        (node: any) =>
          node.id === showStep ||
          node.data.title === showStep ||
          node.data.name === showStep ||
          node.data.unique_id === showStep,
      );

      if (targetNode) {
        hasAutoClickedRef.current = true;

        // Small delay to ensure everything is rendered
        setTimeout(() => {
          // First, navigate to the step
          document.startViewTransition(() => {
            setTargetPosition({
              ...targetPosition,
              x: 400 - targetNode.position.x * zoomLevel,
              y: 260 - targetNode.position.y * zoomLevel,
            });
          });

          // Then simulate a click after navigation
          setTimeout(() => {
            // Find the specific clickable div inside the node
            const clickableDiv = document.querySelector(`[data-id="${targetNode.id}"] .step-details-link`);

            if (clickableDiv) {
              const clickEvent = new MouseEvent("click", {
                bubbles: true,
                cancelable: true,
                view: window,
              });
              clickableDiv.dispatchEvent(clickEvent);
            }
          }, 500);
        }, 100);
      }
    }
  }, [nodes, reactFlowInstance]); // Add showStep as dependency

  return (
    <div
      style={{
        width: projectId ? "100%" : windowWidth,
        height: projectId ? "100%" : windowHeight,
      }}
    >
      {renderPendingIndicator()}
      <ReactFlow
        onInit={onInit}
        ref={ref}
        minZoom={0.2}
        maxZoom={0.7}
        nodeTypes={nodeTypes}
        nodes={nodes}
        edges={edges}
        onViewportChange={viewportChange}
        viewport={{ x: targetPosition.x, y: targetPosition.y, zoom: targetPosition.zoom }}
        onNodesChange={onCustomNodesChanged}
        nodeDragThreshold={10}
        onEdgesChange={customOnEdgesChange}
        onNodesDelete={onCustomNodesDelete}
        onSelectionChange={onSelectionChange}
        onConnect={onConnect}
        onPaneClick={onPaneClick}
        edgeTypes={edgeTypes}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
      >
        {!useAssistantDimensions && (
          <div>
            {/* <Controls position={'top-left'} orientation={'vertical'} showInteractive={false}>
              <SearchButton workflowId={workflowId} />
            </Controls> */}
            {/* <MiniMap position={'bottom-left'} pannable zoomable/> */}
            {!projectId && <SmartLayoutButton onNodesChange={onCustomNodesChanged} />}
          </div>
        )}

        <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
        {nodeMenu && <NodeContextMenu onClick={onNodePaneClick} {...nodeMenu} />}
        {menu && <ContextMenu onClick={onPaneClick} {...menu} />}
      </ReactFlow>

      <ImportNodeModal onSubmitSuccess={handleImportSuccess} />

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog((prev) => ({ ...prev, open }))}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />
    </div>
  );
}
