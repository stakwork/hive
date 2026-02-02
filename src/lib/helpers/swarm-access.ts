import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";

/**
 * Result of getting workspace swarm with decrypted credentials
 */
export interface WorkspaceSwarmAccess {
  workspaceId: string;
  swarmName: string;
  swarmUrl: string;
  swarmApiKey: string; // Decrypted
  swarmStatus: string;
}

/**
 * Error types for workspace swarm access
 */
export type SwarmAccessError =
  | { type: "WORKSPACE_NOT_FOUND" }
  | { type: "ACCESS_DENIED" }
  | { type: "SWARM_NOT_CONFIGURED" }
  | { type: "SWARM_NOT_ACTIVE"; status: string }
  | { type: "SWARM_NAME_MISSING" }
  | { type: "SWARM_API_KEY_MISSING" };

/**
 * Result type for workspace swarm access
 */
export type SwarmAccessResult =
  | { success: true; data: WorkspaceSwarmAccess }
  | { success: false; error: SwarmAccessError };

/**
 * Gets workspace swarm configuration with decrypted API key
 * Validates workspace access and swarm configuration
 * 
 * @param slug - Workspace slug
 * @param userId - User ID requesting access
 * @returns Result with swarm access data or error
 */
export async function getWorkspaceSwarmAccess(
  slug: string,
  userId: string,
): Promise<SwarmAccessResult> {
  // Check if workspace exists first
  const workspaceExists = await db.workspace.findFirst({
    where: {
      slug,
      deleted: false,
    },
    select: {
      id: true,
      ownerId: true,
    },
  });

  if (!workspaceExists) {
    return {
      success: false,
      error: { type: "WORKSPACE_NOT_FOUND" },
    };
  }

  // Check if user has access (owner or member)
  const isOwner = workspaceExists.ownerId === userId;
  const isMember = !isOwner
    ? await db.workspaceMember.findFirst({
        where: {
          workspaceId: workspaceExists.id,
          userId,
          leftAt: null,
        },
      })
    : null;

  if (!isOwner && !isMember) {
    return {
      success: false,
      error: { type: "ACCESS_DENIED" },
    };
  }

  // Fetch swarm configuration
  const swarm = await db.swarm.findUnique({
    where: { workspaceId: workspaceExists.id },
    select: {
      name: true,
      status: true,
      swarmUrl: true,
      swarmApiKey: true,
    },
  });

  if (!swarm) {
    return {
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    };
  }

  if (swarm.status !== "ACTIVE") {
    return {
      success: false,
      error: { type: "SWARM_NOT_ACTIVE", status: swarm.status },
    };
  }

  if (!swarm.name || swarm.name.trim() === "") {
    return {
      success: false,
      error: { type: "SWARM_NAME_MISSING" },
    };
  }

  if (!swarm.swarmApiKey) {
    return {
      success: false,
      error: { type: "SWARM_API_KEY_MISSING" },
    };
  }

  if (!swarm.swarmUrl) {
    return {
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    };
  }

  // Decrypt the API key
  const encryptionService = EncryptionService.getInstance();
  const decryptedApiKey = encryptionService.decryptField(
    "swarmApiKey",
    swarm.swarmApiKey,
  );

  return {
    success: true,
    data: {
      workspaceId: workspaceExists.id,
      swarmName: swarm.name,
      swarmUrl: swarm.swarmUrl,
      swarmApiKey: decryptedApiKey,
      swarmStatus: swarm.status,
    },
  };
}

/**
 * Gets workspace swarm configuration by workspace ID (for internal use)
 * Does not validate user access - caller must ensure authorization
 *
 * @param workspaceId - Workspace ID
 * @returns Result with swarm access data or error
 */
export async function getSwarmAccessByWorkspaceId(
  workspaceId: string,
): Promise<SwarmAccessResult> {
  const swarm = await db.swarm.findUnique({
    where: { workspaceId },
    select: {
      name: true,
      status: true,
      swarmUrl: true,
      swarmApiKey: true,
    },
  });

  if (!swarm) {
    console.log("[SwarmAccess] No swarm found for workspaceId:", workspaceId);
    return { success: false, error: { type: "SWARM_NOT_CONFIGURED" } };
  }

  if (swarm.status !== "ACTIVE") {
    console.log("[SwarmAccess] Swarm not active, status:", swarm.status);
    return {
      success: false,
      error: { type: "SWARM_NOT_ACTIVE", status: swarm.status },
    };
  }

  if (!swarm.swarmUrl) {
    console.log("[SwarmAccess] Missing swarmUrl");
    return { success: false, error: { type: "SWARM_NOT_CONFIGURED" } };
  }

  // swarmApiKey is optional (may not be needed for local dev)
  let decryptedApiKey = "";
  if (swarm.swarmApiKey) {
    const encryptionService = EncryptionService.getInstance();
    decryptedApiKey = encryptionService.decryptField(
      "swarmApiKey",
      swarm.swarmApiKey,
    );
  }

  // Build the swarm URL with correct port
  const swarmUrlObj = new URL(swarm.swarmUrl);
  let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
  if (swarm.swarmUrl.includes("localhost")) {
    baseSwarmUrl = `http://localhost:3355`;
  }

  return {
    success: true,
    data: {
      workspaceId,
      swarmName: swarm.name || "",
      swarmUrl: baseSwarmUrl,
      swarmApiKey: decryptedApiKey,
      swarmStatus: swarm.status,
    },
  };
}
