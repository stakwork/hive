"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Edit, Trash2, Users, FileText, Sparkles } from "lucide-react";
import { Feature } from "./RoadmapContent";
import { UserStoriesTab } from "./UserStoriesTab";
import { RequirementsTab } from "./RequirementsTab";
import { EditFeatureDialog } from "./EditFeatureDialog";

interface FeatureDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: Feature;
  onUpdateFeature: (feature: Feature) => void;
  onDeleteFeature: (featureId: string) => void;
}

export function FeatureDetailDialog({
  open,
  onOpenChange,
  feature,
  onUpdateFeature,
  onDeleteFeature,
}: FeatureDetailDialogProps) {
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const getStatusColor = (status: Feature["status"]) => {
    switch (status) {
      case "planning":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "in-progress":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "completed":
        return "bg-green-100 text-green-800 border-green-200";
      case "on-hold":
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  const getPriorityColor = (priority: Feature["priority"]) => {
    switch (priority) {
      case "low":
        return "bg-gray-100 text-gray-800 border-gray-200";
      case "medium":
        return "bg-blue-100 text-blue-800 border-blue-200";
      case "high":
        return "bg-red-100 text-red-800 border-red-200";
    }
  };

  const handleDelete = () => {
    if (
      window.confirm(
        "Are you sure you want to delete this feature? This action cannot be undone.",
      )
    ) {
      onDeleteFeature(feature.id);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[900px] max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <DialogTitle className="text-2xl">{feature.title}</DialogTitle>
                <DialogDescription className="mt-2">
                  {feature.brief}
                </DialogDescription>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setEditDialogOpen(true)}
                >
                  <Edit className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleDelete}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap mt-4">
              <Badge
                variant="secondary"
                className={getStatusColor(feature.status)}
              >
                {feature.status.charAt(0).toUpperCase() +
                  feature.status.slice(1).replace("-", " ")}
              </Badge>
              <Badge
                variant="outline"
                className={getPriorityColor(feature.priority)}
              >
                {feature.priority.charAt(0).toUpperCase() +
                  feature.priority.slice(1)}{" "}
                Priority
              </Badge>
            </div>
          </DialogHeader>

          <Separator />

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 flex flex-col overflow-hidden"
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="user-stories"
                className="flex items-center gap-2"
              >
                <Users className="w-4 h-4" />
                User Stories ({feature.userStories.length})
              </TabsTrigger>
              <TabsTrigger
                value="requirements"
                className="flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                Requirements ({feature.requirements.length})
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden">
              <TabsContent value="overview" className="mt-4 space-y-4">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold mb-2">
                      Feature Brief
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">
                      {feature.brief}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium mb-2">Status</h4>
                      <Badge
                        variant="secondary"
                        className={getStatusColor(feature.status)}
                      >
                        {feature.status.charAt(0).toUpperCase() +
                          feature.status.slice(1).replace("-", " ")}
                      </Badge>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Priority</h4>
                      <Badge
                        variant="outline"
                        className={getPriorityColor(feature.priority)}
                      >
                        {feature.priority.charAt(0).toUpperCase() +
                          feature.priority.slice(1)}{" "}
                        Priority
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-medium mb-2">User Stories</h4>
                      <p className="text-2xl font-bold text-primary">
                        {feature.userStories.length}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Stories defined
                      </p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-2">Requirements</h4>
                      <p className="text-2xl font-bold text-primary">
                        {feature.requirements.length}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Requirements documented
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
                    <div>
                      <span className="font-medium">Created:</span>{" "}
                      {new Date(feature.createdAt).toLocaleDateString()}
                    </div>
                    <div>
                      <span className="font-medium">Last Updated:</span>{" "}
                      {new Date(feature.updatedAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent
                value="user-stories"
                className="mt-4 flex-1 overflow-hidden"
              >
                <UserStoriesTab
                  feature={feature}
                  onUpdateFeature={onUpdateFeature}
                />
              </TabsContent>

              <TabsContent
                value="requirements"
                className="mt-4 flex-1 overflow-hidden"
              >
                <RequirementsTab
                  feature={feature}
                  onUpdateFeature={onUpdateFeature}
                />
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      <EditFeatureDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        feature={feature}
        onUpdateFeature={onUpdateFeature}
      />
    </>
  );
}
