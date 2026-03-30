"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { GraphNetworkIcon } from "@/components/onboarding/GraphNetworkIcon";
import { ArrowRight, Github, Loader2, Network, Zap, GitBranch, Globe } from "lucide-react";
import Image from "next/image";

// ─── Mock GitHub Auth Modal ───────────────────────────────────────────────────
function MockGitHubModal({
  isOpen,
  onClose,
  workspaceName,
}: {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}) {
  const [loading, setLoading] = useState(false);
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="w-14 h-14 bg-gray-900 rounded-full flex items-center justify-center mx-auto mb-4">
            <Github className="w-7 h-7 text-white" />
          </div>
          <DialogTitle className="text-xl font-semibold">Connect GitHub Account</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            To create your{" "}
            <span className="font-medium text-foreground">{workspaceName || "GraphMindset"}</span>{" "}
            workspace, we need to connect your GitHub account.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 space-y-3">
          <div className="rounded-lg bg-muted/50 border border-border p-3 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground text-xs uppercase tracking-wide mb-2">
              Permissions requested
            </p>
            <div className="flex items-center gap-2">
              <GitBranch className="w-3.5 h-3.5 text-blue-500" />
              <span>Read repository structure</span>
            </div>
            <div className="flex items-center gap-2">
              <Network className="w-3.5 h-3.5 text-purple-500" />
              <span>Build knowledge graph from your code</span>
            </div>
            <div className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-green-500" />
              <span>Access public profile</span>
            </div>
          </div>
          <Button
            className="w-full gap-2"
            onClick={() => {
              setLoading(true);
              setTimeout(() => {
                setLoading(false);
                onClose();
              }, 1800);
            }}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Github className="w-4 h-4" />
            )}
            {loading ? "Connecting…" : "Continue with GitHub"}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            🔒 In the future this will link to a Stripe / Lightning payment page for the $50 plan
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── "Welcome to Hive" card (existing card, shown dimmed for context) ─────────
function WelcomeToHiveCard() {
  return (
    <Card className="bg-card text-card-foreground opacity-60 pointer-events-none select-none">
      <CardHeader className="text-center pb-4">
        <div className="w-16 h-16 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center mx-auto mb-4">
          <Image src="/apple-touch-icon.png" alt="Hive" width={40} height={40} />
        </div>
        <CardTitle className="text-2xl">Welcome to Hive</CardTitle>
        <CardDescription className="text-base">
          Paste your GitHub repository to get started
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-md mx-auto">
          <Input placeholder="https://github.com/username/repository" disabled />
        </div>
        <div className="flex justify-center">
          <Button disabled className="px-8">
            Get Started <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── GraphMindset Card — Variation C (Split Layout) ───────────────────────────
function GraphMindsetCard() {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <>
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
                Give it a name to get started. We'll connect your GitHub and build your graph.
              </p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Workspace name</label>
                <Input
                  placeholder="e.g., my-api-graph"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && name.trim() && setOpen(true)}
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

            <Button
              onClick={() => setOpen(true)}
              disabled={!name.trim()}
              className="w-full gap-2"
            >
              Create my graph <Network className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>

      <MockGitHubModal isOpen={open} onClose={() => setOpen(false)} workspaceName={name} />
    </>
  );
}

// ─── Main Prototype Page ──────────────────────────────────────────────────────
export default function GraphMindsetPrototypePage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Prototype header */}
      <div className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Prototype · Final
            </span>
            <h1 className="text-sm font-semibold text-foreground">
              GraphMindset Onboarding Card — Variation C (Split Layout)
            </h1>
          </div>
          <Badge variant="outline" className="text-xs text-green-600 border-green-500/40 bg-green-500/10">
            ✓ Selected
          </Badge>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-10 space-y-4">
        <p className="text-xs text-muted-foreground text-center">
          ↓ The "Welcome to Hive" card is shown dimmed — the GraphMindset card appears below it
        </p>

        {/* Existing card context */}
        <WelcomeToHiveCard />

        {/* New GraphMindset card */}
        <GraphMindsetCard />
      </div>
    </div>
  );
}
