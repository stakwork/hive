import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect } from "next/navigation";
import { getUserWorkspaces } from "@/services/workspace";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Plus, Users, Calendar, Settings } from "lucide-react";
import Link from "next/link";

export default async function WorkspacesPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/auth/signin");
  }

  const userId = (session.user as { id: string }).id;
  const userWorkspaces = await getUserWorkspaces(userId);

  if (userWorkspaces.length === 0) {
    redirect("/onboarding/workspace");
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Choose Your Workspace</h1>
          <p className="text-xl text-muted-foreground">
            Select a workspace to continue, or create a new one
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
          {userWorkspaces.map((workspace) => (
            <Card
              key={workspace.id}
              className="group hover:shadow-lg transition-all duration-200 cursor-pointer relative"
            >
              <Link href={`/w/${workspace.slug}`} className="block">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg mb-2 group-hover:text-blue-600 transition-colors">
                        {workspace.name}
                      </CardTitle>
                      {workspace.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {workspace.description}
                        </p>
                      )}
                    </div>
                    <Badge
                      variant={
                        workspace.userRole === "OWNER" ? "default" : "secondary"
                      }
                    >
                      {workspace.userRole}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex items-center justify-between text-sm text-muted-foreground mb-4">
                    <div className="flex items-center space-x-1">
                      <Users className="w-4 h-4" />
                      <span>
                        {workspace.memberCount} member
                        {workspace.memberCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <Calendar className="w-4 h-4" />
                      <span>
                        Created{" "}
                        {new Date(workspace.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-blue-600 group-hover:text-blue-700">
                      Open workspace
                    </span>
                    <ArrowRight className="w-4 h-4 text-blue-600 group-hover:translate-x-1 transition-transform" />
                  </div>
                </CardContent>
              </Link>

              {workspace.userRole === "OWNER" && (
                <div className="absolute top-4 right-4">
                  <Link
                    href={`/workspaces/${workspace.slug}/settings`}
                    className="p-1 rounded-md hover:bg-muted"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Settings className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                  </Link>
                </div>
              )}
            </Card>
          ))}

          {/* Create New Workspace Card */}
          <Card className="group hover:shadow-lg transition-all duration-200 cursor-pointer border-dashed border-2 border-muted-foreground/25 hover:border-blue-500/50">
            <Link href="/workspaces/new" className="block h-full">
              <CardContent className="flex flex-col items-center justify-center h-full py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-muted group-hover:bg-blue-100 dark:group-hover:bg-blue-900/50 flex items-center justify-center mb-4 transition-colors">
                  <Plus className="w-6 h-6 text-muted-foreground group-hover:text-blue-600 transition-colors" />
                </div>
                <h3 className="font-medium mb-2 group-hover:text-blue-600 transition-colors">
                  Create New Workspace
                </h3>
                <p className="text-sm text-muted-foreground">
                  Start a new project or organization
                </p>
              </CardContent>
            </Link>
          </Card>
        </div>

        <div className="text-center">
          <p className="text-sm text-muted-foreground mb-4">
            Need help managing your workspaces?{" "}
            <Link
              href="/docs/workspaces"
              className="text-blue-600 hover:text-blue-700 underline"
            >
              View documentation
            </Link>
          </p>

          <div className="flex justify-center space-x-4">
            <Button variant="outline" asChild>
              <Link href="/auth/signout">Sign Out</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
