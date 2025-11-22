import { db } from "@/lib/db";
import type { User, Workspace, Swarm } from "@prisma/client";
import { createTestWorkspaceScenario } from "./workspace";
import { generateUniqueId } from "@/__tests__/support/helpers";

export interface LearningsTestScenario {
  owner: User;
  workspace: Workspace;
  swarm: Swarm;
  memberViewer: User;
  memberDeveloper: User;
  memberAdmin: User;
  nonMember: User;
}

export interface CreateLearningsTestScenarioOptions {
  ownerName?: string;
  swarmUrlSuffix?: string;
}

/**
 * Creates a complete test scenario for learnings API tests with:
 * - Owner user
 * - Workspace with members (VIEWER, DEVELOPER, ADMIN roles)
 * - Swarm with encrypted API key
 * - Non-member user for access control tests
 */
export async function createLearningsTestScenario(
  options: CreateLearningsTestScenarioOptions = {}
): Promise<LearningsTestScenario> {
  const { ownerName = "Learnings Owner", swarmUrlSuffix = "" } = options;

  return await db.$transaction(async (tx) => {
    const scenario = await createTestWorkspaceScenario({
      owner: { name: ownerName },
      members: [
        { role: "VIEWER" },
        { role: "DEVELOPER" },
        { role: "ADMIN" },
      ],
      withSwarm: true,
      swarm: {
        swarmUrl: `https://test-swarm${swarmUrlSuffix}.sphinx.chat`,
        swarmApiKey: `test-swarm-api-key${swarmUrlSuffix}`,
      },
    });

    // Create non-member user
    const nonMemberData = await tx.user.create({
      data: {
        name: `Non Member User${swarmUrlSuffix}`,
        email: `non-member-${generateUniqueId("user")}@example.com`,
      },
    });

    return {
      owner: scenario.owner,
      workspace: scenario.workspace,
      swarm: scenario.swarm!,
      memberViewer: scenario.members[0],
      memberDeveloper: scenario.members[1],
      memberAdmin: scenario.members[2],
      nonMember: nonMemberData,
    };
  });
}

/**
 * Helper to wait for async callbacks in fire-and-forget tests.
 * Uses process.nextTick and microtask queue draining instead of setTimeout.
 */
export async function waitForAsyncCallbacks(): Promise<void> {
  // Drain microtask queue
  await Promise.resolve();
  // Drain next tick queue
  await new Promise((resolve) => process.nextTick(resolve));
  // One more microtask drain to catch any nested promises
  await Promise.resolve();
}
