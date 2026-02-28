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
    swarm: workspace.swarm
      ? {
          _count: workspace.swarm._count,
        }
      : null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Admin Dashboard</h2>
        <p className="text-muted-foreground">
          Platform-wide workspace management and user administration
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Total Workspaces</CardTitle>
            <CardDescription>Active workspaces on the platform</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-bold">{workspaces.length}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Administrative tools</CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/admin/users"
              className="text-sm font-medium text-primary hover:underline"
            >
              Manage Superadmin Users →
            </Link>
          </CardContent>
        </Card>
      </div>

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
