import { listConcepts } from "@/lib/ai/askTools";
import { db } from "@/lib/db";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";

export interface SwarmCredentials {
  swarmUrl: string;
  swarmApiKey: string;
}

export interface WorkspaceAuth {
  workspaceId: string;
  userId: string;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

function mcpError(text: string): McpToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/**
 * Resolve a user within a workspace by fuzzy-matching the `user` string
 * against User.name and User.sphinxAlias (case-insensitive).
 * Falls back to the workspace owner when no match is found.
 */
export async function resolveWorkspaceUser(
  workspaceId: string,
  userHint?: string,
): Promise<string> {
  if (userHint) {
    const lower = userHint.toLowerCase();

    // Find all members + owner of this workspace
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        ownerId: true,
        owner: {
          select: { id: true, name: true, sphinxAlias: true },
        },
        members: {
          where: { leftAt: null },
          select: {
            user: {
              select: { id: true, name: true, sphinxAlias: true },
            },
          },
        },
      },
    });

    if (workspace) {
      // Collect all candidate users (owner + members), deduped
      const candidates = new Map<
        string,
        { id: string; name: string | null; sphinxAlias: string | null }
      >();
      if (workspace.owner) {
        candidates.set(workspace.owner.id, workspace.owner);
      }
      for (const m of workspace.members) {
        if (m.user) candidates.set(m.user.id, m.user);
      }

      for (const user of candidates.values()) {
        if (
          (user.name && user.name.toLowerCase() === lower) ||
          (user.sphinxAlias && user.sphinxAlias.toLowerCase() === lower)
        ) {
          return user.id;
        }
      }

      // If exact match failed, try "contains" as a softer fuzzy match
      for (const user of candidates.values()) {
        if (
          (user.name && user.name.toLowerCase().includes(lower)) ||
          (user.sphinxAlias && user.sphinxAlias.toLowerCase().includes(lower))
        ) {
          return user.id;
        }
      }

      return workspace.ownerId;
    }
  }

  // No hint or workspace lookup failed — fall back to owner
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  });
  if (!workspace) throw new Error("Workspace not found");
  return workspace.ownerId;
}

/**
 * List all concepts/features from the codebase knowledge base
 */
export async function mcpListConcepts(
  credentials: SwarmCredentials,
): Promise<McpToolResult> {
  try {
    const result = await listConcepts(
      credentials.swarmUrl,
      credentials.swarmApiKey,
    );
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    console.error("Error listing concepts:", error);
    return {
      content: [{ type: "text", text: "Error: Could not retrieve concepts" }],
      isError: true,
    };
  }
}

/**
 * Fetch documentation for a specific concept by ID
 */
export async function mcpLearnConcept(
  credentials: SwarmCredentials,
  conceptId: string,
): Promise<McpToolResult> {
  try {
    const res = await fetch(
      `${credentials.swarmUrl}/gitree/features/${encodeURIComponent(conceptId)}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": credentials.swarmApiKey,
        },
      },
    );

    if (!res.ok) {
      return {
        content: [{ type: "text", text: "Error: Concept not found" }],
        isError: true,
      };
    }

    const data = await res.json();
    // Return just the documentation content for efficient context usage
    const documentation =
      data.feature?.documentation || "No documentation available";
    return {
      content: [{ type: "text", text: documentation }],
    };
  } catch (error) {
    console.error("Error fetching concept:", error);
    return {
      content: [
        {
          type: "text",
          text: "Error: Could not retrieve concept documentation",
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Feature tools (DB-direct, no swarm required)
// ---------------------------------------------------------------------------

/**
 * List features for a workspace, ordered by last updated, max 40.
 * Returns only feature names and IDs.
 */
export async function mcpListFeatures(
  auth: WorkspaceAuth,
): Promise<McpToolResult> {
  try {
    const features = await db.feature.findMany({
      where: {
        workspaceId: auth.workspaceId,
        deleted: false,
      },
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 40,
    });

    const result = features.map((f) => ({
      id: f.id,
      title: f.title,
      status: f.status,
      updatedAt: f.updatedAt.toISOString(),
    }));

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    console.error("Error listing features:", error);
    return mcpError("Error: Could not list features");
  }
}

/**
 * Read a feature's chat message history and current workflow status.
 */
export async function mcpReadFeature(
  auth: WorkspaceAuth,
  featureId: string,
): Promise<McpToolResult> {
  try {
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: {
        id: true,
        title: true,
        status: true,
        workspaceId: true,
        workflowStatus: true,
        brief: true,
        requirements: true,
        architecture: true,
      },
    });

    if (!feature) return mcpError("Error: Feature not found");
    if (feature.workspaceId !== auth.workspaceId) {
      return mcpError("Error: Feature does not belong to this workspace");
    }

    const messages = await db.chatMessage.findMany({
      where: { featureId },
      include: {
        artifacts: {
          select: { type: true, content: true },
        },
        createdBy: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const chatHistory = messages.map((msg) => ({
      role: msg.role,
      message: msg.message,
      createdBy: msg.createdBy?.name || null,
      createdAt: msg.createdAt.toISOString(),
      artifacts: msg.artifacts.map((a) => ({
        type: a.type,
        content: a.content,
      })),
    }));

    const isWorkflowRunning =
      feature.workflowStatus === "IN_PROGRESS" ||
      feature.workflowStatus === "PENDING";

    const result = {
      id: feature.id,
      title: feature.title,
      status: feature.status,
      workflowStatus: feature.workflowStatus,
      isWorkflowRunning,
      brief: feature.brief,
      requirements: feature.requirements,
      architecture: feature.architecture,
      chatHistory,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    console.error("Error reading feature:", error);
    return mcpError("Error: Could not read feature");
  }
}

/**
 * Send a message in a feature chat, triggering the planning workflow.
 */
export async function mcpSendMessage(
  auth: WorkspaceAuth,
  featureId: string,
  message: string,
): Promise<McpToolResult> {
  try {
    // Verify feature belongs to this workspace
    const feature = await db.feature.findUnique({
      where: { id: featureId },
      select: { workspaceId: true },
    });

    if (!feature) return mcpError("Error: Feature not found");
    if (feature.workspaceId !== auth.workspaceId) {
      return mcpError("Error: Feature does not belong to this workspace");
    }

    await sendFeatureChatMessage({
      featureId,
      userId: auth.userId,
      message,
    });

    return {
      content: [
        { type: "text", text: "Message sent. The planning workflow has been triggered." },
      ],
    };
  } catch (error) {
    console.error("Error sending feature message:", error);
    const msg =
      error instanceof Error ? error.message : "Could not send message";
    return mcpError(`Error: ${msg}`);
  }
}
