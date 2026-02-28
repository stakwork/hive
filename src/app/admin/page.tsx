import { db } from "@/lib/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Link from "next/link";
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
          swarmPassword: true,
        },
      },
    },
  });

  // Transform workspaces to include hasSwarmPassword boolean
  const workspacesWithFlags = workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    logoKey: workspace.logoKey,
    createdAt: workspace.createdAt,
    owner: workspace.owner,
    hasSwarmPassword: !!workspace.swarm?.swarmPassword,
    _count: workspace._count,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Admin Dashboard</h2>
        <p className="text-muted-foreground">
          Platform-wide workspace management and user administration
        </p>
        <Link
          href="/admin/users"
          className="text-sm font-medium text-primary hover:underline"
        >
          Manage Superadmin Users →
        </Link>
      </div>

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
