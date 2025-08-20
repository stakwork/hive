import { db } from "@/lib/db";
import { JanitorType, JanitorStatus, RecommendationStatus, Priority } from "@prisma/client";

export async function ensureJanitorConfig(workspaceId: string) {
  let config = await db.janitorConfig.findUnique({
    where: { workspaceId }
  });

  if (!config) {
    config = await db.janitorConfig.create({
      data: { workspaceId }
    });
  }

  return config;
}

export async function isJanitorEnabled(
  workspaceId: string, 
  janitorType: JanitorType
): Promise<boolean> {
  const config = await ensureJanitorConfig(workspaceId);
  
  switch (janitorType) {
    case "UNIT_TESTS":
      return config.unitTestsEnabled;
    case "INTEGRATION_TESTS":
      return config.integrationTestsEnabled;
    default:
      return false;
  }
}

export async function hasRunningJanitor(
  configId: string, 
  janitorType: JanitorType
): Promise<boolean> {
  const runningJanitor = await db.janitorRun.findFirst({
    where: {
      janitorConfigId: configId,
      janitorType,
      status: { in: ["PENDING", "RUNNING"] }
    }
  });

  return !!runningJanitor;
}

export function mapPriorityFromString(priority: string): Priority {
  const priorityUpper = priority.toUpperCase();
  
  if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priorityUpper)) {
    return priorityUpper as Priority;
  }
  
  return "MEDIUM";
}

export function isValidJanitorType(type: string): type is JanitorType {
  return ["UNIT_TESTS", "INTEGRATION_TESTS"].includes(type.toUpperCase());
}

export function isValidJanitorStatus(status: string): status is JanitorStatus {
  return ["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"].includes(status.toUpperCase());
}

export function isValidRecommendationStatus(status: string): status is RecommendationStatus {
  return ["PENDING", "ACCEPTED", "DISMISSED"].includes(status.toUpperCase());
}

export function isValidPriority(priority: string): priority is Priority {
  return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(priority.toUpperCase());
}

export function formatJanitorTypeName(type: JanitorType): string {
  return type.toLowerCase().replace('_', ' ');
}

export function formatJanitorStatusName(status: JanitorStatus): string {
  return status.toLowerCase();
}

export async function getWorkspaceBySlugWithPermission(
  slug: string, 
  userId: string, 
  requiredRoles: string[] = []
) {
  const where: any = {
    slug,
    members: {
      some: { userId }
    }
  };

  if (requiredRoles.length > 0) {
    where.members.some.role = { in: requiredRoles };
  }

  return await db.workspace.findFirst({
    where,
    include: {
      janitorConfig: true,
      members: {
        where: { userId },
        select: { role: true }
      }
    }
  });
}

export async function validateWorkspaceMember(
  workspaceId: string, 
  userId: string
): Promise<boolean> {
  const member = await db.workspaceMember.findFirst({
    where: {
      workspaceId,
      userId
    }
  });

  return !!member;
}

export async function validateWorkspaceRepository(
  workspaceId: string, 
  repositoryId: string
): Promise<boolean> {
  const repository = await db.repository.findFirst({
    where: {
      id: repositoryId,
      workspaceId
    }
  });

  return !!repository;
}