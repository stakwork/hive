import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserWorkspaces } from "@/services/workspace";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Building2, Plus, ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import { WORKSPACE_LIMITS } from "@/lib/constants";
import { WorkspacesPageContent } from "@/components/WorkspacesPageContent";

export default async function WorkspacesPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/signin");
  }

  const userId = (session.user as { id: string }).id;
  const userWorkspaces = await getUserWorkspaces(userId);

  // Don't redirect if no workspaces - show empty state instead
  const hasWorkspaces = userWorkspaces.length > 0;
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
          <h1 className="text-3xl font-bold mb-2">
            {hasWorkspaces ? "Choose Your Workspace" : "Your Workspaces"}
          </h1>
          <p className="text-muted-foreground">
            Welcome back{session?.user?.name ? `, ${session.user.name}` : ''}
          </p>
        </div>

        {/* Workspaces List */}
        <div className="space-y-3 mb-8">
          {!hasWorkspaces && (
            <>
              {/* Empty State Message */}
              <div className="text-center mb-6">
                <p className="text-muted-foreground">
                  No workspaces yet. Ask an admin to add you or create your own.
                </p>
              </div>
            </>
          )}
          <WorkspacesPageContent workspaces={userWorkspaces} />

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