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
import { Plus, Edit, Trash2, Users } from "lucide-react";
import { Feature, UserStory } from "./RoadmapContent";
import { CreateUserStoryDialog } from "./CreateUserStoryDialog";
import { EditUserStoryDialog } from "./EditUserStoryDialog";

interface UserStoriesTabProps {
  feature: Feature;
  onUpdateFeature: (feature: Feature) => void;
}

export function UserStoriesTab({
  feature,
  onUpdateFeature,
}: UserStoriesTabProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedStory, setSelectedStory] = useState<UserStory | null>(null);

  const handleCreateStory = (storyData: Omit<UserStory, "id">) => {
    const newStory: UserStory = {
      ...storyData,
      id: Date.now().toString(),
    };

    const updatedFeature = {
      ...feature,
      userStories: [...feature.userStories, newStory],
    };

    onUpdateFeature(updatedFeature);
    setCreateDialogOpen(false);
  };

  const handleUpdateStory = (updatedStory: UserStory) => {
    const updatedFeature = {
      ...feature,
      userStories: feature.userStories.map((story) =>
        story.id === updatedStory.id ? updatedStory : story,
      ),
    };

    onUpdateFeature(updatedFeature);
    setEditDialogOpen(false);
    setSelectedStory(null);
  };

  const handleDeleteStory = (storyId: string) => {
    if (window.confirm("Are you sure you want to delete this user story?")) {
      const updatedFeature = {
        ...feature,
        userStories: feature.userStories.filter(
          (story) => story.id !== storyId,
        ),
      };

      onUpdateFeature(updatedFeature);
    }
  };

  const openEditDialog = (story: UserStory) => {
    setSelectedStory(story);
    setEditDialogOpen(true);
  };

  const getPriorityColor = (priority: UserStory["priority"]) => {
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
          <h3 className="text-lg font-semibold">User Stories</h3>
          <p className="text-sm text-muted-foreground">
            Define user stories to capture user needs and requirements
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Add Story
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {feature.userStories.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Users className="w-12 h-12 text-muted-foreground mb-4" />
              <h4 className="text-lg font-semibold mb-2">
                No user stories yet
              </h4>
              <p className="text-muted-foreground text-center mb-4">
                Start by adding your first user story to define what users need
                from this feature
              </p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create First Story
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {feature.userStories.map((story) => (
              <Card
                key={story.id}
                className="hover:shadow-md transition-shadow"
              >
                <CardHeader className="pb-4">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{story.title}</CardTitle>
                      <CardDescription className="mt-2">
                        {story.description}
                      </CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEditDialog(story)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteStory(story.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>

                <CardContent>
                  <div className="space-y-4">
                    <div className="bg-muted/50 p-4 rounded-lg">
                      <p className="text-sm">
                        <span className="font-medium">As a</span> {story.asA},{" "}
                        <span className="font-medium">I want</span>{" "}
                        {story.iWant},{" "}
                        <span className="font-medium">so that</span>{" "}
                        {story.soThat}.
                      </p>
                    </div>

                    {story.acceptanceCriteria &&
                      story.acceptanceCriteria.length > 0 && (
                        <div>
                          <h5 className="font-medium mb-2">
                            Acceptance Criteria
                          </h5>
                          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
                            {story.acceptanceCriteria.map((criteria, index) => (
                              <li key={index}>{criteria}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                    <div className="flex justify-between items-center">
                      <Badge
                        variant="outline"
                        className={getPriorityColor(story.priority)}
                      >
                        {story.priority.charAt(0).toUpperCase() +
                          story.priority.slice(1)}{" "}
                        Priority
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>

      <CreateUserStoryDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreateStory={handleCreateStory}
      />

      {selectedStory && (
        <EditUserStoryDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          story={selectedStory}
          onUpdateStory={handleUpdateStory}
        />
      )}
    </div>
  );
}
