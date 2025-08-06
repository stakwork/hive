"use client";

import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckSquare, Clock, Users, Calendar, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ConnectRepository } from "@/components/ConnectRepository";

interface Task {
  id: string;
  title: string;
  description: string;
  priority: "High" | "Medium" | "Low";
  status: "todo" | "inprogress" | "done";
  team: string;
  createdAt: Date;
  updatedAt: Date;
}

// Mock task data with timestamps for demonstration
const mockTasks: Task[] = [
  {
    id: "1",
    title: "Update user authentication",
    description: "Implement JWT token refresh and improve security.",
    priority: "High",
    status: "todo",
    team: "Backend Team",
    createdAt: new Date("2024-01-15T10:30:00Z"),
    updatedAt: new Date("2024-01-15T14:22:00Z"),
  },
  {
    id: "2", 
    title: "Design new landing page",
    description: "Create wireframes and mockups for the new homepage.",
    priority: "Medium",
    status: "todo",
    team: "Design Team",
    createdAt: new Date("2024-01-14T16:45:00Z"),
    updatedAt: new Date("2024-01-14T16:45:00Z"),
  },
  {
    id: "3",
    title: "Fix sidebar navigation", 
    description: "Resolve page refresh issues and modal disappearing.",
    priority: "High",
    status: "inprogress",
    team: "Frontend Team",
    createdAt: new Date("2024-01-16T08:15:00Z"),
    updatedAt: new Date("2024-01-16T11:30:00Z"),
  },
  {
    id: "4",
    title: "Database optimization",
    description: "Optimize queries and add proper indexing.",
    priority: "Medium", 
    status: "inprogress",
    team: "Backend Team",
    createdAt: new Date("2024-01-13T14:20:00Z"),
    updatedAt: new Date("2024-01-16T09:45:00Z"),
  },
  {
    id: "5",
    title: "Setup CI/CD pipeline",
    description: "Automated testing and deployment workflow.",
    priority: "High",
    status: "done", 
    team: "DevOps Team",
    createdAt: new Date("2024-01-12T11:00:00Z"),
    updatedAt: new Date("2024-01-15T17:30:00Z"),
  },
  {
    id: "6",
    title: "User registration flow",
    description: "Complete signup and verification process.",
    priority: "Medium",
    status: "done",
    team: "Full Stack",
    createdAt: new Date("2024-01-11T13:15:00Z"),
    updatedAt: new Date("2024-01-14T10:20:00Z"),
  },
  {
    id: "7",
    title: "Mobile responsive design",
    description: "Ensure all pages work properly on mobile devices.",
    priority: "High",
    status: "todo",
    team: "Frontend Team",
    createdAt: new Date("2024-01-17T09:00:00Z"),
    updatedAt: new Date("2024-01-17T09:00:00Z"),
  },
  {
    id: "8",
    title: "API documentation",
    description: "Create comprehensive API documentation for developers.",
    priority: "Low",
    status: "inprogress",
    team: "Backend Team",
    createdAt: new Date("2024-01-10T15:30:00Z"),
    updatedAt: new Date("2024-01-16T14:00:00Z"),
  },
];

export default function TasksPage() {
  const router = useRouter();
  const { workspace, slug } = useWorkspace();
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    // Simulate fetching tasks - in a real app this would be an API call
    setTasks(mockTasks);
  }, []);

  // Get the latest 5 tasks sorted by updatedAt descending
  const latestTasks = tasks
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  // Group latest tasks by status for rendering
  const tasksByStatus = {
    todo: latestTasks.filter(task => task.status === "todo"),
    inprogress: latestTasks.filter(task => task.status === "inprogress"), 
    done: latestTasks.filter(task => task.status === "done"),
  };

  const renderTaskCard = (task: Task) => (
    <div key={task.id} className={`p-3 border rounded-lg hover:bg-muted cursor-pointer ${task.status === 'done' ? 'bg-muted/50' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-medium">{task.title}</h4>
        <Badge variant={task.priority === "High" ? "secondary" : "outline"}>
          {task.priority}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-2">
        {task.description}
      </p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Users className="w-3 h-3" />
        <span>{task.team}</span>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Tasks</h1>
          <p className="text-muted-foreground mt-2">
            Manage and track your development tasks and issues.
          </p>
        </div>
        {workspace?.isCodeGraphSetup && (
          <Button onClick={() => router.push(`/w/${slug}/task/new`)}>
            <Plus className="w-4 h-4 mr-2" />
            New Task
          </Button>
        )}
      </div>

      {/* Connect Repository Card - Only show if CodeGraph is not set up */}
      {workspace && !workspace.isCodeGraphSetup ? (
        <ConnectRepository
          workspaceSlug={slug}
          title="Connect repository to Start Managing Tasks"
          description="Setup your development environment to ask codebase questions or write code."
          buttonText="Connect Repository"
        />
      ) : (
        <>
          {/* Task Stats - Updated to reflect latest 5 tasks display */}
          <div className="grid gap-6 md:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Latest Tasks Shown
                </CardTitle>
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{latestTasks.length}</div>
                <p className="text-xs text-muted-foreground">
                  Most recent updates
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  In Progress
                </CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tasksByStatus.inprogress.length}</div>
                <p className="text-xs text-muted-foreground">Active in latest 5</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Completed</CardTitle>
                <CheckSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tasksByStatus.done.length}</div>
                <p className="text-xs text-muted-foreground">Done in latest 5</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">To Do</CardTitle>
                <Calendar className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{tasksByStatus.todo.length}</div>
                <p className="text-xs text-muted-foreground">Pending in latest 5</p>
              </CardContent>
            </Card>
          </div>

          {/* Latest 5 Tasks - Dynamic rendering */}
          <div className="mb-4">
            <h2 className="text-xl font-semibold mb-2">Latest 5 Tasks</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Showing the 5 most recently updated tasks across all statuses
            </p>
          </div>
          
          <div className="grid gap-6 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
                  To Do ({tasksByStatus.todo.length})
                </CardTitle>
                <CardDescription>Tasks ready to be started</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {tasksByStatus.todo.length > 0 ? (
                  tasksByStatus.todo.map(renderTaskCard)
                ) : (
                  <p className="text-sm text-muted-foreground">No recent to-do tasks</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                  In Progress ({tasksByStatus.inprogress.length})
                </CardTitle>
                <CardDescription>Currently being worked on</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {tasksByStatus.inprogress.length > 0 ? (
                  tasksByStatus.inprogress.map(renderTaskCard)
                ) : (
                  <p className="text-sm text-muted-foreground">No recent in-progress tasks</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                  Done ({tasksByStatus.done.length})
                </CardTitle>
                <CardDescription>Completed tasks</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {tasksByStatus.done.length > 0 ? (
                  tasksByStatus.done.map(renderTaskCard)
                ) : (
                  <p className="text-sm text-muted-foreground">No recent completed tasks</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
