"use client";

import { SwarmSetupLoader } from "@/components/onboarding/SwarmSetupLoader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Check, Copy, Loader2, Zap } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState, useRef, useEffect, useCallback } from "react";

const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function LightningPaymentClient() {
  const [invoice, setInvoice] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [paymentHash, setPaymentHash] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(true);
  const [isPaid, setIsPaid] = useState(false);
  const [isPollingSwarm, setIsPollingSwarm] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [isClaiming, setIsClaiming] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: session } = useSession();
  const { refreshWorkspaces } = useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paymentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const claimCalledRef = useRef(false);
  const invoiceFetchedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  const stopPaymentPolling = useCallback(() => {
    if (paymentPollRef.current) {
      clearInterval(paymentPollRef.current);
      paymentPollRef.current = null;
    }
  }, []);

  const startSwarmPolling = useCallback(
    (workspaceId: string) => {
      const poll = async () => {
        try {
          const res = await fetch("/api/swarm/poll", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId }),
          });
          const data = await res.json();

          if (data?.status === "ACTIVE") {
            stopPolling();
            const wsRes = await fetch("/api/workspaces");
            const wsData = await wsRes.json();
            const ws = wsData?.workspaces?.find(
              (w: { id: string; slug: string }) => w.id === workspaceId
            );
            router.push(ws?.slug ? `/w/${ws.slug}` : "/");
          }
        } catch {
          // Silently retry on transient errors
        }
      };

      poll();
      pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
      pollTimeoutRef.current = setTimeout(() => {
        stopPolling();
        setIsPollingSwarm(false);
        setPollError(
          "Provisioning is taking longer than expected. Please contact support."
        );
      }, POLL_TIMEOUT_MS);
    },
    [router, stopPolling]
  );

  const claimLightningPayment = useCallback(
    async (hash: string) => {
      if (claimCalledRef.current) return;
      claimCalledRef.current = true;

      setIsClaiming(true);
      try {
        const password = localStorage.getItem("graphMindsetPassword");
        if (!password) {
          setPollError("Setup data is missing. Please restart onboarding from the beginning.");
          setIsClaiming(false);
          claimCalledRef.current = false;
          return;
        }

        const res = await fetch("/api/lightning/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentHash: hash, password }),
        });
        const data = await res.json();

        if (!res.ok) {
          setPollError(data?.error || "Failed to set up your workspace. Please contact support.");
          setIsClaiming(false);
          claimCalledRef.current = false;
          return;
        }

        localStorage.removeItem("graphMindsetPassword");
        localStorage.removeItem("graphMindsetLightningPaymentHash");

        const workspaceId = data?.workspace?.id;
        if (workspaceId) {
          await refreshWorkspaces();
          setIsClaiming(false);
          setIsPollingSwarm(true);
          startSwarmPolling(workspaceId);
        } else {
          setPollError("Workspace creation succeeded but no ID was returned. Please contact support.");
          setIsClaiming(false);
          claimCalledRef.current = false;
        }
      } catch {
        setPollError("Something went wrong setting up your workspace. Please contact support.");
        setIsClaiming(false);
        claimCalledRef.current = false;
      }
    },
    [refreshWorkspaces, startSwarmPolling]
  );

  const startPaymentPolling = useCallback(
    (hash: string) => {
      const checkStatus = async () => {
        try {
          const res = await fetch(
            `/api/lightning/invoice/status?paymentHash=${encodeURIComponent(hash)}`
          );
          if (!res.ok) return;
          const data = await res.json();

          if (data?.status === "PAID") {
            stopPaymentPolling();
            setIsPaid(true);

            if (session?.user) {
              claimLightningPayment(hash);
            } else {
              localStorage.setItem("graphMindsetLightningPaymentHash", hash);
              const returnUrl = `/onboarding/lightning-payment?payment=success`;
              router.push(`/auth/signin?redirect=${encodeURIComponent(returnUrl)}`);
            }
          }
        } catch {
          // Silently retry
        }
      };

      paymentPollRef.current = setInterval(checkStatus, POLL_INTERVAL_MS);
    },
    [session?.user, claimLightningPayment, stopPaymentPolling, router]
  );

  // On mount: read localStorage, redirect if missing, fetch invoice
  useEffect(() => {
    const paymentState = searchParams.get("payment");

    if (paymentState === "success") {
      // Returning from sign-in after payment
      const savedHash = localStorage.getItem("graphMindsetLightningPaymentHash");
      if (savedHash && session?.user) {
        setIsLoadingInvoice(false);
        setIsPaid(true);
        claimLightningPayment(savedHash);
      }
      return;
    }

    const workspaceName = localStorage.getItem("graphMindsetWorkspaceName");
    const workspaceSlug = localStorage.getItem("graphMindsetWorkspaceSlug");
    const password = localStorage.getItem("graphMindsetPassword");

    if (!workspaceName || !workspaceSlug || !password) {
      router.push("/onboarding/workspace");
      return;
    }

    if (invoiceFetchedRef.current) return;
    invoiceFetchedRef.current = true;

    const fetchInvoice = async () => {
      try {
        const res = await fetch("/api/lightning/invoice/preauth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceName, workspaceSlug }),
        });
        const data = await res.json();

        if (!res.ok) {
          setInvoiceError(data?.error || "Failed to generate Lightning invoice.");
          setIsLoadingInvoice(false);
          return;
        }

        setInvoice(data.invoice);
        setQrCodeDataUrl(data.qrCodeDataUrl);
        setPaymentHash(data.paymentHash);
        setIsLoadingInvoice(false);
        startPaymentPolling(data.paymentHash);
      } catch {
        setInvoiceError("Failed to generate Lightning invoice. Please try again.");
        setIsLoadingInvoice(false);
      }
    };

    fetchInvoice();

    return () => {
      stopPaymentPolling();
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle ?payment=success when session loads asynchronously after mount
  useEffect(() => {
    if (!session?.user) return;
    const paymentState = searchParams.get("payment");
    if (paymentState === "success") {
      const savedHash = localStorage.getItem("graphMindsetLightningPaymentHash");
      if (savedHash) {
        setIsLoadingInvoice(false);
        setIsPaid(true);
        claimLightningPayment(savedHash);
      }
    }
    // Only re-run when session becomes available
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user]);

  const handleCopy = async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Provisioning / claiming state
  if (isClaiming || (isPollingSwarm && !pollError)) {
    return (
      <div className="max-w-2xl mx-auto">
        <SwarmSetupLoader />
      </div>
    );
  }

  // Error state
  if (pollError) {
    return (
      <div className="max-w-lg mx-auto">
        <Card className="p-8 text-center space-y-4 border border-destructive/30">
          <p className="text-destructive font-medium">{pollError}</p>
          <Button variant="outline" onClick={() => router.push("/onboarding/workspace")}>
            Start over
          </Button>
        </Card>
      </div>
    );
  }

  // Invoice error state
  if (invoiceError) {
    return (
      <div className="max-w-lg mx-auto">
        <Card className="p-8 text-center space-y-4 border border-destructive/30">
          <p className="text-destructive font-medium">{invoiceError}</p>
          <Button variant="outline" onClick={() => router.push("/onboarding/workspace")}>
            Start over
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <Card className="overflow-hidden border border-yellow-500/30 bg-card">
        {/* Header */}
        <div className="flex items-center gap-3 p-6 border-b border-border bg-gradient-to-r from-yellow-500/10 to-transparent">
          <div className="w-10 h-10 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center flex-shrink-0">
            <Zap className="w-5 h-5 text-yellow-500" />
          </div>
          <div>
            <h3 className="font-semibold text-base">Lightning Payment</h3>
            <p className="text-xs text-muted-foreground">Scan the QR code with your Lightning wallet</p>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Loading invoice */}
          {isLoadingInvoice && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Generating invoice…</p>
            </div>
          )}

          {/* Awaiting payment */}
          {!isLoadingInvoice && !isPaid && paymentHash && (
            <>
              {/* QR Code */}
              {qrCodeDataUrl && (
                <div className="flex justify-center">
                  <div className="p-3 bg-white rounded-xl border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={qrCodeDataUrl}
                      alt="Lightning invoice QR code"
                      width={260}
                      height={260}
                      className="block"
                    />
                  </div>
                </div>
              )}

              {/* Copyable invoice string */}
              {invoice && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Payment Request
                  </label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md border border-border font-mono truncate">
                      {invoice}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopy}
                      className="flex-shrink-0 gap-1.5"
                    >
                      {copied ? (
                        <><Check className="w-3.5 h-3.5 text-green-500" /> Copied</>
                      ) : (
                        <><Copy className="w-3.5 h-3.5" /> Copy</>
                      )}
                    </Button>
                  </div>
                </div>
              )}

              {/* Waiting indicator */}
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Waiting for payment…</span>
              </div>
            </>
          )}

          {/* Payment detected — transitioning to provisioning */}
          {isPaid && !isClaiming && !isPollingSwarm && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-500" />
              </div>
              <p className="text-sm font-medium">Payment confirmed!</p>
              <p className="text-xs text-muted-foreground">Setting up your workspace…</p>
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
