import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mock Stakgraph Mocks Inventory Endpoint
 *
 * Simulates: GET https://{swarm}:3355/mocks/inventory
 *
 * Returns mock external services inventory for testing the UI.
 */

const mockServices = [
  {
    name: "github",
    ref_id: "921d2c1d-39b0-49db-b691-e3c2fd88c2ca",
    description: "GitHub API integration for OAuth, repository operations, webhooks, and user management via @octokit/rest and direct API calls",
    linked_files: [
      "stakwork/hive/env.test.example",
      "stakwork/hive/env.example",
      "stakwork/hive/src/config/services.ts",
      "stakwork/hive/src/config/env.ts",
      "stakwork/hive/docs/GITHUB_MOCK_ENDPOINTS.md",
      "stakwork/hive/src/lib/mock/github-state.ts",
      "stakwork/hive/src/app/api/mock/github/search/users/route.ts",
      "stakwork/hive/src/app/api/mock/github/repos/[owner]/[repo]/commits/route.ts",
      "stakwork/hive/src/app/api/mock/github/repos/[owner]/[repo]/hooks/route.ts",
      "stakwork/hive/src/app/api/mock/github/repos/[owner]/[repo]/branches/route.ts",
      "stakwork/hive/src/app/api/mock/github/repos/[owner]/[repo]/route.ts",
      "stakwork/hive/src/app/api/mock/github/user/installations/route.ts",
      "stakwork/hive/src/app/api/mock/github/user/repos/route.ts",
      "stakwork/hive/src/app/api/mock/github/user/route.ts",
      "stakwork/hive/src/app/api/mock/github/applications/revoke/route.ts",
      "stakwork/hive/src/app/api/mock/github/oauth/access_token/route.ts",
      "stakwork/hive/src/lib/auth/nextauth.ts",
      "stakwork/hive/src/lib/github/userJourneys.ts",
      "stakwork/hive/src/lib/github/pullRequestContent.ts"
    ],
    file_count: 20,
    mocked: true,
  },
  {
    name: "pool-manager",
    ref_id: "44026264-dace-4a46-86e3-d13bd6627fd1",
    description: "Pool Manager API for workspace/pod provisioning and management at workspaces.sphinx.chat/api",
    linked_files: [
      "stakwork/hive/env.test.example",
      "stakwork/hive/env.example",
      "stakwork/hive/src/config/services.ts",
      "stakwork/hive/src/config/env.ts",
      "stakwork/hive/src/lib/mock/pool-manager-state.ts",
      "stakwork/hive/src/app/api/mock/pool-manager/users/route.ts",
      "stakwork/hive/src/app/api/mock/pool-manager/pools/[poolName]/workspaces/route.ts",
      "stakwork/hive/src/app/api/mock/pool-manager/pools/[poolName]/workspace/route.ts",
      "stakwork/hive/src/app/api/mock/pool-manager/pools/[poolName]/route.ts",
      "stakwork/hive/src/app/api/mock/pool-manager/pools/route.ts",
      "stakwork/hive/src/app/api/mock/pool-manager/auth/login/route.ts",
      "stakwork/hive/src/app/api/w/[slug]/pool/workspaces/route.ts",
      "stakwork/hive/src/app/api/w/[slug]/pool/status/route.ts",
      "stakwork/hive/src/app/api/pool-manager/claim-pod/[workspaceId]/route.ts",
      "stakwork/hive/src/lib/pods/utils.ts",
      "stakwork/hive/src/services/workspace.ts",
      "stakwork/hive/src/services/pool-manager/api/envVars.ts",
      "stakwork/hive/src/services/pool-manager/api/auth.ts",
    ],
    file_count: 18,
    mocked: true,
  },
  {
    name: "stakgraph",
    ref_id: "fd777eb6-4338-4ff4-8591-851526ff9171",
    description: "Stakgraph service for code repository ingestion and synchronization, runs on swarm instances at https://{swarmName}:3355",
    linked_files: [
      "stakwork/hive/env.test.example",
      "stakwork/hive/env.example",
      "stakwork/hive/src/config/services.ts",
      "stakwork/hive/src/config/env.ts",
      "stakwork/hive/docs/STAKGRAPH_MOCK_ENDPOINTS.md",
      "stakwork/hive/src/lib/mock/stakgraph-state.ts",
      "stakwork/hive/src/app/api/mock/stakgraph/status/[requestId]/route.ts",
      "stakwork/hive/src/app/api/mock/stakgraph/sync/route.ts",
      "stakwork/hive/src/app/api/mock/stakgraph/sync_async/route.ts",
      "stakwork/hive/src/app/api/mock/stakgraph/ingest_async/route.ts",
      "stakwork/hive/src/app/api/swarm/stakgraph/agent-stream/route.ts",
      "stakwork/hive/src/app/api/workspaces/[slug]/stakgraph/route.ts",
      "stakwork/hive/src/lib/utils/stakgraph-url.ts",
      "stakwork/hive/src/services/swarm/stakgraph-status.ts",
      "stakwork/hive/src/services/swarm/stakgraph-actions.ts",
      "stakwork/hive/src/services/swarm/stakgraph-services.ts",
    ],
    file_count: 16,
    mocked: true,
  },
  {
    name: "stakwork",
    ref_id: "9fece364-64ec-48d8-9476-6751f5c0fb34",
    description: "Stakwork API integration for workflow orchestration, task management, and AI processing at jobs.stakwork.com/api/v1",
    linked_files: [
      "stakwork/hive/env.test.example",
      "stakwork/hive/env.example",
      "stakwork/hive/src/config/services.ts",
      "stakwork/hive/src/config/env.ts",
      "stakwork/hive/src/lib/mock/stakwork-state.ts",
      "stakwork/hive/src/app/api/mock/stakwork/secrets/route.ts",
      "stakwork/hive/src/app/api/mock/stakwork/projects/route.ts",
      "stakwork/hive/src/app/api/webhook/stakwork/response/route.ts",
      "stakwork/hive/src/app/api/transcript/chunk/route.ts",
      "stakwork/hive/src/app/api/chat/message/route.ts",
      "stakwork/hive/src/services/janitor.ts",
      "stakwork/hive/src/services/task-workflow.ts",
      "stakwork/hive/src/services/stakwork-run.ts",
      "stakwork/hive/src/services/stakwork/index.ts",
    ],
    file_count: 14,
    mocked: true,
  },
  {
    name: "swarm-super-admin",
    ref_id: "3243e88c-15ff-4d05-848d-8b9cda1e44a2",
    description: "Swarm Super Admin API for creating and managing swarm instances with privileged operations",
    linked_files: [
      "stakwork/hive/env.test.example",
      "stakwork/hive/env.example",
      "stakwork/hive/src/config/services.ts",
      "stakwork/hive/src/config/env.ts",
      "stakwork/hive/docs/SWARM_MOCK_ENDPOINTS.md",
      "stakwork/hive/src/lib/mock/swarm-state.ts",
      "stakwork/hive/src/app/api/mock/swarm-super-admin/api/super/check-domain/route.ts",
      "stakwork/hive/src/app/api/mock/swarm-super-admin/api/super/details/route.ts",
      "stakwork/hive/src/app/api/mock/swarm-super-admin/api/super/stop_swarm/route.ts",
      "stakwork/hive/src/app/api/mock/swarm-super-admin/api/super/new_swarm/route.ts",
      "stakwork/hive/src/services/swarm/SwarmService.ts",
      "stakwork/hive/src/services/swarm/api/swarm.ts",
    ],
    file_count: 12,
    mocked: true,
  },
  {
    name: "anthropic",
    ref_id: "353fd434-8c3a-4404-b1ec-7d618ee35eec",
    description: "Anthropic Claude API for AI-powered feature generation, code analysis, and natural language processing via aieo library",
    linked_files: [
      "stakwork/hive/env.test.example",
      "stakwork/hive/env.example",
      "stakwork/hive/src/config/services.ts",
      "stakwork/hive/src/config/env.ts",
      "stakwork/hive/src/app/api/pool-manager/claim-pod/[workspaceId]/route.ts",
      "stakwork/hive/src/app/api/ask/quick/route.ts",
      "stakwork/hive/src/app/api/features/[featureId]/generate/route.ts",
      "stakwork/hive/src/lib/pods/utils.ts",
      "stakwork/hive/src/lib/ai/askTools.ts",
      "stakwork/hive/src/lib/ai/extract-feature.ts",
      "stakwork/hive/src/lib/ai/commit-msg.ts",
      "stakwork/hive/src/lib/ai/wake-word-detector.ts",
    ],
    file_count: 12,
    mocked: false,
  },
  {
    name: "pusher",
    ref_id: "47c7b2d3-d438-41fb-984c-ce3cca51e113",
    description: "Pusher real-time messaging service for chat updates, workflow status changes, and live notifications",
    linked_files: [
      "stakwork/hive/env.test.example",
      "stakwork/hive/env.example",
      "stakwork/hive/src/config/services.ts",
      "stakwork/hive/src/config/env.ts",
      "stakwork/hive/src/services/janitor.ts",
      "stakwork/hive/src/services/stakwork-run.ts",
      "stakwork/hive/src/hooks/useWebhookHighlights.ts",
      "stakwork/hive/src/hooks/usePusherConnection.ts",
      "stakwork/hive/src/lib/pusher.ts",
    ],
    file_count: 9,
    mocked: false,
  },
  {
    name: "jarvis",
    ref_id: "d21076ad-8b2a-4192-aec1-6b7bc894a537",
    description: "Jarvis service for knowledge graph statistics and call topic analysis",
    linked_files: [
      "stakwork/hive/env.test.example",
      "stakwork/hive/env.example",
      "stakwork/hive/src/config/services.ts",
      "stakwork/hive/src/config/env.ts",
      "stakwork/hive/docs/JARVIS_MOCK_ENDPOINTS.md",
      "stakwork/hive/src/app/api/mock/jarvis/stats/route.ts",
      "stakwork/hive/src/app/api/mock/jarvis/graph/route.ts",
      "stakwork/hive/src/app/api/workspaces/[slug]/calls/[ref_id]/topics/route.ts",
      "stakwork/hive/src/app/api/swarm/jarvis/nodes/route.ts",
    ],
    file_count: 9,
    mocked: true,
  },
  {
    name: "aws-s3",
    ref_id: "76e0d32f-04a7-406a-ba88-db9ce65c48fe",
    description: "AWS S3 file storage for workspace logos, screenshots, and attachments using @aws-sdk/client-s3 with Vercel OIDC authentication",
    linked_files: [
      "stakwork/hive/env.test.example",
      "stakwork/hive/env.example",
      "stakwork/hive/src/config/services.ts",
      "stakwork/hive/src/config/env.ts",
      "stakwork/hive/src/app/api/screenshots/route.ts",
      "stakwork/hive/src/services/workspace-logo.ts",
      "stakwork/hive/src/services/s3.ts",
    ],
    file_count: 7,
    mocked: false,
  },
  {
    name: "stakwork-websocket",
    ref_id: "51e9284e-b231-4039-86fc-9e6a6913e903",
    description: "Stakwork WebSocket connection for real-time project logs via wss://jobs.stakwork.com/cable",
    linked_files: [
      "stakwork/hive/env.test.example",
      "stakwork/hive/env.example",
      "stakwork/hive/src/config/services.ts",
      "stakwork/hive/src/config/env.ts",
      "stakwork/hive/src/types/stakwork/websocket.ts",
      "stakwork/hive/src/app/w/[slug]/task/[...taskParams]/page.tsx",
      "stakwork/hive/src/hooks/useProjectLogWebSocket.ts",
    ],
    file_count: 7,
    mocked: false,
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 20)));
  const offset = Math.max(0, Number(searchParams.get("offset") || 0));
  const search = searchParams.get("search") || "";
  const mockedFilter = searchParams.get("mocked");

  let items = [...mockServices];

  // Filter by mocked status
  if (mockedFilter === "true") {
    items = items.filter((item) => item.mocked);
  } else if (mockedFilter === "false") {
    items = items.filter((item) => !item.mocked);
  }

  // Filter by search
  if (search) {
    const searchLower = search.toLowerCase();
    items = items.filter(
      (item) =>
        item.name.toLowerCase().includes(searchLower) ||
        item.description.toLowerCase().includes(searchLower)
    );
  }

  const total_count = items.length;
  const paginatedItems = items.slice(offset, offset + limit);

  return NextResponse.json({
    items: paginatedItems,
    total_count,
    total_returned: paginatedItems.length,
  });
}
