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
  GitBranch,
} from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { ConnectRepository } from "@/components/ConnectRepository";
import { CodeGraphVisualization, CodeNode } from "@/components/CodeGraphVisualization";
import { useState, useEffect } from "react";

export default function DashboardPage() {
  const { workspace, slug } = useWorkspace();

  // Example data from your provided structure
  const sampleNodes: CodeNode[] = [
    // Functions
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
    // Classes
    {
      "node_type": "Class",
      "ref_id": "class-1",
      "properties": {
        "token_count": 85,
        "file": "stakwork/hive/src/services/CodeGraphService.ts",
        "node_key": "class-codegraphservice",
        "name": "CodeGraphService",
        "start": 45,
        "end": 147,
        "body": "export class CodeGraphService {\n  private baseUrl: string;\n\n  constructor(graphUrl: string) {\n    this.baseUrl = graphUrl;\n  }\n  // ... methods\n}"
      }
    },
    {
      "node_type": "Class",
      "ref_id": "class-2", 
      "properties": {
        "token_count": 65,
        "file": "stakwork/hive/src/components/ui/Button.tsx",
        "node_key": "class-button",
        "name": "ButtonComponent",
        "start": 10,
        "end": 45,
        "body": "class ButtonComponent extends React.Component {\n  render() {\n    return <button {...this.props} />;\n  }\n}"
      }
    },
    // Datamodel
    {
      "node_type": "Datamodel",
      "ref_id": "datamodel-1",
      "properties": {
        "token_count": 95,
        "file": "stakwork/hive/prisma/schema.prisma",
        "node_key": "datamodel-workspace",
        "name": "Workspace",
        "start": 25,
        "end": 45,
        "body": "model Workspace {\n  id          String   @id @default(cuid())\n  name        String\n  slug        String   @unique\n  description String?\n  ownerId     String\n  createdAt   DateTime @default(now())\n  updatedAt   DateTime @updatedAt\n}"
      }
    },
    {
      "node_type": "Datamodel",
      "ref_id": "datamodel-2",
      "properties": {
        "token_count": 75,
        "file": "stakwork/hive/prisma/schema.prisma", 
        "node_key": "datamodel-user",
        "name": "User",
        "start": 50,
        "end": 70,
        "body": "model User {\n  id            String    @id @default(cuid())\n  name          String?\n  email         String    @unique\n  emailVerified DateTime?\n  image         String?\n  accounts      Account[]\n}"
      }
    },
    // Endpoints
    {
      "node_type": "Endpoint",
      "ref_id": "endpoint-1",
      "properties": {
        "token_count": 55,
        "file": "stakwork/hive/src/app/api/workspace/route.ts",
        "node_key": "endpoint-post-workspace",
        "name": "POST /api/workspace",
        "start": 15,
        "end": 35,
        "body": "export async function POST(request: Request) {\n  const data = await request.json();\n  // Create workspace logic\n  return Response.json({ success: true });\n}"
      }
    },
    {
      "node_type": "Endpoint", 
      "ref_id": "endpoint-2",
      "properties": {
        "token_count": 42,
        "file": "stakwork/hive/src/app/api/auth/route.ts",
        "node_key": "endpoint-get-auth",
        "name": "GET /api/auth",
        "start": 8,
        "end": 20,
        "body": "export async function GET() {\n  const session = await getServerSession();\n  return Response.json(session);\n}"
      }
    },
    // Pages
    {
      "node_type": "Page",
      "ref_id": "page-1",
      "properties": {
        "token_count": 78,
        "file": "stakwork/hive/src/app/w/[slug]/page.tsx",
        "node_key": "page-dashboard",
        "name": "DashboardPage",
        "start": 23,
        "end": 138,
        "body": "export default function DashboardPage() {\n  const { workspace, slug } = useWorkspace();\n  // Dashboard component logic\n  return <div>Dashboard</div>;\n}"
      }
    },
    {
      "node_type": "Page",
      "ref_id": "page-2",
      "properties": {
        "token_count": 63,
        "file": "stakwork/hive/src/app/login/page.tsx",
        "node_key": "page-login",
        "name": "LoginPage", 
        "start": 5,
        "end": 25,
        "body": "export default function LoginPage() {\n  return (\n    <div>\n      <h1>Login</h1>\n      <SignInButton />\n    </div>\n  );\n}"
      }
    },
    // Tests
    {
      "node_type": "Test",
      "ref_id": "test-1",
      "properties": {
        "token_count": 45,
        "file": "stakwork/hive/src/components/__tests__/Button.test.tsx",
        "node_key": "test-button-render",
        "name": "Button renders correctly",
        "start": 10,
        "end": 18,
        "body": "test('Button renders correctly', () => {\n  render(<Button>Click me</Button>);\n  expect(screen.getByText('Click me')).toBeInTheDocument();\n});"
      }
    },
    {
      "node_type": "Test",
      "ref_id": "test-2", 
      "properties": {
        "token_count": 52,
        "file": "stakwork/hive/src/hooks/__tests__/useWorkspace.test.ts",
        "node_key": "test-workspace-hook",
        "name": "useWorkspace hook test",
        "start": 15,
        "end": 25,
        "body": "test('useWorkspace returns workspace data', () => {\n  const { result } = renderHook(() => useWorkspace());\n  expect(result.current.workspace).toBeDefined();\n});"
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


      {/* Code Graph Visualization */}
      {workspace && workspace.isCodeGraphSetup && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GitBranch className="w-5 h-5" />
              Code Graph
            </CardTitle>
            <CardDescription>Interactive visualization of your codebase functions and their relationships</CardDescription>
          </CardHeader>
          <CardContent>
            {workspace && workspace.isCodeGraphSetup ? (
              <CodeGraphVisualization 
                workspaceId={workspace.id} 
                initialNodes={sampleNodes}
                initialEdges={[
                  { from: "2bcc7d09-80b7-4dda-95e3-49a8db52cc0f", to: "0c099b74-7a13-43af-a4a4-39e8beac5393", type: "calls" },
                  { from: "class-1", to: "endpoint-1", type: "uses" },
                  { from: "page-1", to: "class-1", type: "imports" },
                  { from: "endpoint-1", to: "datamodel-1", type: "queries" },
                  { from: "endpoint-2", to: "datamodel-2", type: "queries" },
                  { from: "test-1", to: "class-2", type: "tests" },
                  { from: "test-2", to: "page-1", type: "tests" }
                ]}
              />
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>Code Graph requires a swarm to be deployed.</p>
                <p className="text-sm mt-2">Complete the workspace setup to enable this feature.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
