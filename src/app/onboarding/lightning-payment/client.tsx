"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, Copy, Loader2, Zap } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useState, useRef, useEffect, useCallback } from "react";

const POLL_INTERVAL_MS = 3000;

export function LightningPaymentClient() {
  const [invoice, setInvoice] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [paymentHash, setPaymentHash] = useState<string | null>(null);
  const [invoiceError, setInvoiceError] = useState<string | null>(null);
  const [isLoadingInvoice, setIsLoadingInvoice] = useState(true);
  const [isPaid, setIsPaid] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const paymentPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const invoiceFetchedRef = useRef(false);

  const stopPaymentPolling = useCallback(() => {
    if (paymentPollRef.current) {
      clearInterval(paymentPollRef.current);
      paymentPollRef.current = null;
    }
  }, []);

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
            localStorage.setItem("graphMindsetLightningPaymentHash", hash);
            const returnUrl = `/onboarding/lightning-payment?payment=success`;
            router.push(`/auth/signin?redirect=${encodeURIComponent(returnUrl)}`);
          }
        } catch {
          // Silently retry
        }
      };

      paymentPollRef.current = setInterval(checkStatus, POLL_INTERVAL_MS);
    },
    [stopPaymentPolling, router]
  );

  // On mount
  useEffect(() => {
    const paymentState = searchParams.get("payment");

    // Returning from sign-in after payment — claim then redirect to onboarding
    if (paymentState === "success") {
      setIsLoadingInvoice(false);
      setIsPaid(true);
      // Session-aware claim is handled in the effect below; skip here to avoid double-call
      return;
    }

    const workspaceName = localStorage.getItem("graphMindsetWorkspaceName");
    const workspaceSlug = localStorage.getItem("graphMindsetWorkspaceSlug");

    if (!workspaceName || !workspaceSlug) {
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

    return () => stopPaymentPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle ?payment=success when session loads asynchronously after mount
  useEffect(() => {
    if (!session?.user) return;
    const paymentState = searchParams.get("payment");
    if (paymentState !== "success") return;

    const claimAndRedirect = async () => {
      const hash = localStorage.getItem("graphMindsetLightningPaymentHash");
      if (!hash) {
        router.push("/onboarding/graphmindset");
        return;
      }
      try {
        const res = await fetch("/api/lightning/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentHash: hash }),
        });
        const data = await res.json();
        const redirect = data?.redirect || "/onboarding/graphmindset";
        router.push(redirect);
      } catch {
        router.push("/onboarding/graphmindset");
      }
    };

    claimAndRedirect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user]);

  const handleCopy = async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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

              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Waiting for payment…</span>
              </div>
            </>
          )}

          {/* Payment confirmed — redirecting */}
          {isPaid && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-500" />
              </div>
              <p className="text-sm font-medium">Payment confirmed!</p>
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
