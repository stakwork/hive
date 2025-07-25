'use client';

import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, Github, Loader2 } from "lucide-react";
import Link from 'next/link';

export default function SignInPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (session?.user) {
      setRedirecting(true);
      const user = session.user as { defaultWorkspaceSlug?: string };
      
      if (user.defaultWorkspaceSlug) {
        // User has a default workspace, redirect to their workspace
        router.push(`/w/${user.defaultWorkspaceSlug}`);
      } else {
        // User has no workspaces, redirect to onboarding
        router.push('/onboarding/workspace');
      }
    }
  }, [session, router]);

  if (status === 'loading' || redirecting) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="animate-spin h-8 w-8 text-blue-600 mx-auto mb-4" />
          <p className="text-muted-foreground">
            {redirecting ? 'Redirecting to your workspace...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  const handleGitHubSignIn = async () => {
    try {
      setIsSigningIn(true);
      const result = await signIn('github', {
        redirect: false, // Handle redirect manually for better UX
        callbackUrl: '/onboarding/workspace' // Always go through onboarding to avoid direct workspace access
      });
      
      if (result?.error) {
        console.error('Sign in error:', result.error);
        // Reset signing in state on error
        setIsSigningIn(false);
      }
      // Note: On success, the useEffect will handle the redirect based on session
    } catch (error) {
      console.error('Unexpected sign in error:', error);
      setIsSigningIn(false);
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
            <CardTitle className="text-2xl font-bold">Welcome to Hive</CardTitle>
            <CardDescription className="text-base">
              Sign in to start managing your products with clarity and confidence
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <Button 
              onClick={handleGitHubSignIn}
              disabled={isSigningIn}
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
            
            <div className="text-center">
              <p className="text-sm text-muted-foreground">
                By continuing, you agree to our{' '}
                <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline">Terms of Service</a>
                {' '}and{' '}
                <a href="#" className="text-blue-600 dark:text-blue-400 hover:underline">Privacy Policy</a>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 