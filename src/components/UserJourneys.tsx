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
import { useStakgraphStore } from "@/stores/useStakgraphStore";
import { useEffect } from "react";
import { useWorkspace } from "@/hooks/useWorkspace";

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
  const { loadSettings, formData } = useStakgraphStore();
  const { slug } = useWorkspace();

  useEffect(() => {
    loadSettings(slug);
  }, [loadSettings, slug]);

  const handleCreateUserJourney = () => {
    // TODO: Implement user journey creation logic
    console.log("Create user journey clicked");
    console.log("Stakgraph store state:", formData);
    // You can now access any variables from the stakgraph store here
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">User Journeys</h1>
          <p className="text-muted-foreground mt-2">
            Track and optimize user experiences through your product
          </p>
        </div>
        <Button
          className="flex items-center gap-2"
          onClick={handleCreateUserJourney}
        >
          <Plus className="w-4 h-4" />
          Create User Journey
        </Button>
      </div>

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
    </div>
  );
}
