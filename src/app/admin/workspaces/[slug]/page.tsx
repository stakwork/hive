import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CopySwarmPasswordButton from "./CopySwarmPasswordButton";
import AdminJanitorToggles from "./AdminJanitorToggles";

export default async function AdminWorkspaceDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const workspace = await db.workspace.findFirst({
    where: {
      slug,
      deleted: false,
    },
    select: {
      id: true,
      name: true,
      slug: true,
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
            where: {
              leftAt: null,
            },
          },
          tasks: true,
        },
      },
      swarm: {
        select: {
          status: true,
          swarmUrl: true,
          ec2Id: true,
          instanceType: true,
          poolState: true,
          podState: true,
          swarmPassword: true,
        },
      },
    },
  });

  if (!workspace) {
    notFound();
  }

  const hasPassword = !!workspace.swarm?.swarmPassword;
  const workspaceId = workspace.id;

  return (
    <div className="container mx-auto py-8 space-y-6">
      <Link
        href="/admin"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Admin
      </Link>

      <div className="space-y-6">
        {/* Workspace Info */}
        <Card>
          <CardHeader>
            <CardTitle>Workspace Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="font-medium">{workspace.name}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Slug</p>
                <p className="font-medium">{workspace.slug}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Owner</p>
                <p className="font-medium">
                  {workspace.owner.name || workspace.owner.email}
                </p>
                {workspace.owner.name && (
                  <p className="text-sm text-muted-foreground">
                    {workspace.owner.email}
                  </p>
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Created</p>
                <p className="font-medium">
                  {new Date(workspace.createdAt).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Members</p>
                <p className="font-medium">{workspace._count.members}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tasks</p>
                <p className="font-medium">{workspace._count.tasks}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Swarm Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Swarm Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <p className="font-medium">{workspace.swarm?.status || "N/A"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">URL</p>
                <p className="font-medium break-all">
                  {workspace.swarm?.swarmUrl || "N/A"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">EC2 ID</p>
                <p className="font-medium">{workspace.swarm?.ec2Id || "N/A"}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Instance Type</p>
                <p className="font-medium">
                  {workspace.swarm?.instanceType || "N/A"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pool State</p>
                <p className="font-medium">
                  {workspace.swarm?.poolState || "N/A"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Pod State</p>
                <p className="font-medium">{workspace.swarm?.podState || "N/A"}</p>
              </div>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-2">Password</p>
              <CopySwarmPasswordButton
                workspaceId={workspaceId}
                hasPassword={hasPassword}
              />
            </div>
          </CardContent>
        </Card>

        {/* Janitor Configuration */}
        <Card>
          <CardHeader>
            <CardTitle>Janitor Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminJanitorToggles workspaceId={workspaceId} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
