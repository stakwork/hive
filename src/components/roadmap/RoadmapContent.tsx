"use client";

import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Lightbulb, Users, FileText, Sparkles } from "lucide-react";
import { FeatureCard } from "./FeatureCard";
import { CreateFeatureDialog } from "./CreateFeatureDialog";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";

export interface Feature {
  id: string;
  title: string;
  brief: string;
  status: "planning" | "in-progress" | "completed" | "on-hold";
  priority: "low" | "medium" | "high";
  userStories: UserStory[];
  requirements: Requirement[];
  createdAt: Date;
  updatedAt: Date;
}

export interface UserStory {
  id: string;
  title: string;
  description: string;
  asA: string;
  iWant: string;
  soThat: string;
  acceptanceCriteria: string[];
  priority: "low" | "medium" | "high";
}

export interface Requirement {
  id: string;
  title: string;
  description: string;
  details?: string;
  type: "functional" | "non-functional" | "business" | "technical";
  priority: "low" | "medium" | "high";
  status: "draft" | "approved" | "implemented";
  acceptanceCriteria: string[];
  source?: string;
}

export function RoadmapContent() {
  const router = useRouter();
  const { slug: workspaceSlug } = useWorkspace();
  const [features, setFeatures] = useState<Feature[]>([
    {
      id: "1",
      title: "User Authentication",
      brief:
        "Implement secure user authentication system with multiple providers",
      status: "in-progress",
      priority: "high",
      userStories: [
        {
          id: "us1",
          title: "Login with Google",
          description: "User can authenticate using Google OAuth",
          asA: "User",
          iWant: "to login with my Google account",
          soThat:
            "I can access the platform quickly without creating new credentials",
          acceptanceCriteria: [
            "Google OAuth button is visible on login page",
            "Successful authentication redirects to dashboard",
            "User profile is populated with Google data",
          ],
          priority: "high",
        },
      ],
      requirements: [
        {
          id: "req1",
          title: "OAuth Integration",
          description:
            "Implement OAuth 2.0 flow for third-party authentication",
          type: "functional",
          priority: "high",
          status: "approved",
          acceptanceCriteria: [
            "OAuth flow redirects properly",
            "User credentials are secure",
          ],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "2",
      title: "Dashboard Analytics",
      brief: "Comprehensive analytics dashboard with real-time metrics",
      status: "planning",
      priority: "medium",
      userStories: [],
      requirements: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ]);

  const [createFeatureOpen, setCreateFeatureOpen] = useState(false);

  const handleCreateFeature = (
    featureData: Omit<Feature, "id" | "createdAt" | "updatedAt">,
  ) => {
    const newFeature: Feature = {
      ...featureData,
      id: Date.now().toString(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    setFeatures([...features, newFeature]);
    setCreateFeatureOpen(false);
  };

  //const handleUpdateFeature = (updatedFeature: Feature) => {
  //  setFeatures(features.map(f =>
  //    f.id === updatedFeature.id
  //      ? { ...updatedFeature, updatedAt: new Date() }
  //      : f
  //  ));
  //};

  //const handleDeleteFeature = (featureId: string) => {
  //  setFeatures(features.filter(f => f.id !== featureId));
  //};

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

  const statusCounts = features.reduce(
    (acc, feature) => {
      acc[feature.status] = (acc[feature.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Features
            </CardTitle>
            <Lightbulb className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{features.length}</div>
            <p className="text-xs text-muted-foreground">Across all stages</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statusCounts["in-progress"] || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Currently developing
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Planning</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statusCounts["planning"] || 0}
            </div>
            <p className="text-xs text-muted-foreground">In design phase</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {statusCounts["completed"] || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              Successfully delivered
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Features Section */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Features</h2>
          <p className="text-muted-foreground">
            Manage your product features and track their progress
          </p>
        </div>
        <Button onClick={() => setCreateFeatureOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          New Feature
        </Button>
      </div>

      {/* Features Grid */}
      {features.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Lightbulb className="w-12 h-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No features yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Start building your roadmap by creating your first feature
            </p>
            <Button onClick={() => setCreateFeatureOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create First Feature
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature) => (
            <FeatureCard
              key={feature.id}
              feature={feature}
              onEdit={() =>
                router.push(`/w/${workspaceSlug}/roadmap/feature/${feature.id}`)
              }
              getStatusColor={getStatusColor}
              getPriorityColor={getPriorityColor}
            />
          ))}
        </div>
      )}

      {/* Create Feature Dialog */}
      <CreateFeatureDialog
        open={createFeatureOpen}
        onOpenChange={setCreateFeatureOpen}
        onCreateFeature={handleCreateFeature}
      />
    </div>
  );
}
