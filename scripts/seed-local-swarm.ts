/**
 * Seed a local mock user + org + workspace + swarm wired for hive-relay.
 *
 * Mock login already creates the whole chain (via ensureMockWorkspaceForUser)
 * but leaves the swarm WITHOUT a `swarmApiKey` and the org WITHOUT a
 * `defaultWorkspaceId`. This script fills both so the relay-token flow works:
 *   - sets a known `swarmApiKey` (encrypted) + a localhost `swarmUrl`, and
 *   - makes the workspace the org's default (the Org Canvas resolves its
 *     swarm via org -> defaultWorkspace -> swarm).
 *
 * Run:
 *   npx dotenv -e .env.local -- npx tsx scripts/seed-local-swarm.ts
 * Optional overrides:
 *   SEED_USERNAME=dev  SEED_SWARM_API_KEY=<hex>
 *
 * Then start hive-relay with the printed SWARM_API_KEY. Idempotent.
 */
// Relative imports (matching the other scripts) so the editor resolves them;
// the `@/` aliases inside these modules still resolve at runtime under tsx.
import { WorkspaceRole } from "@prisma/client";
import { db } from "../src/lib/db";
import { ensureMockWorkspaceForUser } from "../src/utils/mockSetup";
import { saveOrUpdateSwarm } from "../src/services/swarm/db";

const USERNAME = process.env.SEED_USERNAME ?? "dev";
// A second member of the SAME org, so you can log in as two different users
// (in two browsers) and see each other's cursors on /org/<owner>.
const SECOND_USERNAME = process.env.SEED_SECOND_USERNAME ?? "dev2";
// Stable default so re-running the seed doesn't change the key (you set the
// relay's SWARM_API_KEY once). Override with SEED_SWARM_API_KEY for a custom one.
const SWARM_API_KEY = process.env.SEED_SWARM_API_KEY ?? "local-dev-swarm-key";

async function main() {
  const userId = `mock-${USERNAME}`;

  // 1. The mock user (mock login creates this on sign-in; we do it up-front
  //    so the seed is runnable before any login).
  await db.user.upsert({
    where: { id: userId },
    update: {},
    create: { id: userId, name: USERNAME, email: `${USERNAME}@mock.dev` },
  });

  // 2. Org + workspace + repository + swarm (the real mock setup). Idempotent:
  //    returns early if the user already has a workspace.
  const slug = await ensureMockWorkspaceForUser(userId);
  const workspace = await db.workspace.findUnique({
    where: { slug },
    select: { id: true, sourceControlOrgId: true },
  });
  if (!workspace) throw new Error(`workspace not found for slug ${slug}`);

  // 3. Set a known swarmApiKey (encrypted by saveOrUpdateSwarm) + a localhost
  //    swarmUrl so getRelayUrl() -> http://localhost:3333.
  await saveOrUpdateSwarm({
    workspaceId: workspace.id,
    swarmApiKey: SWARM_API_KEY,
    swarmUrl: "http://localhost/api",
  });

  // 4. Make this workspace the org's default so the Org Canvas can resolve the
  //    swarm (org -> defaultWorkspace -> swarm).
  let orgLogin = "(no org linked)";
  if (workspace.sourceControlOrgId) {
    const org = await db.sourceControlOrg.update({
      where: { id: workspace.sourceControlOrgId },
      data: { defaultWorkspaceId: workspace.id },
      select: { githubLogin: true },
    });
    orgLogin = org.githubLogin;
  }

  // 5. A second user, added as a member of the same workspace → both belong to
  //    the org, so 2-user presence works on /org/<owner>.
  const secondId = `mock-${SECOND_USERNAME}`;
  await db.user.upsert({
    where: { id: secondId },
    update: {},
    create: {
      id: secondId,
      name: SECOND_USERNAME,
      email: `${SECOND_USERNAME}@mock.dev`,
    },
  });
  await db.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: secondId } },
    update: { role: WorkspaceRole.DEVELOPER, leftAt: null },
    create: {
      workspaceId: workspace.id,
      userId: secondId,
      role: WorkspaceRole.DEVELOPER,
    },
  });

  console.log("\n✅ Local swarm ready for hive-relay\n");
  console.log("  mock logins          :", USERNAME, "(owner) &", SECOND_USERNAME, "(member)");
  console.log("  workspace slug       :", slug);
  console.log("  org (githubLogin)    :", orgLogin, " -> /org/" + orgLogin);
  console.log("  SWARM_API_KEY        :", SWARM_API_KEY);
  console.log("\n  Start hive-relay with:");
  console.log(
    `    SWARM_API_KEY=${SWARM_API_KEY} CORS_ORIGIN=http://localhost:3000 PORT=3333 npm run dev`,
  );
  console.log("");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
