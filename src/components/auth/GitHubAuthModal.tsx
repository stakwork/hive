"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Github, Loader2 } from "lucide-react";
import type { ClientSafeProvider } from "next-auth/react";
import { getProviders, signIn } from "next-auth/react";
import { useEffect, useState } from "react";

interface GitHubAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAuthSuccess: () => void;
}

export function GitHubAuthModal({ isOpen, onClose, onAuthSuccess }: GitHubAuthModalProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [providers, setProviders] = useState<Record<string, ClientSafeProvider> | null>(null);

  // Fetch available providers
  useEffect(() => {
    const fetchProviders = async () => {
      const availableProviders = await getProviders();
      setProviders(availableProviders);
    };
    fetchProviders();
  }, []);

  const handleGitHubSignIn = async () => {
    try {
      setIsSigningIn(true);
      const result = await signIn("github", {
        redirect: false,
      });

      if (result?.error) {
        console.error("Sign in error:", result.error);
        setIsSigningIn(false);
      } else if (result?.ok) {
        // Auth successful, notify parent
        onAuthSuccess();
        onClose();
      }
    } catch (error) {
      console.error("Unexpected sign in error:", error);
      setIsSigningIn(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <DialogTitle className="text-xl font-semibold">
            GitHub Authentication Required
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Sign in to GitHub to create your workspace and access repositories
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-4">
          {providers?.github && (
            <Button
              onClick={handleGitHubSignIn}
              disabled={isSigningIn}
              className="w-full h-11 text-base font-medium"
            >
              {isSigningIn ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <Github className="w-4 h-4 mr-2" />
                  Continue with GitHub
                </>
              )}
            </Button>
          )}

          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              By continuing, you agree to our{" "}
              <a href="#" className="text-primary hover:underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="#" className="text-primary hover:underline">
                Privacy Policy
              </a>
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}