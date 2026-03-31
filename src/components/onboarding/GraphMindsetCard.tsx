"use client";

import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { GraphNetworkIcon } from "@/components/onboarding/GraphNetworkIcon";
import { Network, Zap, Loader2 } from "lucide-react";

export function GraphMindsetCard() {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [nameError, setNameError] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validateSlug = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setIsAvailable(false);
      setNameError("");
      setIsValidating(false);
      return;
    }

    setIsValidating(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/workspaces/slug-availability?slug=${encodeURIComponent(value)}`);
        const json = await res.json();
        if (json?.data?.isAvailable) {
          setIsAvailable(true);
          setNameError("");
        } else {
          setIsAvailable(false);
          setNameError(json?.data?.message || json?.error || "Name is unavailable");
        }
      } catch {
        setIsAvailable(false);
        setNameError("Could not validate name. Please try again.");
      } finally {
        setIsValidating(false);
      }
    }, 500);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setName(value);
    validateSlug(value);
  };

  const handleCreateGraph = async () => {
    setIsLoading(true);
    setSubmitError("");

    try {
      // 1. Persist name and password so WelcomeStep.claimPayment can use them after sign-in
      localStorage.setItem("graphMindsetWorkspaceName", name);
      localStorage.setItem("graphMindsetPassword", password);

      // 2. Create Stripe checkout session
      const stripeRes = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceName: name, workspaceSlug: name }),
      });
      const stripeJson = await stripeRes.json();
      if (!stripeRes.ok) {
        setSubmitError(stripeJson?.error || "Failed to create payment session.");
        setIsLoading(false);
        return;
      }

      const { sessionUrl, sessionId } = stripeJson;
      if (!sessionUrl) {
        setSubmitError("No payment URL returned. Please try again.");
        setIsLoading(false);
        return;
      }

      // 3. Persist sessionId for WelcomeStep to claim after return
      localStorage.setItem("graphMindsetSessionId", sessionId);

      window.location.href = sessionUrl;
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setIsLoading(false);
    }
  };

  const isButtonDisabled = !name.trim() || !password.trim() || !isAvailable || isValidating || isLoading;

  return (
    <Card className="overflow-hidden border border-blue-500/30 bg-card">
      <div className="flex flex-col md:flex-row">
        {/* Left — visual panel */}
        <div className="relative flex flex-col items-center justify-center p-8 bg-gradient-to-br from-blue-600/10 via-purple-600/5 to-transparent border-b md:border-b-0 md:border-r border-border md:w-5/12">
          <div
            className="absolute inset-0 opacity-[0.05]"
            style={{
              backgroundImage: `radial-gradient(circle, #3b82f6 1.5px, transparent 1.5px)`,
              backgroundSize: "20px 20px",
            }}
          />
          <div className="relative w-32 h-32 mb-4">
            <GraphNetworkIcon size={128} animate={true} />
          </div>
          <h3 className="relative text-xl font-bold text-center">GraphMindset</h3>
          <p className="relative text-sm text-muted-foreground text-center mt-1 max-w-[180px]">
            Build a knowledge graph from your codebase
          </p>
          <div className="relative mt-4 flex items-center gap-1.5 rounded-full bg-blue-500/10 border border-blue-500/30 px-3 py-1.5">
            <Zap className="w-3.5 h-3.5 text-yellow-500" />
            <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">$50</span>
            <span className="text-xs text-muted-foreground">/ workspace</span>
          </div>
        </div>

        {/* Right — form panel */}
        <div className="flex flex-col justify-center p-8 flex-1 space-y-5">
          <div>
            <h4 className="text-lg font-semibold">Set up your graph workspace</h4>
            <p className="text-sm text-muted-foreground mt-1">
              Give it a name, pay once, then connect your GitHub.
            </p>
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Workspace name</label>
              <Input
                placeholder="e.g., my-api-graph"
                value={name}
                onChange={handleNameChange}
                aria-invalid={!!nameError}
              />
              {isValidating && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking availability…
                </p>
              )}
              {!isValidating && nameError && (
                <p className="text-xs text-destructive">{nameError}</p>
              )}
              {!isValidating && !nameError && isAvailable && name.trim() && (
                <p className="text-xs text-green-600 dark:text-green-400">Name is available ✓</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Graph password</label>
              <Input
                type="password"
                placeholder="Min. 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <ul className="text-xs text-muted-foreground space-y-1.5 pl-1">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                Automatic code graph indexing
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
                AI-powered codebase queries
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                Real-time graph updates on push
              </li>
            </ul>
          </div>

          {submitError && (
            <p className="text-xs text-destructive">{submitError}</p>
          )}

          <Button
            disabled={isButtonDisabled}
            onClick={handleCreateGraph}
            className="w-full gap-2"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing…
              </>
            ) : (
              <>
                Create my graph <Network className="w-4 h-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
