import { db } from "@/lib/db";
import { ScorerDashboard } from "./ScorerDashboard";

export default async function ScorerPage() {
  const workspaces = await db.workspace.findMany({
    where: { deleted: false },
    select: {
      id: true,
      name: true,
      slug: true,
      scorerEnabled: true,
      scorerPatternPrompt: true,
      scorerSinglePrompt: true,
    },
    orderBy: { name: "asc" },
  });

  return <ScorerDashboard workspaces={workspaces} />;
}
