"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Zap, Unlink, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface SphinxLinkProps {
  linkedPubkey?: string | null;
}

export function SphinxLink({ linkedPubkey }: SphinxLinkProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [isUnlinking, setIsUnlinking] = useState(false);
  const [pubkey, setPubkey] = useState<string | null>(linkedPubkey ?? null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setIsPolling(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const startLinking = async () => {
    setIsOpen(true);
    setQrCode(null);
    setChallenge(null);

    try {
      const res = await fetch("/api/auth/sphinx/challenge", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create challenge");

      const data = await res.json();
      setQrCode(data.qrCode);
      setChallenge(data.challenge);
      setIsPolling(true);

      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const pollRes = await fetch(
            `/api/auth/sphinx/poll/${data.challenge}`,
          );
          if (!pollRes.ok) return;

          const pollData = await pollRes.json();
          if (pollData.verified && pollData.pubkey) {
            stopPolling();
            await linkPubkey(data.challenge);
          }
        } catch {
          // Polling error — continue
        }
      }, 2000);
    } catch {
      toast.error("Failed to start linking flow");
      setIsOpen(false);
    }
  };

  const linkPubkey = async (k1: string) => {
    setIsLinking(true);
    try {
      const res = await fetch("/api/auth/sphinx/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge: k1 }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to link");
      }

      const data = await res.json();
      setPubkey(data.pubkey);
      toast.success("Sphinx wallet linked successfully");
      setIsOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to link wallet",
      );
    } finally {
      setIsLinking(false);
    }
  };

  const handleUnlink = async () => {
    if (!confirm("Are you sure you want to unlink your Sphinx wallet?")) return;

    setIsUnlinking(true);
    try {
      const res = await fetch("/api/auth/sphinx/link", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to unlink");

      setPubkey(null);
      toast.success("Sphinx wallet unlinked");
    } catch {
      toast.error("Failed to unlink wallet");
    } finally {
      setIsUnlinking(false);
    }
  };

  const truncatedPubkey = pubkey
    ? `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`
    : null;

  if (pubkey) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
          <Zap className="w-8 h-8 text-foreground" />
          <div className="flex-1">
            <div className="font-medium">Sphinx Wallet</div>
            <div className="text-sm text-muted-foreground font-mono">
              {truncatedPubkey}
            </div>
          </div>
          <div className="text-sm text-green-600 font-medium">Connected</div>
        </div>

        <div className="border-t pt-4">
          <Button
            variant="outline"
            onClick={handleUnlink}
            disabled={isUnlinking}
            className="w-full"
          >
            <Unlink className="w-4 h-4 mr-2" />
            {isUnlinking ? "Unlinking..." : "Unlink Sphinx Wallet"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-4 bg-muted rounded-lg">
          <Zap className="w-8 h-8 text-muted-foreground" />
          <div className="flex-1">
            <div className="font-medium text-muted-foreground">
              Sphinx Wallet
            </div>
            <div className="text-sm text-muted-foreground">
              Not connected
            </div>
          </div>
        </div>

        <Button onClick={startLinking} className="w-full">
          <Zap className="w-4 h-4 mr-2" />
          Link Sphinx Wallet
        </Button>
      </div>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            stopPolling();
            setIsOpen(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Link Sphinx Wallet</DialogTitle>
            <DialogDescription>
              Scan this QR code with your Sphinx app to link your Lightning
              identity.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-4">
            {qrCode ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrCode}
                alt="Sphinx authentication QR code"
                className="w-64 h-64 rounded-lg"
              />
            ) : (
              <div className="w-64 h-64 flex items-center justify-center bg-muted rounded-lg">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {isLinking ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Linking wallet...
              </div>
            ) : isPolling ? (
              <p className="text-sm text-muted-foreground">
                Waiting for Sphinx app confirmation...
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
