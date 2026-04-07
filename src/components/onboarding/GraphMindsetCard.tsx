"use client";

import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  Database,
  Loader2,
  Network,
  Sparkles,
  Users,
  Zap,
  CreditCard,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

export function GraphMindsetCard() {
  const [name, setName] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [nameError, setNameError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLightningLoading, setIsLightningLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);
  const [amountUsd, setAmountUsd] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/config/price?type=graphmindset")
      .then((r) => r.json())
      .then((d) => { if (d?.amountUsd != null) setAmountUsd(d.amountUsd); })
      .catch(() => {});
  }, []);
  const router = useRouter();

  const handleNameChange = (value: string) => {
    setName(value);
    setIsAvailable(false);
    setNameError("");
    setShowPaymentOptions(false);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setIsValidating(false);
      return;
    }

    setIsValidating(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/graphmindset/slug-availability?slug=${encodeURIComponent(value.trim())}`
        );
        const json = await res.json();
        if (json?.data?.isAvailable) {
          setIsAvailable(true);
          setNameError("");
        } else {
          setIsAvailable(false);
          setNameError(json?.data?.message || json?.error || "This name is already taken.");
        }
      } catch {
        setIsAvailable(false);
        setNameError("Could not check availability. Please try again.");
      } finally {
        setIsValidating(false);
      }
    }, 500);
  };

  const canSubmit = name.trim().length > 0 && isAvailable && !isValidating && !isLoading;

  const handlePayWithCard = async () => {
    if (!canSubmit) return;
    setSubmitError("");
    setIsLoading(true);

    try {
      localStorage.setItem("graphMindsetWorkspaceName", name);
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceName: name, workspaceSlug: name }),
      });
      const json = await res.json();
      if (!res.ok) {
        setSubmitError(json?.error || "Failed to create payment session.");
        setIsLoading(false);
        return;
      }
      const { sessionUrl } = json;
      if (!sessionUrl) {
        setSubmitError("No payment URL returned. Please try again.");
        setIsLoading(false);
        return;
      }
      window.location.href = sessionUrl;
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setIsLoading(false);
    }
  };

  const handlePayWithLightning = () => {
    setIsLightningLoading(true);
    localStorage.setItem("graphMindsetWorkspaceName", name);
    localStorage.setItem("graphMindsetWorkspaceSlug", name);
    router.push("/onboarding/lightning-payment");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.35 }}
      className="rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm p-8 flex flex-col gap-6"
    >
      {/* Icon */}
      <div className="relative w-12 h-12">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-purple-700 flex items-center justify-center">
          <Network className="w-6 h-6 text-white" />
        </div>
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-white border-2 border-zinc-900" />
      </div>

      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">GraphMindset</h2>
        <p className="text-zinc-400 text-sm leading-relaxed">
          Build an AI-powered knowledge graph from your repositories — explore relationships,
          query your codebase, and collaborate with your team in real time.
        </p>
      </div>

      {/* Features */}
      <ul className="space-y-2">
        {[
          { icon: Network, text: "Graph-based code exploration" },
          { icon: Users, text: "Team collaboration workspace" },
          { icon: Database, text: "Persistent knowledge store" },
          { icon: Sparkles, text: "AI-powered graph insights" },
        ].map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 text-sm text-zinc-300">
            <Icon className="w-4 h-4 text-purple-400 shrink-0" />
            {text}
          </li>
        ))}
      </ul>

      {/* Price */}
      <p className="text-zinc-500 text-sm font-medium">
        <span className="text-white text-lg font-bold">
          {amountUsd !== null ? `$${amountUsd}` : "—"}
        </span>{" "}
        / workspace
      </p>

      {/* Input */}
      <div className="space-y-1">
        <Input
          type="text"
          placeholder="Workspace name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          disabled={isLoading}
          className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-purple-500"
        />
        {isValidating && (
          <p className="text-zinc-400 text-xs flex items-center gap-1">
            <Loader2 className="w-3 h-3 animate-spin" /> Checking availability…
          </p>
        )}
        {!isValidating && isAvailable && !nameError && (
          <p className="text-green-400 text-xs">Name is available ✓</p>
        )}
        {!isValidating && nameError && (
          <p className="text-red-400 text-xs">{nameError}</p>
        )}
      </div>

      {submitError && <p className="text-red-400 text-xs">{submitError}</p>}

      {/* Button */}
      <div className="space-y-1">
        {!showPaymentOptions ? (
          <Button
            onClick={() => setShowPaymentOptions(true)}
            disabled={!canSubmit}
            className="w-full bg-purple-600 hover:bg-purple-500 text-white"
          >
            Build Graph
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={handlePayWithCard}
              disabled={isLoading}
              className="flex-1 bg-purple-600 hover:bg-purple-500 text-white gap-2"
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
              ) : (
                <><CreditCard className="w-4 h-4" /> Pay with Card</>
              )}
            </Button>
            <Button
              onClick={handlePayWithLightning}
              disabled={isLightningLoading}
              className="flex-1 gap-2"
              variant="outline"
            >
              {isLightningLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
              ) : (
                <><Zap className="w-4 h-4 text-yellow-500" /> Pay with Lightning</>
              )}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
