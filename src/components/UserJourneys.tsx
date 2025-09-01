"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, CheckCircle, Clock, Users, Target } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useState } from "react";
import { BrowserArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/browser";
import { Artifact, BrowserContent } from "@/lib/chat";

const mockUserJourneys = [
  {
    id: 1,
    title: "New User Onboarding",
    description: "Complete journey from signup to first task completion",
    status: "completed",
    steps: 5,
    completedSteps: 5,
    users: 127,
    target: "Increase conversion rate by 25%",
    completedAt: "2024-01-15",
  },
  {
    id: 2,
    title: "Feature Discovery Flow",
    description: "Guide users through discovering and using key features",
    status: "completed",
    steps: 8,
    completedSteps: 8,
    users: 89,
    target: "Improve feature adoption by 40%",
    completedAt: "2024-01-10",
  },
  {
    id: 3,
    title: "Workspace Collaboration",
    description: "Help teams set up and collaborate effectively",
    status: "completed",
    steps: 6,
    completedSteps: 6,
    users: 156,
    target: "Increase team collaboration by 30%",
    completedAt: "2024-01-08",
  },
];

export default function UserJourneys() {
  const { id } = useWorkspace();
  const [isLoading, setIsLoading] = useState(false);
  const [frontend, setFrontend] = useState<string | null>(null);

  const handleCreateUserJourney = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/pool-manager/claim-pod/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      setIsLoading(false);

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to claim pod:", errorData);
        // You can add error handling UI here
        return;
      }

      const data = await response.json();
      console.log("Pod claimed successfully:", data);
      if (data.frontend) {
        setFrontend(data.frontend);
      }
      // You can add success handling UI here
    } catch (error) {
      console.error("Error claiming pod:", error);
      // You can add error handling UI here
    }
  };

  const saveUserJourneyTest = async (
    filename: string,
    generatedCode: string,
  ) => {
    try {
      console.log("Saving user journey:", filename, generatedCode);

      const response = await fetch("/api/stakwork/user-journey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: generatedCode,
          workspaceId: id,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Failed to save user journey:", errorData);
        return;
      }

      const data = await response.json();
      console.log("User journey saved successfully:", data);

      // You can add success handling UI here, such as showing a toast notification
    } catch (error) {
      console.error("Error saving user journey:", error);
      // You can add error handling UI here
    }
  };

  // Create artifacts array for BrowserArtifactPanel when frontend is defined
  const browserArtifacts: Artifact[] = frontend
    ? [
        {
          id: "frontend-preview",
          messageId: "",
          type: "BROWSER",
          content: { url: frontend } as BrowserContent,
          icon: "Code",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">User Journeys</h1>
          <p className="text-muted-foreground mt-2">
            Track and optimize user experiences through your product
          </p>
        </div>
        {frontend ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFrontend(null)}
            className="h-8 w-8 p-0"
          >
            ✕
          </Button>
        ) : (
          <Button
            className="flex items-center gap-2"
            onClick={handleCreateUserJourney}
            disabled={isLoading}
          >
            <Plus className="w-4 h-4" />
            Create User Journey
          </Button>
        )}
      </div>

      {frontend ? (
        <div className="h-[600px] border rounded-lg overflow-hidden">
          <BrowserArtifactPanel
            artifacts={browserArtifacts}
            ide={false}
            onUserJourneySave={saveUserJourneyTest}
          />
        </div>
      ) : (
        <div className="grid gap-6">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-semibold">Completed Journeys</h2>
            <Badge variant="secondary" className="text-sm">
              {mockUserJourneys.length} completed
            </Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {mockUserJourneys.map((journey) => (
              <Card
                key={journey.id}
                className="hover:shadow-md transition-shadow"
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{journey.title}</CardTitle>
                      <CardDescription className="mt-2">
                        {journey.description}
                      </CardDescription>
                    </div>
                    <CheckCircle className="w-5 h-5 text-green-500 mt-1" />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium">
                      {journey.completedSteps}/{journey.steps} steps
                    </span>
                  </div>

                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{
                        width: `${(journey.completedSteps / journey.steps) * 100}%`,
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-muted-foreground" />
                      <span>{journey.users} users</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">Target met</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      Completed {journey.completedAt}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
