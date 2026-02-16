"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface SphinxLinkModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ChallengeResponse {
  challenge: string;
  qrCode: string;
  deepLink: string;
}

interface PollResponse {
  verified: boolean;
  pubkey?: string;
}

const POLL_INTERVAL = 2000; // 2 seconds
const CHALLENGE_EXPIRATION = 5 * 60 * 1000; // 5 minutes

export function SphinxLinkModal({ open, onOpenChange }: SphinxLinkModalProps) {
  const { update } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);

  // Cleanup function
  const cleanup = useCallback(() => {
    setIsLoading(false);
    setQrCode(null);
    setChallenge(null);
    setIsVerified(false);
    setIsLinking(false);
    setIsSuccess(false);
    setError(null);
    setIsExpired(false);
  }, []);

  // Fetch challenge and start flow
  const fetchChallenge = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/sphinx/challenge", {
        method: "POST",
      });

      if (!res.ok) {
        throw new Error("Failed to generate challenge");
      }

      const data: ChallengeResponse = await res.json();
      setChallenge(data.challenge);
      setQrCode(data.qrCode);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to generate challenge";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Poll for verification
  useEffect(() => {
    if (!challenge || !qrCode || isVerified || isExpired || error) {
      return;
    }

    let pollInterval: NodeJS.Timeout;
    let expirationTimeout: NodeJS.Timeout;

    const poll = async () => {
      try {
        const res = await fetch(`/api/auth/sphinx/poll/${challenge}`);
        if (!res.ok) {
          throw new Error("Failed to poll challenge status");
        }

        const data: PollResponse = await res.json();
        if (data.verified && data.pubkey) {
          setIsVerified(true);
          clearInterval(pollInterval);
          clearTimeout(expirationTimeout);
        }
      } catch (err) {
        console.error("Poll error:", err);
        // Don't show error toast for polling failures, just log
      }
    };

    // Start polling
    pollInterval = setInterval(poll, POLL_INTERVAL);

    // Set expiration timeout
    expirationTimeout = setTimeout(() => {
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
    if (!isVerified || !challenge || isLinking || isSuccess) {
      return;
    }

    const linkAccount = async () => {
      setIsLinking(true);
      try {
        const res = await fetch("/api/auth/sphinx/link", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ challenge }),
        });

        if (!res.ok) {
          throw new Error("Failed to link account");
        }

        // Successfully linked
        setIsSuccess(true);
        
        // Refresh session to get updated lightningPubkey
        await update();

        // Auto-close after 2 seconds
        setTimeout(() => {
          onOpenChange(false);
        }, 2000);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to link account";
        setError(message);
        toast.error(message);
        setIsVerified(false);
      } finally {
        setIsLinking(false);
      }
    };

    linkAccount();
  }, [isVerified, challenge, isLinking, isSuccess, onOpenChange, update]);

  // Initialize challenge when modal opens
  useEffect(() => {
    if (open && !challenge && !isLoading) {
      fetchChallenge();
    }
  }, [open, challenge, isLoading, fetchChallenge]);

  // Cleanup on close
  useEffect(() => {
    if (!open) {
      cleanup();
    }
  }, [open, cleanup]);

  const handleRetry = () => {
    cleanup();
    fetchChallenge();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link Sphinx Account</DialogTitle>
          <DialogDescription>
            Scan this QR code with your Sphinx app to link your account
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
          {/* Loading state */}
          {isLoading && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Generating QR code...</p>
            </div>
          )}

          {/* QR code display */}
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
                <p className="text-sm text-muted-foreground">
                  Waiting for Sphinx app...
                </p>
              </div>
            </div>
          )}

          {/* Linking state */}
          {isLinking && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-12 w-12 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Linking your account...</p>
            </div>
          )}

          {/* Success state */}
          {isSuccess && (
            <div className="flex flex-col items-center gap-4">
              <Check className="h-12 w-12 text-green-500" />
              <p className="font-medium">Your Sphinx account is now linked!</p>
            </div>
          )}

          {/* Error state */}
          {error && !isSuccess && (
            <div className="flex flex-col items-center gap-4">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="text-sm text-center text-destructive">{error}</p>
              <Button onClick={handleRetry} variant="outline">
                Try Again
              </Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLinking}
          >
            {isSuccess ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
