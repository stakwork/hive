import { db } from "@/lib/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WorkspacesTable } from "./components/WorkspacesTable";
import { StatsPanel } from "./components/StatsPanel";

export default async function AdminDashboard() {
  // Fetch all workspaces
  const workspaces = await db.workspace.findMany({
    where: { deleted: false },
    select: {
      id: true,
      name: true,
      slug: true,
      logoKey: true,
      createdAt: true,
      owner: {
        select: {
          name: true,
          email: true,
        },
      },
      _count: {
        select: {
          members: {
            where: { leftAt: null },
          },
          tasks: true,
        },
      },
      swarm: {
        select: {
          _count: {
            select: {
              pods: {
                where: { deletedAt: null },
              },
            },
          },
        },
      },
    },
  });

  // Transform workspaces to simplify structure
  const workspacesWithFlags = workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    logoKey: workspace.logoKey,
    createdAt: workspace.createdAt,
    owner: workspace.owner,
    _count: workspace._count,
    swarm: workspace.swarm
      ? {
          _count: workspace.swarm._count,
        }
      : null,
  }));

  return (
    <div className="space-y-6">
      <StatsPanel />

      <Card>
        <CardHeader>
          <CardTitle>All Workspaces</CardTitle>
          <CardDescription>
            Complete list of workspaces across the platform
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkspacesTable workspaces={workspacesWithFlags} />
        </CardContent>
      </Card>
    </div>
  );
}
