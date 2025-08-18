"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Github,
  Calendar,
  Activity,
  Code,
  BarChart3,
  Settings,
} from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ConnectRepository } from "@/components/ConnectRepository";
import { CodeGraphVisualization, CodeNode } from "@/components/CodeGraphVisualization";

export default function DashboardPage() {
  const { workspace, slug } = useWorkspace();

  // Example data from your provided structure
  const sampleNodes: CodeNode[] = [
    {
      "node_type": "Function",
      "ref_id": "2bcc7d09-80b7-4dda-95e3-49a8db52cc0f",
      "properties": {
        "token_count": 40,
        "file": "stakwork/hive/src/components/workspace/AddMemberModal.tsx",
        "node_key": "function-handleselectuser-stakworkhivesrccomponentsworkspaceaddmembermodaltsx-147",
        "name": "handleSelectUser",
        "start": 147,
        "end": 152,
        "body": "const handleSelectUser = (user: GitHubUser) => {\n    setSelectedUser(user);\n    setSearchQuery(user.login);\n    form.setValue(\"githubUsername\", user.login);\n    setSearchResults([]);\n  };"
      }
    },
    {
      "node_type": "Function",
      "ref_id": "0c099b74-7a13-43af-a4a4-39e8beac5393",
      "properties": {
        "token_count": 38,
        "file": "stakwork/hive/src/app/w/[slug]/task/[...taskParams]/page.tsx",
        "node_key": "function-handlesend-stakworkhivesrcappwslugtasktaskparamspagetsx-189",
        "name": "handleSend",
        "start": 189,
        "end": 194,
        "body": "const handleSend = async (message: string) => {\n    await sendMessage(\n      message,\n      chatWebhook ? { webhook: chatWebhook } : undefined,\n    );\n  };"
      }
    },
    {
      "node_type": "Function",
      "ref_id": "2a967502-7779-44c8-ad32-600e20cacf6e",
      "properties": {
        "token_count": 120,
        "file": "stakwork/hive/src/components/stakgraph/forms/ServicesForm.tsx",
        "node_key": "function-handleservicechange-stakworkhivesrccomponentsstakgraphformsservicesformtsx-109",
        "name": "handleServiceChange",
        "start": 109,
        "end": 124,
        "body": "const handleServiceChange = (\n    idx: number,\n    field: keyof ServiceDataConfig,\n    value: string | number,\n  ) => {\n    const updatedServices = [...data];\n    if (field === \"port\") {\n      updatedServices[idx].port =\n        typeof value === \"number\" ? value : Number(value);\n    } else if (field === \"name\") {\n      updatedServices[idx].name = value as string;\n    } else if (field === \"interpreter\") {\n      updatedServices[idx].interpreter = value as string;\n    }\n    onChange(updatedServices);\n  };"
      }
    },
    {
      "node_type": "Function",
      "ref_id": "f9b77d35-8db8-4367-aefe-a6dad3a6ce0f",
      "properties": {
        "token_count": 57,
        "file": "stakwork/hive/src/stores/useStakgraphStore.ts",
        "node_key": "function-handleserviceschange-stakworkhivesrcstoresusestakgraphstorets-377",
        "name": "handleServicesChange",
        "start": 377,
        "end": 384,
        "body": "handleServicesChange: (services: ServiceDataConfig[]) => {\n      const state = get();\n      console.log(\"Store receiving services:\", services);\n      set({\n        formData: { ...state.formData, services: services },\n        saved: false,\n      });\n    }"
      }
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-2">
            Welcome to your development workspace.
          </p>
        </div>
      </div>

      {/* Onboarding Card - Only show if CodeGraph is not set up */}
      {workspace && !workspace.isCodeGraphSetup && (
        <ConnectRepository workspaceSlug={slug} />
      )}

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Tasks</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">24</div>
            <p className="text-xs text-muted-foreground">+3 from last week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Code Commits</CardTitle>
            <Github className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">142</div>
            <p className="text-xs text-muted-foreground">+12 from last week</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Sprint Progress
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">73%</div>
            <p className="text-xs text-muted-foreground">+5% from yesterday</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Dependencies</CardTitle>
            <Code className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">89</div>
            <p className="text-xs text-muted-foreground">+2 from last month</p>
          </CardContent>
        </Card>
      </div>

      {/* Code Graph Visualization */}
      {workspace && workspace.isCodeGraphSetup && (
        <Card>
          <CardHeader>
            <CardTitle>Code Graph</CardTitle>
            <CardDescription>Interactive visualization of your codebase functions and their relationships</CardDescription>
          </CardHeader>
          <CardContent>
            <CodeGraphVisualization 
              nodes={sampleNodes}
              edges={[
                { from: "2bcc7d09-80b7-4dda-95e3-49a8db52cc0f", to: "0c099b74-7a13-43af-a4a4-39e8beac5393", type: "calls" },
                { from: "2a967502-7779-44c8-ad32-600e20cacf6e", to: "f9b77d35-8db8-4367-aefe-a6dad3a6ce0f", type: "calls" }
              ]}
            />
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent Tasks</CardTitle>
            <CardDescription>Your most recently updated tasks</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center">
                <div className="w-2 h-2 bg-blue-500 rounded-full mr-3"></div>
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    Update user authentication
                  </p>
                  <p className="text-xs text-muted-foreground">2 hours ago</p>
                </div>
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-green-500 rounded-full mr-3"></div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Fix sidebar navigation</p>
                  <p className="text-xs text-muted-foreground">4 hours ago</p>
                </div>
              </div>
              <div className="flex items-center">
                <div className="w-2 h-2 bg-yellow-500 rounded-full mr-3"></div>
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    Optimize database queries
                  </p>
                  <p className="text-xs text-muted-foreground">1 day ago</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common tasks and shortcuts</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <button className="w-full text-left p-2 hover:bg-muted rounded-lg flex items-center">
                <Activity className="h-4 w-4 mr-2" />
                Create new task
              </button>
              <button className="w-full text-left p-2 hover:bg-muted rounded-lg flex items-center">
                <Github className="h-4 w-4 mr-2" />
                Connect repository
              </button>
              <button className="w-full text-left p-2 hover:bg-muted rounded-lg flex items-center">
                <Calendar className="h-4 w-4 mr-2" />
                Schedule meeting
              </button>
              <button className="w-full text-left p-2 hover:bg-muted rounded-lg flex items-center">
                <Settings className="h-4 w-4 mr-2" />
                Project settings
              </button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
