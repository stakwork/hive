"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Check, AlertCircle, Smartphone } from "lucide-react";

const POLL_INTERVAL = 2000;
const CHALLENGE_EXPIRATION = 5 * 60 * 1000; // 5 minutes

type Step = "sphinx-link";

export function GraphMindsetOnboardingClient() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [currentStep] = useState<Step>("sphinx-link");

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(`/auth/signin?redirect=${encodeURIComponent("/onboarding/graphmindset")}`);
    }
  }, [status, router]);

  // Skip Sphinx link if already connected
  const isSphinxLinked = !!(session?.user as { lightningPubkey?: string } | undefined)?.lightningPubkey;

  if (status === "loading") {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session?.user) return null;

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      {currentStep === "sphinx-link" && (
        <SphinxLinkStep
          isAlreadyLinked={isSphinxLinked}
          onComplete={() => {
            // Future: advance to next step (fork, graph creation, etc.)
          }}
          onSessionUpdate={update}
        />
      )}
    </div>
  );
}

interface SphinxLinkStepProps {
  isAlreadyLinked: boolean;
  onComplete: () => void;
  onSessionUpdate: () => Promise<unknown>;
}

function SphinxLinkStep({ isAlreadyLinked, onComplete, onSessionUpdate }: SphinxLinkStepProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isSuccess, setIsSuccess] = useState(isAlreadyLinked);
  const [error, setError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  const cleanup = useCallback(() => {
    setIsLoading(false);
    setQrCode(null);
    setChallenge(null);
    setIsVerified(false);
    setIsLinking(false);
    setError(null);
    setIsExpired(false);
  }, []);

  const fetchChallenge = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/sphinx/challenge", { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate challenge");

      const data = await res.json();
      setChallenge(data.challenge);
      setQrCode(data.qrCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate challenge");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Poll for verification
  useEffect(() => {
    if (!challenge || !qrCode || isVerified || isExpired || error) return;

    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/auth/sphinx/poll/${challenge}`);
        if (!res.ok) return;

        const data = await res.json();
        if (data.verified && data.pubkey) {
          setIsVerified(true);
          clearInterval(pollInterval);
        }
      } catch {
        // Silently retry
      }
    }, POLL_INTERVAL);

    const expirationTimeout = setTimeout(() => {
      setIsExpired(true);
      setError("Challenge expired. Please try again.");
      clearInterval(pollInterval);
    }, CHALLENGE_EXPIRATION);

    return () => {
      clearInterval(pollInterval);
      clearTimeout(expirationTimeout);
    };
  }, [challenge, qrCode, isVerified, isExpired, error]);

  // Link account when verified
  useEffect(() => {
    if (!isVerified || !challenge || isLinking || isSuccess) return;

    const linkAccount = async () => {
      setIsLinking(true);
      try {
        const res = await fetch("/api/auth/sphinx/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ challenge }),
        });

        if (!res.ok) throw new Error("Failed to link account");

        setIsSuccess(true);
        await onSessionUpdate();
        onComplete();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to link account");
        setIsVerified(false);
      } finally {
        setIsLinking(false);
      }
    };

    linkAccount();
  }, [isVerified, challenge, isLinking, isSuccess, onComplete, onSessionUpdate]);

  // Auto-fetch challenge on mount if not already linked
  useEffect(() => {
    if (!isAlreadyLinked && !challenge && !isLoading) {
      fetchChallenge();
    }
  }, [isAlreadyLinked, challenge, isLoading, fetchChallenge]);

  const handleRetry = () => {
    cleanup();
    fetchChallenge();
  };

  if (isSuccess) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center py-12 gap-4">
          <Check className="h-12 w-12 text-green-500" />
          <p className="font-medium text-lg">Sphinx account linked</p>
          <p className="text-sm text-muted-foreground">
            You can now perform GitHub actions from the Sphinx mobile app.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="w-16 h-16 bg-purple-100 dark:bg-purple-900 rounded-full flex items-center justify-center mx-auto mb-4">
          <Smartphone className="w-8 h-8 text-purple-600 dark:text-purple-400" />
        </div>
        <CardTitle className="text-2xl">Link your Sphinx account</CardTitle>
        <CardDescription className="text-lg">
          Scan this QR code with your Sphinx app to link your account
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {isLoading && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Generating QR code...</p>
          </div>
        )}

        {qrCode && !isVerified && !isExpired && !error && (
          <div className="flex flex-col items-center gap-4">
            <Image
              src={qrCode}
              alt="Sphinx QR Code"
              width={300}
              height={300}
              className="border rounded-lg"
              unoptimized
            />
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p className="text-sm text-muted-foreground">Waiting for Sphinx app...</p>
            </div>
          </div>
        )}

        {isLinking && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Linking your account...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-4 py-8">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="text-sm text-center text-destructive">{error}</p>
            <Button onClick={handleRetry} variant="outline">
              Try Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
