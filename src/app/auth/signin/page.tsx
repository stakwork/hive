"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Github, Loader2, UserCheck } from "lucide-react";
import type { ClientSafeProvider } from "next-auth/react";
import { getProviders, signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { WorkspaceRole, RoleLabels } from "@/lib/auth/roles";

function SignInContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isMockSigningIn, setIsMockSigningIn] = useState(false);
  const [mockUsername, setMockUsername] = useState("");
  const [mockRole, setMockRole] = useState<WorkspaceRole>(WorkspaceRole.DEVELOPER);
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

  const handleMockSignIn = async () => {
    try {
      setIsMockSigningIn(true);
      const result = await signIn("mock", {
        username: mockUsername || "dev-user",
        role: mockRole,
        redirect: false,
        callbackUrl: redirectPath || "/",
      });

      if (result?.error) {
        console.error("Mock sign in error:", result.error);
        setIsMockSigningIn(false);
      }
      // Note: On success, the useEffect will handle the redirect based on session
    } catch (error) {
      console.error("Unexpected mock sign in error:", error);
      setIsMockSigningIn(false);
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
                      <span className="bg-background px-2 text-muted-foreground">Or for development</span>
                    </div>
                  </div>
                )}

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="mock-username">Username (optional)</Label>
                    <Input
                      id="mock-username"
                      type="text"
                      placeholder="Enter username (defaults to 'dev-user')"
                      value={mockUsername}
                      onChange={(e) => setMockUsername(e.target.value)}
                      disabled={isMockSigningIn || isSigningIn}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mock-role">Permission Level</Label>
                    <Select
                      value={mockRole}
                      onValueChange={(value) => setMockRole(value as WorkspaceRole)}
                      disabled={isMockSigningIn || isSigningIn}
                    >
                      <SelectTrigger id="mock-role" data-testid="mock-role-select">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={WorkspaceRole.VIEWER}>
                          {RoleLabels[WorkspaceRole.VIEWER]}
                        </SelectItem>
                        <SelectItem value={WorkspaceRole.STAKEHOLDER}>
                          {RoleLabels[WorkspaceRole.STAKEHOLDER]}
                        </SelectItem>
                        <SelectItem value={WorkspaceRole.DEVELOPER}>
                          {RoleLabels[WorkspaceRole.DEVELOPER]}
                        </SelectItem>
                        <SelectItem value={WorkspaceRole.PM}>
                          {RoleLabels[WorkspaceRole.PM]}
                        </SelectItem>
                        <SelectItem value={WorkspaceRole.ADMIN}>
                          {RoleLabels[WorkspaceRole.ADMIN]}
                        </SelectItem>
                        <SelectItem value={WorkspaceRole.OWNER}>
                          {RoleLabels[WorkspaceRole.OWNER]}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    data-testid="mock-signin-button"
                    onClick={handleMockSignIn}
                    disabled={isMockSigningIn || isSigningIn}
                    className="w-full h-12 text-base font-medium bg-orange-600 text-white hover:bg-orange-700 transition-colors disabled:opacity-50"
                  >
                    {isMockSigningIn ? (
                      <>
                        <Loader2 className="w-5 h-5 mr-3 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        <UserCheck className="w-5 h-5 mr-3" />
                        Mock Sign In (Dev)
                      </>
                    )}
                  </Button>
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
