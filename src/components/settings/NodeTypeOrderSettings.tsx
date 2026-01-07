"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useNodeTypes } from "@/stores/useDataStore";
import type { SchemaExtended } from "@/stores/useSchemaStore";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronDown, ChevronUp, GripVertical, Plus, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

interface NodeTypeConfigItem {
  id: string; // Unique identifier for drag and drop
  type: string;
  value: number; // The numeric value users can edit (e.g., 20 for Functions)
}

interface SortableNodeTypeRowProps {
  item: NodeTypeConfigItem;
  onValueChange: (nodeType: string, value: number) => void;
  onRemove?: (nodeTypeId: string) => void;
  canRemove?: boolean;
}

function SortableNodeTypeRow({ item, onValueChange, onRemove, canRemove = false }: SortableNodeTypeRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 border rounded-lg bg-card"
    >
      <div
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing flex-shrink-0 text-muted-foreground hover:text-foreground"
      >
        <GripVertical className="w-4 h-4" />
      </div>
      <div className="flex items-center gap-3 flex-1">
        <span className="font-medium min-w-0 flex-1">{item.type}</span>
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min="0"
            max="999"
            value={item.value}
            onChange={(e) => {
              const inputValue = e.target.value;
              const value = inputValue === '' ? 0 : parseInt(inputValue, 10);
              const clampedValue = Math.max(0, Math.min(999, isNaN(value) ? 0 : value));
              onValueChange(item.type, clampedValue);
            }}
            className="w-20 text-center hidden"
            placeholder="0"
          />
          {canRemove && onRemove && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onRemove(item.id)}
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}


export function NodeTypeOrderSettings() {
  const { workspace, updateWorkspace } = useWorkspace();
  const nodeTypesFromGraph = useNodeTypes(); // Node types from current graph data
  const [schemas, setSchemas] = useState<SchemaExtended[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddingNewType, setIsAddingNewType] = useState(false);
  const [newNodeTypeName, setNewNodeTypeName] = useState("");
  const [isLoadingSchemas, setIsLoadingSchemas] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const maxVisibleItems = 5;



  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Fetch schemas from API
  useEffect(() => {
    const fetchSchemas = async () => {
      if (!workspace?.id) return;

      setIsLoadingSchemas(true);
      try {
        const response = await fetch(`/api/swarm/jarvis/schema?id=${workspace.id}`);
        const data = await response.json();

        if (data.success && data.data?.schemas) {
          setSchemas(data.data.schemas.filter((schema: SchemaExtended) => !schema.is_deleted));
        }
      } catch (error) {
        console.error('Failed to fetch schemas:', error);
        toast.error('Failed to load schemas');
      } finally {
        setIsLoadingSchemas(false);
      }
    };

    fetchSchemas();
  }, [workspace?.id]);

  // Parse existing node type configuration from workspace
  const existingConfig = useMemo(() => {
    if (!workspace?.nodeTypeOrder || !Array.isArray(workspace.nodeTypeOrder)) {
      return [];
    }
    // Assuming the structure is { type: string, value: number }
    return workspace.nodeTypeOrder as NodeTypeConfigItem[];
  }, [workspace?.nodeTypeOrder]);

  // Create merged list of node types with values and IDs for DnD
  const [nodeTypeConfig, setNodeTypeConfig] = useState<NodeTypeConfigItem[]>(() => {
    // 1. Get all node types from schemas (alphabetically sorted)
    const schemaNodeTypes = schemas
      .filter(schema => !schema.is_deleted)
      .map(schema => schema.type)
      .sort((a, b) => a.localeCompare(b));

    // 2. Combine with node types from current graph data
    const allNodeTypes = Array.from(new Set([...schemaNodeTypes, ...nodeTypesFromGraph]));

    // 3. Sort: existing order first (preserving order), then alphabetically
    const existingTypes = new Set(existingConfig.map(item => item.type));
    const newTypes = allNodeTypes.filter(type => !existingTypes.has(type)).sort();

    // Create items from existing config (preserving order)
    const existingItems = existingConfig.map((item, index) => ({
      id: `existing-${item.type}-${index}`,
      type: item.type,
      value: item.value
    }));

    // Create items for new types (sorted alphabetically)
    const newItems = newTypes.map((type, index) => ({
      id: `new-${type}-${index}`,
      type: type,
      value: 20 // Default value of 20 for new types
    }));

    const combined = [...existingItems, ...newItems];

    if (combined.length === 0) {
      // Default node types when no schemas or data is available
      const defaultTypes = ['Function', 'Feature', 'File', 'Endpoint', 'Person', 'Episode', 'Call', 'Message'];
      return defaultTypes.map((type, index) => ({ id: `default-${type}-${index}`, type, value: 20 }));
    }

    return combined;
  });

  // Update nodeTypeConfig when schemas change
  useEffect(() => {
    // 1. Get all node types from schemas (alphabetically sorted)
    const schemaNodeTypes = schemas
      .filter(schema => !schema.is_deleted)
      .map(schema => schema.type)
      .sort((a, b) => a.localeCompare(b));

    // 2. Combine with node types from current graph data
    const allNodeTypes = Array.from(new Set([...schemaNodeTypes, ...nodeTypesFromGraph]));

    // 3. Sort: existing order first (preserving order), then alphabetically
    const existingTypes = new Set(existingConfig.map(item => item.type));
    const currentTypes = new Set(nodeTypeConfig.map(item => item.type));
    const newTypes = allNodeTypes.filter(type => !existingTypes.has(type) && !currentTypes.has(type)).sort();

    // Only update if there are actually new types to add
    if (newTypes.length > 0) {
      setNodeTypeConfig(prev => {
        const newItems = newTypes.map((type, index) => ({
          id: `${type}-${Date.now()}-${index}`, // Ensure unique ID
          type: type,
          value: 20
        }));
        return [...prev, ...newItems];
      });
    }
  }, [schemas, nodeTypesFromGraph, existingConfig]);

  // Handle drag end event
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setNodeTypeConfig(prev => {
        const oldIndex = prev.findIndex(item => item.id === active.id);
        const newIndex = prev.findIndex(item => item.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  }, []);

  // Handle value change for a specific node type
  const handleValueChange = useCallback((nodeType: string, newValue: number) => {
    setNodeTypeConfig(prev =>
      prev.map(item =>
        item.type === nodeType
          ? { ...item, value: newValue }
          : item
      )
    );
  }, []);

  // Handle adding a new node type
  const handleAddNewNodeType = useCallback(() => {
    const trimmedName = newNodeTypeName.trim();

    if (!trimmedName) {
      toast.error("Please enter a node type name");
      return;
    }

    // Check if node type already exists
    const existingType = nodeTypeConfig.find(item =>
      item.type.toLowerCase() === trimmedName.toLowerCase()
    );

    if (existingType) {
      toast.error("A node type with this name already exists");
      return;
    }

    // Add new node type
    const newNodeType: NodeTypeConfigItem = {
      id: `${trimmedName}-${Date.now()}`,
      type: trimmedName,
      value: 20 // Default value
    };

    setNodeTypeConfig(prev => [...prev, newNodeType]);
    setNewNodeTypeName("");
    setIsAddingNewType(false);
    toast.success(`Added new node type: ${trimmedName}`);
  }, [newNodeTypeName, nodeTypeConfig]);

  // Handle canceling new node type creation
  const handleCancelNewNodeType = useCallback(() => {
    setNewNodeTypeName("");
    setIsAddingNewType(false);
  }, []);

  // Handle removing a node type
  const handleRemoveNodeType = useCallback((nodeTypeId: string) => {
    setNodeTypeConfig(prev => prev.filter(item => item.id !== nodeTypeId));
    toast.success("Node type removed");
  }, []);


  // Save configuration
  const handleSave = useCallback(async () => {
    if (!workspace) return;

    setIsSubmitting(true);
    try {
      // Convert to API format (remove id field)
      const apiData = nodeTypeConfig.map(({ type, value }) => ({ type, value }));

      const response = await fetch(`/api/workspaces/${workspace.slug}/settings/node-type-order`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ nodeTypeOrder: apiData }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to save node type configuration");
      }

      // Sync workspace context so new order is reflected immediately
      updateWorkspace({ nodeTypeOrder: result.data?.nodeTypeOrder ?? apiData });

      toast.success("Node type configuration saved successfully");
    } catch (error) {
      console.error("Error saving node type configuration:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save node type configuration");
    } finally {
      setIsSubmitting(false);
    }
  }, [workspace, nodeTypeConfig, updateWorkspace]);

  // Check if configuration has changed
  const hasChanges = useMemo(() => {
    if (existingConfig.length !== nodeTypeConfig.length) return true;

    // Compare ordered lists; any order or value change counts
    for (let i = 0; i < nodeTypeConfig.length; i++) {
      const current = nodeTypeConfig[i];
      const existing = existingConfig[i];

      if (!existing) return true;
      if (existing.type !== current.type) return true;
      if (existing.value !== current.value) return true;
    }

    return false;
  }, [existingConfig, nodeTypeConfig]);

  if (!workspace) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Node Type Configuration
        </CardTitle>
        <CardDescription>
          Configure numeric values for each node type and reorder them using drag-and-drop.
          These values and order will be available for use in API requests and graph operations.
          {isLoadingSchemas && " (Loading schemas...)"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={nodeTypeConfig.map(item => item.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-2">
              {(isExpanded ? nodeTypeConfig : nodeTypeConfig.slice(0, maxVisibleItems)).map((item) => (
                <SortableNodeTypeRow
                  key={item.id}
                  item={item}
                  onValueChange={handleValueChange}
                  onRemove={handleRemoveNodeType}
                  canRemove={!nodeTypesFromGraph.includes(item.type)}
                />
              ))}

              {/* Show expand/collapse button if there are more items */}
              {nodeTypeConfig.length > maxVisibleItems && (
                <div className="flex justify-center pt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="w-4 h-4 mr-2" />
                        Show Less ({nodeTypeConfig.length - maxVisibleItems} hidden)
                      </>
                    ) : (
                      <>
                        <ChevronDown className="w-4 h-4 mr-2" />
                        Show More ({nodeTypeConfig.length - maxVisibleItems} more)
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* Add new node type row */}
              {isAddingNewType && (
                <div className="flex items-center gap-3 p-3 border rounded-lg bg-card border-dashed">
                  <div className="w-4 h-4 flex-shrink-0" /> {/* Spacer for grip handle */}
                  <div className="flex items-center gap-3 flex-1">
                    <Input
                      value={newNodeTypeName}
                      onChange={(e) => setNewNodeTypeName(e.target.value)}
                      placeholder="Enter node type name"
                      className="flex-1"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleAddNewNodeType();
                        } else if (e.key === 'Escape') {
                          handleCancelNewNodeType();
                        }
                      }}
                      autoFocus
                    />
                    <Input
                      type="number"
                      min="0"
                      max="999"
                      value={20}
                      readOnly
                      className="w-20 text-center bg-muted hidden"
                      placeholder="20"
                    />
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleAddNewNodeType}
                        className="h-8 w-8 p-0 text-green-600 hover:text-green-700"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelNewNodeType}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </SortableContext>
        </DndContext>

        {nodeTypeConfig.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No node types found. Load some graph data to configure values.
          </div>
        )}

        <div className="flex justify-between pt-4">
          <div className="flex items-center gap-2">
            {!isAddingNewType && (
              <Button
                variant="outline"
                onClick={() => setIsAddingNewType(true)}
                disabled={isSubmitting}
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Node Type
              </Button>
            )}
          </div>

          <Button
            onClick={handleSave}
            disabled={isSubmitting || !hasChanges}
          >
            {isSubmitting ? "Saving..." : "Save Configuration"}
          </Button>
        </div>

        {nodeTypeConfig.length > 0 && (
          <div className="text-sm text-muted-foreground mt-2">
            These values will be available for use in API requests and graph operations.
            <br />
            Example: Functions: {nodeTypeConfig.find(item => item.type === 'Function')?.value || 20}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
