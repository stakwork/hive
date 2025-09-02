import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect } from "next/navigation";
import { getUserWorkspaces } from "@/services/workspace";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Building2, Plus, Users, Calendar, ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import { WORKSPACE_LIMITS } from "@/lib/constants";

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

  // Check if user is at workspace limit
  const isAtLimit = userWorkspaces.length >= WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
              <Building2 className="w-6 h-6 text-primary-foreground" />
            </div>
          </div>
          <h1 className="text-3xl font-bold mb-2">Choose Your Workspace</h1>
          <p className="text-muted-foreground">
            Welcome back, {session.user.name || session.user.email}
          </p>
        </div>

        {/* Workspaces List */}
        <div className="space-y-3 mb-8">
          {userWorkspaces.map((workspace) => (
            <Card key={workspace.id} className="group hover:shadow-md transition-all duration-200">
              <Link href={`/w/${workspace.slug}`} className="block">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    {/* Workspace Icon */}
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary text-primary-foreground">
                      <Building2 className="w-5 h-5" />
                    </div>
                    
                    {/* Workspace Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-lg group-hover:text-primary transition-colors truncate">
                          {workspace.name}
                        </h3>
                        <Badge
                          variant={workspace.userRole === "OWNER" ? "default" : "secondary"}
                          className="text-xs shrink-0"
                        >
                          {workspace.userRole.toLowerCase()}
                        </Badge>
                      </div>
                      
                      {workspace.description && (
                        <p className="text-sm text-muted-foreground line-clamp-1 mb-2">
                          {workspace.description}
                        </p>
                      )}
                      
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          <span>
                            {workspace.memberCount} member{workspace.memberCount !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5" />
                          <span>
                            Created {new Date(workspace.createdAt).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric'
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                    </div>
                  </div>
                </CardContent>
              </Link>
            </Card>
          ))}

          {/* Create New Workspace Card */}
          <Card className={`group transition-all duration-200 border-dashed border-2 ${
            isAtLimit 
              ? 'border-muted-foreground/10 cursor-not-allowed opacity-60' 
              : 'border-muted-foreground/25 hover:border-primary/50 hover:shadow-md cursor-pointer'
          }`}>
            {isAtLimit ? (
              <CardContent className="flex flex-col items-center justify-center h-full py-12 text-center">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                  <Lock className="w-6 h-6 text-muted-foreground" />
                </div>
                <h3 className="font-medium mb-2 text-muted-foreground">
                  Workspace Limit Reached
                </h3>
                <p className="text-sm text-muted-foreground mb-1">
                  You've used all {WORKSPACE_LIMITS.MAX_WORKSPACES_PER_USER} available workspaces
                </p>
                <p className="text-xs text-muted-foreground">
                  Delete a workspace to create a new one
                </p>
              </CardContent>
            ) : (
              <Link href="/onboarding/workspace" className="block">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-10 h-10 rounded-lg border-2 border-dashed border-muted-foreground">
                      <Plus className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-lg mb-1">Create New Workspace</h3>
                      <p className="text-sm text-muted-foreground">
                        Start a new project or organization
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Link>
            )}
          </Card>
        </div>

        <Separator className="mb-6" />

        {/* Footer Actions */}
        <div className="flex justify-center">
          <LogoutButton />
        </div>
      </div>
    </div>
  );
}