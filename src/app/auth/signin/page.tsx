"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Github, Loader2, Crown, Shield, Code, Users, Eye, Briefcase } from "lucide-react";
import type { ClientSafeProvider } from "next-auth/react";
import { getProviders, signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { WorkspaceRole } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

// Predefined mock users for testing different permission levels
const MOCK_USERS = [
  {
    username: "olivia-owner",
    name: "Olivia Owner",
    role: WorkspaceRole.OWNER,
    icon: Crown,
    description: "Full system access",
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-50 dark:bg-purple-950/50",
    borderColor: "border-purple-200 dark:border-purple-800",
    hoverBg: "hover:bg-purple-100 dark:hover:bg-purple-900/50",
  },
  {
    username: "adam-admin",
    name: "Adam Admin",
    role: WorkspaceRole.ADMIN,
    icon: Shield,
    description: "Manage settings & users",
    color: "text-red-600 dark:text-red-400",
    bgColor: "bg-red-50 dark:bg-red-950/50",
    borderColor: "border-red-200 dark:border-red-800",
    hoverBg: "hover:bg-red-100 dark:hover:bg-red-900/50",
  },
  {
    username: "petra-pm",
    name: "Petra PM",
    role: WorkspaceRole.PM,
    icon: Briefcase,
    description: "Manage products & features",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/50",
    borderColor: "border-blue-200 dark:border-blue-800",
    hoverBg: "hover:bg-blue-100 dark:hover:bg-blue-900/50",
  },
  {
    username: "dave-developer",
    name: "Dave Developer",
    role: WorkspaceRole.DEVELOPER,
    icon: Code,
    description: "Create & edit tasks",
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-50 dark:bg-green-950/50",
    borderColor: "border-green-200 dark:border-green-800",
    hoverBg: "hover:bg-green-100 dark:hover:bg-green-900/50",
  },
  {
    username: "sam-stakeholder",
    name: "Sam Stakeholder",
    role: WorkspaceRole.STAKEHOLDER,
    icon: Users,
    description: "View & comment",
    color: "text-orange-600 dark:text-orange-400",
    bgColor: "bg-orange-50 dark:bg-orange-950/50",
    borderColor: "border-orange-200 dark:border-orange-800",
    hoverBg: "hover:bg-orange-100 dark:hover:bg-orange-900/50",
  },
  {
    username: "vic-viewer",
    name: "Vic Viewer",
    role: WorkspaceRole.VIEWER,
    icon: Eye,
    description: "Read-only access",
    color: "text-gray-600 dark:text-gray-400",
    bgColor: "bg-gray-50 dark:bg-gray-950/50",
    borderColor: "border-gray-200 dark:border-gray-800",
    hoverBg: "hover:bg-gray-100 dark:hover:bg-gray-900/50",
  },
] as const;

function SignInContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isMockSigningIn, setIsMockSigningIn] = useState(false);
  const [selectedMockUser, setSelectedMockUser] = useState<typeof MOCK_USERS[number] | null>(null);
  const [providers, setProviders] = useState<Record<string, ClientSafeProvider> | null>(null);

  // Check if there's a redirect parameter
  const redirectPath = searchParams.get("redirect");

  // Fetch available providers
  useEffect(() => {
    const fetchProviders = async () => {
      const availableProviders = await getProviders();
      setProviders(availableProviders);
    };
    fetchProviders();
  }, []);

  // Check if mock provider is available
  const hasMockProvider = providers?.mock;

  useEffect(() => {
    if (session?.user) {
      const user = session.user as { defaultWorkspaceSlug?: string };

      // If there's a specific redirect path, use it
      if (redirectPath) {
        router.push(redirectPath);
      } else if (user.defaultWorkspaceSlug) {
        // User has a default workspace, redirect to their workspace
        router.push(`/w/${user.defaultWorkspaceSlug}`);
      }
      // Note: Users without workspaces are handled by root page's handleWorkspaceRedirect()
    }
  }, [session, router, redirectPath]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" />
          <p className="text-muted-foreground">
            {/* {redirecting ? "Redirecting to your workspace..." : "Loading..."} */}
          </p>
        </div>
      </div>
    );
  }

  const handleGitHubSignIn = async () => {
    try {
      setIsSigningIn(true);
      const result = await signIn("github", {
        redirect: false, // Handle redirect manually for better UX
        callbackUrl: redirectPath || "/", // Use redirect parameter if available
      });

      if (result?.error) {
        console.error("Sign in error:", result.error);
        // Reset signing in state on error
        setIsSigningIn(false);
      }
      // Note: On success, the useEffect will handle the redirect based on session
    } catch (error) {
      console.error("Unexpected sign in error:", error);
      setIsSigningIn(false);
    }
  };

  const handleMockUserSignIn = async (mockUser: typeof MOCK_USERS[number]) => {
    if (isMockSigningIn || isSigningIn) return;
    
    try {
      setIsMockSigningIn(true);
      setSelectedMockUser(mockUser);
      const result = await signIn("mock", {
        username: mockUser.username,
        role: mockUser.role,
        redirect: false,
        callbackUrl: redirectPath || "/",
      });

      if (result?.error) {
        console.error("Mock sign in error:", result.error);
        setIsMockSigningIn(false);
        setSelectedMockUser(null);
      }
      // Note: On success, the useEffect will handle the redirect based on session
    } catch (error) {
      console.error("Unexpected mock sign in error:", error);
      setIsMockSigningIn(false);
      setSelectedMockUser(null);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-8 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Link>

        <Card className="border-0 shadow-xl bg-card text-card-foreground">
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-2xl font-bold">Hive</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {providers?.github && (
              <Button
                data-testid="github-signin-button"
                onClick={handleGitHubSignIn}
                disabled={isSigningIn || isMockSigningIn}
                className="w-full h-12 text-base font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isSigningIn ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  <>
                    <Github className="w-5 h-5 mr-3" />
                    Continue with GitHub
                  </>
                )}
              </Button>
            )}

            {hasMockProvider && (
              <>
                {providers?.github && (
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">Or sign in as a mock user</span>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground text-center">
                    Select a user to test different permission levels
                  </p>
                  
                  <div className="grid grid-cols-1 gap-2">
                    {MOCK_USERS.map((mockUser) => {
                      const Icon = mockUser.icon;
                      const isSelected = selectedMockUser?.username === mockUser.username;
                      const isSigningInAsThis = isMockSigningIn && isSelected;
                      
                      return (
                        <button
                          key={mockUser.username}
                          onClick={() => handleMockUserSignIn(mockUser)}
                          disabled={isMockSigningIn || isSigningIn}
                          data-testid={`mock-user-${mockUser.username}`}
                          className={cn(
                            "w-full p-3 rounded-lg border-2 transition-all text-left",
                            "flex items-center gap-3",
                            "disabled:opacity-50 disabled:cursor-not-allowed",
                            mockUser.bgColor,
                            mockUser.borderColor,
                            mockUser.hoverBg,
                            isSelected && "ring-2 ring-offset-2 ring-blue-500"
                          )}
                        >
                          <div className={cn(
                            "flex items-center justify-center w-10 h-10 rounded-full",
                            mockUser.bgColor
                          )}>
                            {isSigningInAsThis ? (
                              <Loader2 className={cn("w-5 h-5 animate-spin", mockUser.color)} />
                            ) : (
                              <Icon className={cn("w-5 h-5", mockUser.color)} />
                            )}
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm text-foreground">
                                {mockUser.name}
                              </p>
                              <span className={cn(
                                "text-xs px-2 py-0.5 rounded-full font-medium",
                                mockUser.bgColor,
                                mockUser.color
                              )}>
                                {mockUser.role}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {mockUser.description}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}

            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                By continuing, you agree to our{" "}
                <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline">
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline">
                  Privacy Policy
                </a>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    }>
      <SignInContent />
    </Suspense>
  );
}
