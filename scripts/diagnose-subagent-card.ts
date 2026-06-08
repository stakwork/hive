/**
 * Diagnose why a canvas-chat <SubAgentRunCard> isn't showing after a
 * feature proposal was approved.
 *
 * Determines which of the two layers is failing:
 *   1. DATA layer — did the planner message actually fan out into the
 *      org-canvas conversation? (requires Feature.parentCanvasConversationId
 *      to have been stamped at approval)
 *   2. RENDER layer — the message IS in the conversation but the prod UI
 *      hid the card (the `return null` bug fixed in this branch).
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/diagnose-subagent-card.ts <githubLogin>
 *
 * Prints, for the org's most recent canvas conversations + recently
 * created features, whether the stamp and the planner-source row exist.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  let githubLogin = process.argv[2];

  // Auto-discover: if no login is passed, find the org that owns the
  // most recently active org-canvas conversation. Read-only.
  if (!githubLogin) {
    const recent = await prisma.sharedConversation.findFirst({
      where: { source: "org-canvas", sourceControlOrgId: { not: null } },
      orderBy: { lastMessageAt: "desc" },
      select: { sourceControlOrg: { select: { githubLogin: true } } },
    });
    githubLogin = recent?.sourceControlOrg?.githubLogin ?? "";
    if (!githubLogin) {
      console.error(
        "No org-canvas conversations found. Pass a githubLogin explicitly:\n" +
          "  npx tsx scripts/diagnose-subagent-card.ts <githubLogin>",
      );
      process.exit(1);
    }
    console.log(`(auto-discovered most recently active org: ${githubLogin})\n`);
  }

  const org = await prisma.sourceControlOrg.findUnique({
    where: { githubLogin },
    select: { id: true, githubLogin: true },
  });
  if (!org) {
    console.error(`No SourceControlOrg for githubLogin="${githubLogin}"`);
    process.exit(1);
  }
  console.log(`Org: ${org.githubLogin} (${org.id})\n`);

  // ── Recent features that should own a canvas conversation ──────────
  const features = await prisma.feature.findMany({
    where: { workspace: { sourceControlOrgId: org.id } },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      title: true,
      createdAt: true,
      workflowStatus: true,
      parentCanvasConversationId: true,
    },
  });

  console.log("=== Recent features ===");
  for (const f of features) {
    const stamp = f.parentCanvasConversationId
      ? `stamped → ${f.parentCanvasConversationId}`
      : "❌ NO parentCanvasConversationId (will NOT fan out)";
    console.log(
      `- ${f.title}  [${f.id}]  ${f.workflowStatus}  ${f.createdAt.toISOString()}\n    ${stamp}`,
    );
  }

  // ── Recent org-canvas conversations + planner-row presence ─────────
  const convos = await prisma.sharedConversation.findMany({
    where: { sourceControlOrgId: org.id, source: "org-canvas" },
    orderBy: { lastMessageAt: "desc" },
    take: 10,
    select: { id: true, title: true, lastMessageAt: true, messages: true },
  });

  console.log("\n=== Recent org-canvas conversations ===");
  for (const c of convos) {
    const msgs = Array.isArray(c.messages) ? (c.messages as any[]) : [];
    const plannerRows = msgs.filter(
      (m) => m && typeof m === "object" && m.source?.kind === "planner",
    );
    const formRows = plannerRows.filter((m) => m.source?.hasForm);
    const verdict =
      plannerRows.length > 0
        ? `✅ ${plannerRows.length} planner row(s)${
            formRows.length ? `, ${formRows.length} with a FORM` : ""
          } → RENDER layer (deploy the SidebarChat fix)`
        : "❌ no planner rows → DATA layer (fan-out never happened / stamp missing)";
    console.log(
      `- "${c.title}"  [${c.id}]  ${msgs.length} msgs  ${
        c.lastMessageAt?.toISOString() ?? "—"
      }\n    ${verdict}`,
    );
  }

  console.log(
    "\nInterpretation:\n" +
      "  • Feature stamped + conversation has a planner row → it's the RENDER bug; this branch fixes it.\n" +
      "  • Feature NOT stamped → approval didn't pass/validate the conversation id\n" +
      "    (approved before the stamp fix deployed, serverConversationId was null,\n" +
      "     or orgId != sourceControlOrgId). No render fix can help until the stamp lands.",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
