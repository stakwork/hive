import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import CopySwarmPasswordButton from "./CopySwarmPasswordButton";
import AdminJanitorToggles from "./AdminJanitorToggles";
import WorkspacePRStats from "./WorkspacePRStats";
import AdminPodScaleControl from "./AdminPodScaleControl";

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
          minimumVms: true,
          poolApiKey: true,
        },
      },
    },
  });

  if (!workspace) {
    notFound();
  }

  const hasPassword = !!workspace.swarm?.swarmPassword;
  const workspaceId = workspace.id;

  const ec2Alert = workspace.swarm?.ec2Id
    ? await db.ec2Alert.findUnique({ where: { instanceId: workspace.swarm.ec2Id } })
    : null;

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
            {workspace.swarm?.poolState === "COMPLETE" && !!workspace.swarm?.poolApiKey && (
              <div>
                <p className="text-sm font-medium mb-2">Pod Scaling</p>
                <AdminPodScaleControl
                  slug={slug}
                  initialMinimumVms={workspace.swarm.minimumVms ?? 2}
                />
              </div>
            )}
            <div>
              <p className="text-sm text-muted-foreground mb-2">Password</p>
              <CopySwarmPasswordButton
                workspaceId={workspaceId}
                hasPassword={hasPassword}
              />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">CPU Alert Status</p>
              {ec2Alert ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">CPU Alarm State</p>
                    <Badge
                      className={
                        ec2Alert.alarmState === "ALARM"
                          ? "bg-red-50 text-red-700 border-red-200"
                          : ec2Alert.alarmState === "OK"
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-gray-100 text-gray-700 border-gray-200"
                      }
                      variant="outline"
                    >
                      {ec2Alert.alarmState}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Alarm Type</p>
                    <p className="font-medium">{ec2Alert.alarmType}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">Reason</p>
                    <p className="font-medium text-sm">{ec2Alert.stateReason}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm text-muted-foreground">Last Changed</p>
                    <p className="font-medium">{new Date(ec2Alert.triggeredAt).toLocaleString()}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No CPU alerts received</p>
              )}
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

        {/* PR Statistics */}
        <Card>
          <CardHeader>
            <CardTitle>PR Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <WorkspacePRStats workspaceId={workspaceId} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
