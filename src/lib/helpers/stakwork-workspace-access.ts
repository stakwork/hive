import { db } from "@/lib/db";

/**
 * Looks up whether the given user owns, or is an active member (`leftAt:
 * null`) of, a workspace matching one of `slugs` (default: `["stakwork"]`).
 *
 * Used to gate access to internal workflow prompts/scripts. Callers keep
 * their own error responses and dev-mode handling; this helper only runs
 * the DB lookup.
 */
export async function findStakworkWorkspaceForUser(
  userId: string,
  slugs: readonly string[] = ["stakwork"],
): Promise<{ id: string } | null> {
  return db.workspace.findFirst({
    where: {
      slug: { in: [...slugs] },
      OR: [{ ownerId: userId }, { members: { some: { userId, leftAt: null } } }],
    },
    select: { id: true },
  });
}
