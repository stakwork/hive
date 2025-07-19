"use client";

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

export default function TasksPage() {
  const router = useRouter();
  const { slug } = useWorkspace();
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
        <Button onClick={() => router.push(`/w/${slug}/tasks/new`)}>
          <Plus className="w-4 h-4 mr-2" />
          New Task
        </Button>
      </div>

      {/* Task Stats */}
      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">45</div>
            <p className="text-xs text-muted-foreground">+5 from last week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">12</div>
            <p className="text-xs text-muted-foreground">Active tasks</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">28</div>
            <p className="text-xs text-muted-foreground">This sprint</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overdue</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">3</div>
            <p className="text-xs text-muted-foreground">Need attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Task Lists */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
              To Do
            </CardTitle>
            <CardDescription>Tasks ready to be started</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 border rounded-lg hover:bg-muted cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">
                  Update user authentication
                </h4>
                <Badge variant="secondary">High</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Implement JWT token refresh and improve security.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>Backend Team</span>
              </div>
            </div>

            <div className="p-3 border rounded-lg hover:bg-muted cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">Design new landing page</h4>
                <Badge variant="outline">Medium</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Create wireframes and mockups for the new homepage.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>Design Team</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
              In Progress
            </CardTitle>
            <CardDescription>Currently being worked on</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 border rounded-lg hover:bg-muted cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">Fix sidebar navigation</h4>
                <Badge variant="secondary">High</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Resolve page refresh issues and modal disappearing.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>Frontend Team</span>
              </div>
            </div>

            <div className="p-3 border rounded-lg hover:bg-muted cursor-pointer">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">Database optimization</h4>
                <Badge variant="outline">Medium</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Optimize queries and add proper indexing.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>Backend Team</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              Done
            </CardTitle>
            <CardDescription>Completed tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="p-3 border rounded-lg bg-muted/50">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">Setup CI/CD pipeline</h4>
                <Badge variant="outline">High</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Automated testing and deployment workflow.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>DevOps Team</span>
              </div>
            </div>

            <div className="p-3 border rounded-lg bg-muted/50">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-medium">User registration flow</h4>
                <Badge variant="outline">Medium</Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Complete signup and verification process.
              </p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="w-3 h-3" />
                <span>Full Stack</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
