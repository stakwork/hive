import { expect } from "vitest";
import { db } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/auth/roles";

/**
 * Assert that a workspace exists in the database
 * @param workspaceId - Workspace ID to check
 */
export async function expectWorkspaceExists(workspaceId: string): Promise<void> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
  });
  expect(workspace).toBeTruthy();
  expect(workspace?.deleted).toBeFalsy();
}

/**
 * Assert that a workspace is soft-deleted
 * @param workspaceId - Workspace ID to check
 */
export async function expectWorkspaceDeleted(workspaceId: string): Promise<void> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
  });
  expect(workspace).toBeTruthy();
  expect(workspace?.deleted).toBe(true);
  expect(workspace?.deletedAt).toBeTruthy();
}

/**
 * Assert that a workspace does not exist in the database
 * @param workspaceId - Workspace ID to check
 */
export async function expectWorkspaceNotExists(workspaceId: string): Promise<void> {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
  });
  expect(workspace).toBeNull();
}

/**
 * Assert the number of active members in a workspace
 * @param workspaceId - Workspace ID to check
 * @param expectedCount - Expected number of active members
 */
export async function expectMemberCount(
  workspaceId: string,
  expectedCount: number
): Promise<void> {
  const members = await db.workspaceMember.findMany({
    where: { workspaceId, leftAt: null },
  });
  expect(members).toHaveLength(expectedCount);
}

/**
 * Assert that a user has a specific role in a workspace
 * @param workspaceId - Workspace ID to check
 * @param userId - User ID to check
 * @param expectedRole - Expected workspace role
 */
export async function expectMemberRole(
  workspaceId: string,
  userId: string,
  expectedRole: WorkspaceRole
): Promise<void> {
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId, userId, leftAt: null },
  });
  expect(member).toBeTruthy();
  expect(member?.role).toBe(expectedRole);
}

/**
 * Assert that a user is not a member of a workspace
 * @param workspaceId - Workspace ID to check
 * @param userId - User ID to check
 */
export async function expectMemberNotExists(
  workspaceId: string,
  userId: string
): Promise<void> {
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId, userId, leftAt: null },
  });
  expect(member).toBeNull();
}

/**
 * Assert that a user exists in a workspace (regardless of active status)
 * @param workspaceId - Workspace ID to check
 * @param userId - User ID to check
 */
export async function expectMemberExists(
  workspaceId: string,
  userId: string
): Promise<void> {
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId, userId },
  });
  expect(member).toBeTruthy();
}

/**
 * Assert that a member has left a workspace (leftAt is set)
 * @param workspaceId - Workspace ID to check
 * @param userId - User ID to check
 */
export async function expectMemberLeft(
  workspaceId: string,
  userId: string
): Promise<void> {
  const member = await db.workspaceMember.findFirst({
    where: { workspaceId, userId },
  });
  expect(member).toBeTruthy();
  expect(member?.leftAt).toBeTruthy();
}

/**
 * Assert that a user exists in the database
 * @param userId - User ID to check
 */
export async function expectUserExists(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
  });
  expect(user).toBeTruthy();
}

/**
 * Assert that a user does not exist in the database
 * @param userId - User ID to check
 */
export async function expectUserNotExists(userId: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
  });
  expect(user).toBeNull();
}

/**
 * Assert that a repository has a specific status
 * @param workspaceId - Workspace ID
 * @param repositoryUrl - Repository URL
 * @param expectedStatus - Expected repository status
 */
export async function expectRepositoryStatus(
  workspaceId: string,
  repositoryUrl: string,
  expectedStatus: string
): Promise<void> {
  const repository = await db.repository.findUnique({
    where: {
      repositoryUrl_workspaceId: {
        repositoryUrl,
        workspaceId,
      },
    },
  });
  expect(repository).toBeTruthy();
  expect(repository?.status).toBe(expectedStatus);
}