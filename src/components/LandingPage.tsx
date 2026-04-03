"use client";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractRepoNameFromUrl } from "@/lib/utils/slug";
import {
  ArrowRight,
  Code2,
  Cpu,
  Database,
  Github,
  Hexagon,
  Loader2,
  Network,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import { FormEvent, useRef, useState } from "react";

const GITHUB_URL_REGEX = /^https:\/\/github\.com\/[^/]+\/[^/]+(\/.*)?$/;

// ─── Password Gate ─────────────────────────────────────────────────────────────

function PasswordGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/verify-landing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (data.success) {
        onUnlocked();
      } else {
        setError(data.message || "Incorrect password");
        setIsLoading(false);
      }
    } catch {
      setError("An error occurred. Please try again.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm p-8 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Welcome to Hive</h1>
            <p className="text-zinc-400 text-sm">Enter your access password to continue.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isLoading}
              autoFocus
              required
              className="h-12 text-base bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-blue-500"
            />

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              disabled={isLoading || !password}
              className="w-full h-12 text-base bg-blue-600 hover:bg-blue-500 text-white"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                "Continue"
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Hive Card ─────────────────────────────────────────────────────────────────

function HiveCard() {
  const [repoUrl, setRepoUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const isValid = GITHUB_URL_REGEX.test(repoUrl.trim());

  const handleCreate = async () => {
    if (!isValid) {
      setUrlError("Please enter a valid GitHub repository URL.");
      return;
    }
    setUrlError(null);
    setCheckoutError(null);
    setIsLoading(true);

    try {
      const slug = extractRepoNameFromUrl(repoUrl.trim());
      localStorage.setItem("repoUrl", repoUrl.trim());
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceName: slug,
          workspaceSlug: slug,
          workspaceType: "hive",
          repositoryUrl: repoUrl.trim(),
        }),
      });
      const { sessionUrl } = await res.json();
      window.location.href = sessionUrl;
    } catch {
      setCheckoutError("Failed to start checkout. Please try again.");
      setIsLoading(false);
    }
  };

  const handleBlur = () => {
    if (repoUrl && !isValid) {
      setUrlError("Please enter a valid GitHub repository URL (https://github.com/username/repo).");
    } else {
      setUrlError(null);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
      className="rounded-2xl border border-zinc-800 bg-zinc-900/60 backdrop-blur-sm p-8 flex flex-col gap-6"
    >
      {/* Icon */}
      <div className="relative w-12 h-12">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
          <Hexagon className="w-6 h-6 text-white" />
        </div>
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-white border-2 border-zinc-900" />
      </div>

      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white mb-1">Hive</h2>
        <p className="text-zinc-400 text-sm leading-relaxed">
          AI-first PM toolkit that automates janitor workflows, lifts test coverage, and hardens your
          codebase — all from a single GitHub repo.
        </p>
      </div>

      {/* Features */}
      <ul className="space-y-2">
        {[
          { icon: Zap, text: "Automated test-coverage janitors" },
          { icon: Code2, text: "Codebase hardening workflows" },
          { icon: Cpu, text: "AI-powered task generation" },
          { icon: Github, text: "Deep GitHub integration" },
        ].map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 text-sm text-zinc-300">
            <Icon className="w-4 h-4 text-blue-400 shrink-0" />
            {text}
          </li>
        ))}
      </ul>

      {/* Price */}
      <p className="text-zinc-500 text-sm font-medium">
        <span className="text-white text-lg font-bold">$50</span> / environment
      </p>

      {/* Input */}
      <div className="space-y-1">
        <Input
          type="url"
          placeholder="https://github.com/username/repository"
          value={repoUrl}
          onChange={(e) => {
            setRepoUrl(e.target.value);
            if (urlError) setUrlError(null);
          }}
          onBlur={handleBlur}
          disabled={isLoading}
          className="bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus-visible:ring-blue-500"
        />
        {urlError && <p className="text-red-400 text-xs">{urlError}</p>}
      </div>

      {/* Button */}
      <div className="space-y-1">
        <Button
          onClick={handleCreate}
          disabled={!isValid || isLoading}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Redirecting...
            </>
          ) : (
            <>
              Create Hive
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
        {checkoutError && <p className="text-red-400 text-xs">{checkoutError}</p>}
      </div>
    </motion.div>
  );
}

// ─── GraphMindset Card ─────────────────────────────────────────────────────────

function GraphMindsetCard() {
  const [name, setName] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [nameError, setNameError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNameChange = (value: string) => {
    setName(value);
    setIsAvailable(false);
    setNameError("");

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) return;

    setIsValidating(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/graphmindset/slug-availability?slug=${encodeURIComponent(value.trim())}`
        );
        const json = await res.json();
        if (json.data.isAvailable) {
          setIsAvailable(true);
          setNameError("");
        } else {
          setIsAvailable(false);
          setNameError(json.data.message || "This name is already taken.");
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

  const handleBuild = async () => {
    if (!canSubmit) return;
    setCheckoutError(null);
    setIsLoading(true);

    try {
      localStorage.setItem("graphMindsetWorkspaceName", name);
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceName: name, workspaceSlug: name }),
      });
      const { sessionUrl } = await res.json();
      window.location.href = sessionUrl;
    } catch {
      setCheckoutError("Failed to start checkout. Please try again.");
      setIsLoading(false);
    }
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
        <span className="text-white text-lg font-bold">$50</span> / workspace
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

      {/* Button */}
      <div className="space-y-1">
        <Button
          onClick={handleBuild}
          disabled={!canSubmit}
          className="w-full bg-purple-600 hover:bg-purple-500 text-white"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Redirecting...
            </>
          ) : (
            <>
              Build Graph
              <ArrowRight className="w-4 h-4 ml-2" />
            </>
          )}
        </Button>
        {checkoutError && <p className="text-red-400 text-xs">{checkoutError}</p>}
      </div>
    </motion.div>
  );
}

// ─── Two-card Layout ───────────────────────────────────────────────────────────

function TwoCardLayout() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-blue-500/30">
      {/* Background blurs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[10%] w-[70%] h-[70%] bg-blue-500/5 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[40%] -right-[10%] w-[70%] h-[70%] bg-purple-500/5 blur-[120px] rounded-full" />
      </div>

      <main className="relative max-w-5xl mx-auto px-6 py-24 md:py-32">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-16"
        >
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 bg-gradient-to-b from-white to-zinc-500 bg-clip-text text-transparent">
            Tools for the next <br /> generation of creators.
          </h1>
          <p className="text-zinc-400 text-lg max-w-xl mx-auto">
            Pick the product that fits your workflow. Both run on your codebase and ship in minutes.
          </p>
        </motion.div>

        {/* Cards */}
        <div className="grid md:grid-cols-2 gap-8">
          <HiveCard />
          <GraphMindsetCard />
        </div>
      </main>
    </div>
  );
}

// ─── Root Component ────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [isUnlocked, setIsUnlocked] = useState(false);

  if (!isUnlocked) {
    return <PasswordGate onUnlocked={() => setIsUnlocked(true)} />;
  }

  return <TwoCardLayout />;
}
