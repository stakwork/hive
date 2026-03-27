import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { authOptions } from "@/lib/auth/nextauth";
import { handleWorkspaceRedirect } from "@/lib/auth/workspace-resolver";
import {
  ArrowRight,
  BarChart3,
  BotMessageSquare,
  FlaskConical,
  GitMerge,
  Globe,
  Layers,
  MessageSquareText,
  Mic,
  Network,
  PencilRuler,
  Zap,
} from "lucide-react";
import { getServerSession } from "next-auth/next";
import Link from "next/link";

export default async function AboutPage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    await handleWorkspaceRedirect(session);
    return null;
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <span className="text-lg font-semibold tracking-tight">Hive</span>
          <Link href="/auth/signin">
            <Button variant="outline" size="sm">
              Sign In
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 py-24 text-center">
        <div className="mx-auto max-w-3xl">
          <Badge variant="secondary" className="mb-6 gap-1.5">
            <Zap className="h-3.5 w-3.5" />
            AI-First PM Toolkit
          </Badge>
          <h1 className="mb-5 text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
            Ship features faster with AI that actually understands your codebase
          </h1>
          <p className="mb-10 text-lg text-muted-foreground sm:text-xl">
            Plan with AI, execute autonomously, and collaborate in real time —
            from idea to pull request without leaving Hive.
          </p>
          <Link href="/auth/signin">
            <Button size="lg" className="gap-2">
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <Separator />

      {/* Feature Spotlight 1 — Plan with AI */}
      <section className="px-6 py-20">
        <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-2 md:items-center">
          <div>
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border bg-muted">
              <MessageSquareText className="h-5 w-5 text-foreground" />
            </div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Plan with AI
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Describe a feature in plain English and Hive's AI builds the full
              plan alongside you — brief, requirements, architecture, and a
              task breakdown — in a live split-panel view. No tickets to
              pre-fill, no templates to wrestle with.
            </p>
          </div>
          <div className="rounded-xl border bg-muted/40 p-6 space-y-3">
            {["Brief", "Requirements", "Architecture", "Tasks"].map((label, i) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm font-medium"
                style={{ opacity: 1 - i * 0.12 }}
              >
                <div className="h-2 w-2 rounded-full bg-foreground/30" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature Spotlight 2 — Autonomous Execution */}
      <section className="bg-muted/40 px-6 py-20">
        <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-2 md:items-center">
          <div className="order-2 md:order-1 rounded-xl border bg-background p-6 space-y-3 font-mono text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="text-foreground/60">$</span>
              <span>agent claimed workspace — pod-7f3a</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-foreground/60">→</span>
              <span>writing auth middleware…</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-foreground/60">→</span>
              <span>running tests (42/42 passed)</span>
            </div>
            <div className="flex items-center gap-2">
              <GitMerge className="h-3.5 w-3.5 shrink-0" />
              <span className="text-foreground">PR #214 opened</span>
            </div>
          </div>
          <div className="order-1 md:order-2">
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border bg-muted">
              <BotMessageSquare className="h-5 w-5 text-foreground" />
            </div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Autonomous Execution
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              An AI agent claims a live cloud workspace, writes the code against
              your actual repository, and opens a pull request — no dev
              environment setup required. You review and merge; Hive handles
              the rest.
            </p>
          </div>
        </div>
      </section>

      {/* Feature Spotlight 3 — Voice-Driven Creation */}
      <section className="px-6 py-20">
        <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-2 md:items-center">
          <div>
            <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border bg-muted">
              <Mic className="h-5 w-5 text-foreground" />
            </div>
            <h2 className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Voice-Driven Creation
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              Say a feature idea aloud. Hive transcribes it, extracts a title
              and description, and drops you straight into Plan Mode with one
              click. Your best ideas come at the worst times — capture them in
              seconds.
            </p>
          </div>
          <div className="rounded-xl border bg-muted/40 p-6 flex flex-col items-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed bg-background">
              <Mic className="h-7 w-7 text-muted-foreground" />
            </div>
            <div className="text-sm text-muted-foreground italic max-w-xs">
              &ldquo;Add a dark mode toggle to user settings with system
              preference detection&rdquo;
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="rounded-lg border bg-background px-4 py-2 text-sm font-medium">
              Launching Plan Mode…
            </div>
          </div>
        </div>
      </section>

      <Separator />

      {/* Secondary Features Grid */}
      <section className="px-6 py-20 bg-muted/40">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="mb-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Everything a modern PM needs
            </h2>
            <p className="text-muted-foreground">
              A full platform built around how product teams actually work.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Network,
                title: "Knowledge Graph",
                description:
                  "Hive ingests your repository and builds a semantic code graph so AI has deep, accurate context about your actual codebase — not generic guesses.",
              },
              {
                icon: PencilRuler,
                title: "Whiteboard Collaboration",
                description:
                  "Embedded Excalidraw canvas per workspace and per feature. Sketch architecture, draw flows, and keep diagrams co-located with the work.",
              },
              {
                icon: Layers,
                title: "Visual Workflows",
                description:
                  "See exactly what the AI agent is doing at every step — tool calls, decisions, and code changes — without digging through system prompts.",
              },
              {
                icon: FlaskConical,
                title: "Hosted Testing Environments",
                description:
                  "Spin up a live preview of any branch in seconds. Review feature work as a PM without cloning repos or setting up local dev environments.",
              },
              {
                icon: BarChart3,
                title: "Test Coverage Analytics",
                description:
                  "Janitor workflows automatically analyze test coverage gaps, generate missing unit and E2E tests, and open PRs to lift coverage over time.",
              },
              {
                icon: Globe,
                title: "Real-time Collaboration",
                description:
                  "Presence indicators, Pusher-powered live plan updates, and Sphinx messaging integrations keep distributed teams in sync as plans evolve.",
              },
            ].map(({ icon: Icon, title, description }) => (
              <Card key={title} className="border bg-background shadow-none">
                <CardHeader className="pb-2">
                  <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg border bg-muted">
                    <Icon className="h-4 w-4 text-foreground" />
                  </div>
                  <CardTitle className="text-base">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {description}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA Banner */}
      <section className="bg-muted px-6 py-20 text-center">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Ready to move from idea to PR?
          </h2>
          <p className="mb-8 text-muted-foreground">
            Connect your GitHub org and Hive starts working in minutes — no
            config sprawl, no lengthy onboarding.
          </p>
          <Link href="/auth/signin">
            <Button size="lg" className="gap-2">
              Sign In with GitHub
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 sm:flex-row sm:justify-between">
          <span className="text-sm font-semibold">Hive</span>
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Hive. All rights reserved.
          </p>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <a href="#" className="hover:text-foreground transition-colors">
              Privacy
            </a>
            <a href="#" className="hover:text-foreground transition-colors">
              Terms
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
