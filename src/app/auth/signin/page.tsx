"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GraphMindsetCard } from "@/components/onboarding/GraphMindsetCard";
import { DarkWizardShell } from "@/components/onboarding/DarkWizardShell";
import { ArrowLeft, Github, Loader2, UserCheck } from "lucide-react";
import type { ClientSafeProvider } from "next-auth/react";
import { getProviders, signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";

function SignInContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isMockSigningIn, setIsMockSigningIn] = useState(false);
  const [mockUsername, setMockUsername] = useState("");
  const [providers, setProviders] = useState<Record<string, ClientSafeProvider> | null>(null);

  // Derive redirect path early — must be before any early returns so isGraphMindsetFlow is always available
  const redirectPath = searchParams.get("redirect");
  const isGraphMindsetFlow =
    redirectPath?.includes("/onboarding/graphmindset") ||
    redirectPath?.includes("/onboarding/lightning-payment");

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

      if (redirectPath) {
        router.push(redirectPath);
      } else if (user.defaultWorkspaceSlug) {
        router.push(`/w/${user.defaultWorkspaceSlug}`);
      }
    }
  }, [session, router, redirectPath]);

  if (status === "loading") {
    if (isGraphMindsetFlow) {
      return (
        <DarkWizardShell>
          <div className="min-h-[320px] flex flex-col items-center justify-center gap-4">
            <Loader2 className="animate-spin h-8 w-8 text-zinc-400" />
          </div>
        </DarkWizardShell>
      );
    }
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" />
          <p className="text-muted-foreground" />
        </div>
      </div>
    );
  }

  const handleGitHubSignIn = async () => {
    try {
      setIsSigningIn(true);
      const result = await signIn("github", {
        redirect: false,
        callbackUrl: redirectPath || "/",
      });

      if (result?.error) {
        console.error("Sign in error:", result.error);
        setIsSigningIn(false);
      }
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
        redirect: false,
        callbackUrl: redirectPath || "/",
      });

      if (result?.error) {
        console.error("Mock sign in error:", result.error);
        setIsMockSigningIn(false);
      }
    } catch (error) {
      console.error("Unexpected mock sign in error:", error);
      setIsMockSigningIn(false);
    }
  };

  // ---- GraphMindset dark flow ----
  if (isGraphMindsetFlow) {
    return (
      <DarkWizardShell>
        <div className="flex flex-col gap-6">
          <Link
            href="/"
            className="inline-flex items-center text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm p-8 flex flex-col gap-6">
            <div className="text-center">
              <h1 className="text-2xl font-bold text-zinc-100">Hive</h1>
            </div>

            <div className="flex flex-col gap-4">
              {providers?.github && (
                <Button
                  data-testid="github-signin-button"
                  onClick={handleGitHubSignIn}
                  disabled={isSigningIn || isMockSigningIn}
                  className="w-full h-12 text-base font-medium bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 disabled:opacity-50"
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
                        <span className="w-full border-t border-zinc-700" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-zinc-900 px-2 text-zinc-500">Or for development</span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="mock-username" className="text-zinc-300">Username (optional)</Label>
                      <Input
                        id="mock-username"
                        type="text"
                        placeholder="Enter username (defaults to 'dev-user')"
                        value={mockUsername}
                        onChange={(e) => setMockUsername(e.target.value)}
                        disabled={isMockSigningIn || isSigningIn}
                        className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500"
                      />
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
                <p className="text-sm text-zinc-400">
                  By continuing, you agree to our{" "}
                  <a href="#" className="text-blue-400 hover:underline">
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="#" className="text-blue-400 hover:underline">
                    Privacy Policy
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>
      </DarkWizardShell>
    );
  }

  // ---- Default (light) flow ----
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className={`w-full ${hasMockProvider ? "max-w-2xl" : "max-w-md"}`}>
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

        {hasMockProvider && (
          <div className="mt-6">
            <div className="relative mb-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">GraphMindset (Dev)</span>
              </div>
            </div>
            <GraphMindsetCard />
          </div>
        )}
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" />
            <p className="text-muted-foreground">Loading...</p>
          </div>
        </div>
      }
    >
      <SignInContent />
    </Suspense>
  );
}
