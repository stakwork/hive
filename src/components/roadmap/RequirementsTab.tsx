"use client";

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Edit, Trash2, FileText, Sparkles } from "lucide-react";
import { Feature, Requirement } from "./RoadmapContent";
import { CreateRequirementDialog } from "./CreateRequirementDialog";
import { EditRequirementDialog } from "./EditRequirementDialog";

interface RequirementsTabProps {
  feature: Feature;
  onUpdateFeature: (feature: Feature) => void;
}

export function RequirementsTab({
  feature,
  onUpdateFeature,
}: RequirementsTabProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedRequirement, setSelectedRequirement] =
    useState<Requirement | null>(null);
  const [aiSuggestions, setAISuggestions] = useState<string[]>([]);
  const [isAILoading, setIsAILoading] = useState(false);

  const fetchAIContext = async () => {
    setIsAILoading(true);
    // Simulate AI context fetching
    setTimeout(() => {
      const suggestions = [
        "System must handle 1000 concurrent users",
        "Response time must be under 200ms",
        "Must integrate with existing authentication system",
        "Should support mobile and desktop platforms",
      ];
      setAISuggestions(suggestions);
      setIsAILoading(false);
    }, 2000);
  };

  const handleCreateRequirement = (
    requirementData: Omit<Requirement, "id">,
  ) => {
    const newRequirement: Requirement = {
      ...requirementData,
      id: Date.now().toString(),
    };

    const updatedFeature = {
      ...feature,
      requirements: [...feature.requirements, newRequirement],
    };

    onUpdateFeature(updatedFeature);
    setCreateDialogOpen(false);
  };

  const handleUpdateRequirement = (updatedRequirement: Requirement) => {
    const updatedFeature = {
      ...feature,
      requirements: feature.requirements.map((req) =>
        req.id === updatedRequirement.id ? updatedRequirement : req,
      ),
    };

    onUpdateFeature(updatedFeature);
    setEditDialogOpen(false);
    setSelectedRequirement(null);
  };

  const handleDeleteRequirement = (requirementId: string) => {
    if (window.confirm("Are you sure you want to delete this requirement?")) {
      const updatedFeature = {
        ...feature,
        requirements: feature.requirements.filter(
          (req) => req.id !== requirementId,
        ),
      };

      onUpdateFeature(updatedFeature);
    }
  };

  const openEditDialog = (requirement: Requirement) => {
    setSelectedRequirement(requirement);
    setEditDialogOpen(true);
  };

  const getTypeColor = (type: Requirement["type"]) => {
    switch (type) {
      case "functional":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "non-functional":
        return "bg-purple-100 text-purple-800 border-purple-200";
      case "technical":
        return "bg-green-100 text-green-800 border-green-200";
      case "business":
        return "bg-orange-100 text-orange-800 border-orange-200";
    }
  };

  const getPriorityColor = (priority: Requirement["priority"]) => {
    switch (priority) {
      case "low":
        return "bg-gray-100 text-gray-800 border-gray-200";
      case "medium":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "high":
        return "bg-red-100 text-red-800 border-red-200";
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="text-lg font-semibold">Requirements</h3>
          <p className="text-sm text-muted-foreground">
            Document functional and technical requirements for this feature
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Requirement
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={fetchAIContext}
            disabled={isAILoading}
            className="flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {isAILoading ? "Fetching..." : "AI Context"}
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        {feature.requirements.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="w-12 h-12 text-muted-foreground mb-4" />
              <h4 className="text-lg font-semibold mb-2">
                No requirements yet
              </h4>
              <p className="text-muted-foreground text-center mb-4">
                Start by adding your first requirement to define what needs to
                be built
              </p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Requirement
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {feature.requirements.map((requirement) => (
              <Card
                key={requirement.id}
                className="hover:shadow-md transition-shadow"
              >
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <CardTitle className="text-lg">
                        {requirement.title}
                      </CardTitle>
                      <CardDescription className="mt-2">
                        {requirement.description}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(requirement)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteRequirement(requirement.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="space-y-4">
                    {requirement.details && (
                      <div className="bg-muted/50 p-4 rounded-lg">
                        <h5 className="font-medium mb-2">Details</h5>
                        <p className="text-sm text-muted-foreground">
                          {requirement.details}
                        </p>
                      </div>
                    )}

                    {requirement.acceptanceCriteria &&
                      requirement.acceptanceCriteria.length > 0 && (
                        <div>
                          <h5 className="font-medium mb-2">
                            Acceptance Criteria
                          </h5>
                          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                            {requirement.acceptanceCriteria.map(
                              (criteria, index) => (
                                <li key={index}>{criteria}</li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}

                    <div className="flex gap-2 flex-wrap">
                      <Badge
                        variant="outline"
                        className={getTypeColor(requirement.type)}
                      >
                        {requirement.type.charAt(0).toUpperCase() +
                          requirement.type.slice(1)}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={getPriorityColor(requirement.priority)}
                      >
                        {requirement.priority.charAt(0).toUpperCase() +
                          requirement.priority.slice(1)}{" "}
                        Priority
                      </Badge>
                      {requirement.source && (
                        <Badge variant="secondary">
                          Source: {requirement.source}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>

      <CreateRequirementDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateRequirement={handleCreateRequirement}
        aiSuggestions={aiSuggestions}
      />

      {selectedRequirement && (
        <EditRequirementDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          requirement={selectedRequirement}
          onUpdateRequirement={handleUpdateRequirement}
        />
      )}
    </div>
  );
}
