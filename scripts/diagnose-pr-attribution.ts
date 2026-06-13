/**
 * Diagnose why a feature's tasks open PRs as the WORKSPACE OWNER instead
 * of the person who created/approved the feature.
 *
 * Background (the attribution chain):
 *   1. Approving a feature proposal stamps  Feature.createdById = approver
 *      (src/lib/proposals/handleApproval.ts → createFeature).
 *   2. Planner-generated tasks inherit it:  Task.createdById = feature.createdById
 *      (src/services/stakwork-run.ts:applyAcceptResult).
 *   3. The task-coordinator sweep dispatches with
 *        userId = task.createdById ?? task.feature?.createdById
 *      (src/services/task-coordinator-cron.ts).
 *   4. That userId's GitHub token authors the PR, resolved via
 *      getGithubUsernameAndPAT(userId, slug)  (src/lib/auth/nextauth.ts).
 *
 * THE FAILURE: getGithubUsernameAndPAT returns NULL when the user has no
 * per-org SourceControlToken (they never authorized the org's GitHub App,
 * or it was revoked/expired). With a null token the agent falls back to the
 * pod's baked-in credentials — which are ALWAYS the workspace owner's PAT
 * (src/services/pool-manager/sync.ts:230). Result: PR shows as the owner.
 *
 * This script reports, per feature: the creator, whether the creator has a
 * usable org token, the owner (the fallback author), and the RESOLVED PR
 * author — i.e. who GitHub will actually attribute the PR to.
 *
 * Read-only. Does not decrypt or print any tokens — only presence.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/diagnose-pr-attribution.ts <featureId>
 *   DATABASE_URL=... npx tsx scripts/diagnose-pr-attribution.ts --org <githubLogin>
 *   DATABASE_URL=... npx tsx scripts/diagnose-pr-attribution.ts            (auto-discover most recent org)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface UserTokenStatus {
  userId: string;
  label: string; // "name <username>" for display
  hasGithubAuth: boolean;
  githubUsername: string | null;
  hasOrgToken: boolean;
  orgTokenExpired: boolean;
}

/**
 * Mirror getGithubUsernameAndPAT's token-resolution preconditions
 * (src/lib/auth/nextauth.ts) WITHOUT decrypting anything. The function
 * returns null (→ owner fallback) unless: GitHubAuth exists with a
 * non-empty username AND a SourceControlToken row exists for the org.
 */
async function resolveUserTokenStatus(
  userId: string,
  sourceControlOrgId: string | null,
): Promise<UserTokenStatus> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  const githubAuth = await prisma.gitHubAuth.findUnique({
    where: { userId },
    select: { githubUsername: true },
  });
  const githubUsername = githubAuth?.githubUsername?.trim() || null;

  let hasOrgToken = false;
  let orgTokenExpired = false;
  if (sourceControlOrgId) {
    const tok = await prisma.sourceControlToken.findUnique({
      where: { userId_sourceControlOrgId: { userId, sourceControlOrgId } },
      select: { token: true, expiresAt: true },
    });
    hasOrgToken = !!tok?.token;
    orgTokenExpired = !!tok?.expiresAt && tok.expiresAt.getTime() < Date.now();
  }

  const display = user?.name || user?.email || userId;
  return {
    userId,
    label: `${display}${githubUsername ? ` <${githubUsername}>` : ""}`,
    hasGithubAuth: !!githubAuth,
    githubUsername,
    hasOrgToken,
    orgTokenExpired,
  };
}

/** Would getGithubUsernameAndPAT(userId, slug) return a token? */
function tokenResolves(s: UserTokenStatus): boolean {
  return !!s.githubUsername && s.hasOrgToken;
}

function statusLine(s: UserTokenStatus): string {
  if (!s.hasGithubAuth) return "❌ no GitHubAuth record";
  if (!s.githubUsername) return "❌ empty GitHub username";
  if (!s.hasOrgToken) return "❌ NO org SourceControlToken (→ owner fallback)";
  if (s.orgTokenExpired) return "⚠️  org token present but EXPIRED";
  return "✅ has usable org token";
}

async function diagnoseFeature(featureId: string): Promise<void> {
  const feature = await prisma.feature.findUnique({
    where: { id: featureId },
    select: {
      id: true,
      title: true,
      createdById: true,
      workspace: {
        select: { slug: true, ownerId: true, sourceControlOrgId: true },
      },
    },
  });
  if (!feature) {
    console.log(`\n❓ Feature ${featureId} not found`);
    return;
  }

  const orgId = feature.workspace.sourceControlOrgId;
  const ownerId = feature.workspace.ownerId;

  const creator = await resolveUserTokenStatus(feature.createdById, orgId);
  const owner = await resolveUserTokenStatus(ownerId, orgId);

  console.log(`\n━━ Feature: "${feature.title}"  [${feature.id}]`);
  console.log(`   workspace=${feature.workspace.slug}  org=${orgId ?? "—"}`);
  console.log(`   creator: ${creator.label}`);
  console.log(`            ${statusLine(creator)}`);
  console.log(`   owner  : ${owner.label}  (pod's baked-in fallback)`);

  const creatorResolves = tokenResolves(creator);
  if (creatorResolves) {
    console.log(`   ⇒ Feature-level PRs attributed to CREATOR (${creator.githubUsername}) ✅`);
  } else {
    console.log(
      `   ⇒ Feature-level PRs FALL BACK to OWNER (${owner.githubUsername ?? owner.label}) ❌`,
    );
  }

  // Tasks carry their own createdById — usually == feature.createdById, but
  // verify per-task since the sweep resolves the token from the task.
  const tasks = await prisma.task.findMany({
    where: { featureId: feature.id, deleted: false },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      title: true,
      status: true,
      workflowStatus: true,
      systemAssigneeType: true,
      createdById: true,
    },
  });

  if (tasks.length === 0) {
    console.log("   (no tasks yet)");
    return;
  }

  // Cache token lookups per distinct createdById.
  const cache = new Map<string, UserTokenStatus>();
  const getStatus = async (uid: string) => {
    if (!cache.has(uid)) cache.set(uid, await resolveUserTokenStatus(uid, orgId));
    return cache.get(uid)!;
  };

  console.log(`   tasks (${tasks.length}):`);
  for (const t of tasks) {
    const s = await getStatus(t.createdById);
    const resolves = tokenResolves(s);
    const author = resolves
      ? s.githubUsername
      : `${owner.githubUsername ?? "OWNER"} (fallback)`;
    const flag = resolves ? "✅" : "❌";
    const diff = t.createdById !== feature.createdById ? " [createdById ≠ feature]" : "";
    console.log(
      `     ${flag} ${t.title.slice(0, 48).padEnd(48)} ${t.status}/${t.workflowStatus ?? "—"}` +
        `  PR→ ${author}${diff}`,
    );
  }
}

async function main() {
  const args = process.argv.slice(2);
  let featureId: string | null = null;
  let githubLogin: string | null = null;

  const orgFlagIdx = args.indexOf("--org");
  if (orgFlagIdx !== -1) {
    githubLogin = args[orgFlagIdx + 1] ?? null;
  } else if (args[0]) {
    featureId = args[0];
  }

  if (featureId) {
    await diagnoseFeature(featureId);
    return;
  }

  // Org mode: auto-discover if needed, then scan recent features.
  if (!githubLogin) {
    const recent = await prisma.sharedConversation.findFirst({
      where: { source: "org-canvas", sourceControlOrgId: { not: null } },
      orderBy: { lastMessageAt: "desc" },
      select: { sourceControlOrg: { select: { githubLogin: true } } },
    });
    githubLogin = recent?.sourceControlOrg?.githubLogin ?? null;
    if (!githubLogin) {
      console.error(
        "No org-canvas conversations found. Pass a feature id or --org <githubLogin>.",
      );
      process.exit(1);
    }
    console.log(`(auto-discovered most recently active org: ${githubLogin})`);
  }

  const org = await prisma.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true, githubLogin: true },
  });
  if (!org) {
    console.error(`No SourceControlOrg for githubLogin="${githubLogin}"`);
    process.exit(1);
  }
  console.log(`Org: ${org.githubLogin} (${org.id})`);

  const features = await prisma.feature.findMany({
    where: { workspace: { sourceControlOrgId: org.id } },
    orderBy: { createdAt: "desc" },
    take: 15,
    select: { id: true },
  });
  if (features.length === 0) {
    console.log("No features in this org.");
    return;
  }
  for (const f of features) {
    await diagnoseFeature(f.id);
  }

  console.log(
    "\nLegend:\n" +
      "  ✅ creator has a usable per-org GitHub token → PR attributed to them.\n" +
      "  ❌ creator lacks the org token → PR falls back to the workspace owner\n" +
      "     (the pod is always provisioned with the owner's PAT).\n" +
      "  Fix: have the affected creator authorize the org's GitHub App\n" +
      "       (so a SourceControlToken row exists for that org).",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
