"use client";

import { useState } from "react";
import {
  Loader2,
  UserCheck,
  FlaskConical,
  Github,
  ChevronDown,
  Code2,
  Cpu,
} from "lucide-react";

function LoadingSpinner() {
  return <Loader2 className="w-4 h-4 animate-spin" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared GitHub button (context reference — same across all variations)
// ─────────────────────────────────────────────────────────────────────────────
function GitHubButton() {
  return (
    <button className="w-full h-11 flex items-center justify-center gap-2 rounded-lg bg-[#24292e] text-white text-sm font-medium hover:bg-[#1a1e22] transition-colors">
      <Github className="w-4 h-4" />
      Continue with GitHub
    </button>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-px bg-border" />
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground/60 font-medium select-none">
        {label}
      </span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A1 — Original baseline (for reference)
// Dashed border, orange accent, input always visible
// ─────────────────────────────────────────────────────────────────────────────
function VariationA1() {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const simulate = () => { setLoading(true); setTimeout(() => setLoading(false), 1800); };

  return (
    <div className="space-y-3">
      <GitHubButton />
      <Divider label="dev only" />
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username (defaults to dev-user)"
        className="w-full h-9 px-3 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-400 transition-colors"
      />
      <button
        onClick={simulate}
        disabled={loading}
        className="w-full h-9 flex items-center justify-center gap-2 rounded-md border border-dashed border-orange-400/60 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 text-sm font-medium hover:bg-orange-100 dark:hover:bg-orange-950/50 transition-colors disabled:opacity-60"
      >
        {loading ? <LoadingSpinner /> : <UserCheck className="w-4 h-4" />}
        {loading ? "Signing in…" : "Mock Sign In"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A2 — Tighter inline layout
// Username + button on one row. Removes the vertical stack — feels more compact
// and less like a "second form", more like a quick-access row.
// ─────────────────────────────────────────────────────────────────────────────
function VariationA2() {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const simulate = () => { setLoading(true); setTimeout(() => setLoading(false), 1800); };

  return (
    <div className="space-y-3">
      <GitHubButton />
      <Divider label="dev only" />
      <div className="flex gap-2">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && simulate()}
          placeholder="dev-user"
          className="flex-1 h-9 px-3 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-400 transition-colors min-w-0"
        />
        <button
          onClick={simulate}
          disabled={loading}
          className="h-9 px-4 flex items-center gap-1.5 rounded-md border border-dashed border-orange-400/60 bg-orange-50 dark:bg-orange-950/30 text-orange-700 dark:text-orange-400 text-sm font-medium hover:bg-orange-100 dark:hover:bg-orange-950/50 transition-colors disabled:opacity-60 shrink-0 whitespace-nowrap"
        >
          {loading ? <LoadingSpinner /> : <UserCheck className="w-4 h-4" />}
          {loading ? "…" : "Mock Sign In"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A3 — Collapsed by default (accordion)
// Username input is hidden until the user clicks the mock sign-in button.
// Reduces clutter when mock auth is secondary — expands in-place on demand.
// ─────────────────────────────────────────────────────────────────────────────
function VariationA3() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const simulate = () => { setLoading(true); setTimeout(() => { setLoading(false); setOpen(false); }, 1800); };

  return (
    <div className="space-y-3">
      <GitHubButton />
      <Divider label="dev only" />

      <div className="rounded-md border border-dashed border-orange-400/50 overflow-hidden">
        {/* Trigger row */}
        <button
          onClick={() => setOpen(!open)}
          className="w-full h-9 flex items-center justify-between px-3 text-orange-700 dark:text-orange-400 text-sm font-medium hover:bg-orange-50 dark:hover:bg-orange-950/30 transition-colors"
        >
          <span className="flex items-center gap-2">
            <UserCheck className="w-4 h-4" />
            Mock Sign In
          </span>
          <ChevronDown
            className={`w-4 h-4 text-orange-400/70 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {/* Expandable body */}
        {open && (
          <div className="border-t border-dashed border-orange-400/30 p-2 space-y-2 bg-orange-50/50 dark:bg-orange-950/20">
            <input
              autoFocus
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !loading && simulate()}
              placeholder="Username (defaults to dev-user)"
              className="w-full h-8 px-3 rounded border border-orange-400/30 bg-background text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-orange-400 transition-colors"
            />
            <button
              onClick={simulate}
              disabled={loading}
              className="w-full h-8 flex items-center justify-center gap-2 rounded bg-orange-500/10 border border-orange-400/40 text-orange-700 dark:text-orange-400 text-sm font-medium hover:bg-orange-500/20 transition-colors disabled:opacity-60"
            >
              {loading ? <LoadingSpinner /> : null}
              {loading ? "Signing in…" : `Sign in as ${username || "dev-user"}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A4 — Softer blue/indigo accent (neutral dev tool feel)
// Same layout as A1 but swaps the orange for a more neutral indigo/slate.
// Less "warning"-like — feels more like a regular secondary action.
// ─────────────────────────────────────────────────────────────────────────────
function VariationA4() {
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState("");
  const simulate = () => { setLoading(true); setTimeout(() => setLoading(false), 1800); };

  return (
    <div className="space-y-3">
      <GitHubButton />
      <Divider label="dev only" />
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username (defaults to dev-user)"
        className="w-full h-9 px-3 rounded-md border border-dashed border-muted-foreground/40 bg-muted/30 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-indigo-400 transition-colors"
      />
      <button
        onClick={simulate}
        disabled={loading}
        className="w-full h-9 flex items-center justify-center gap-2 rounded-md border border-dashed border-indigo-400/50 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 text-sm font-medium hover:bg-indigo-100 dark:hover:bg-indigo-950/50 transition-colors disabled:opacity-60"
      >
        {loading ? <LoadingSpinner /> : <Code2 className="w-4 h-4" />}
        {loading ? "Signing in…" : "Mock Sign In (Dev)"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A5 — Ghost / ultra-minimal
// Borderless, almost invisible — just a faint link-style row under the divider.
// Maximum subtlety: the button disappears into the background for prod users
// who won't use it, but is still discoverable for devs.
// ─────────────────────────────────────────────────────────────────────────────
function VariationA5() {
  const [phase, setPhase] = useState<"idle" | "expanded" | "loading">("idle");
  const [username, setUsername] = useState("");
  const simulate = () => {
    setPhase("loading");
    setTimeout(() => setPhase("idle"), 1800);
  };

  return (
    <div className="space-y-3">
      <GitHubButton />
      <Divider label="dev only" />

      {phase === "idle" && (
        <button
          onClick={() => setPhase("expanded")}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-muted-foreground/60 hover:text-muted-foreground transition-colors rounded"
        >
          <Cpu className="w-3.5 h-3.5" />
          Mock sign in
        </button>
      )}

      {phase === "expanded" && (
        <div className="space-y-2">
          <input
            autoFocus
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && simulate()}
            placeholder="Username (defaults to dev-user)"
            className="w-full h-9 px-3 rounded-md border border-dashed border-muted-foreground/30 bg-muted/20 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-orange-400/60 transition-colors"
          />
          <div className="flex gap-2">
            <button
              onClick={simulate}
              className="flex-1 h-8 flex items-center justify-center gap-1.5 rounded-md border border-dashed border-orange-400/50 bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 text-xs font-medium hover:bg-orange-100 dark:hover:bg-orange-950/40 transition-colors"
            >
              <UserCheck className="w-3.5 h-3.5" />
              {`Sign in as ${username || "dev-user"}`}
            </button>
            <button
              onClick={() => setPhase("idle")}
              className="h-8 w-8 flex items-center justify-center rounded-md border border-dashed border-muted-foreground/30 text-muted-foreground/50 hover:text-muted-foreground text-xs transition-colors"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {phase === "loading" && (
        <div className="flex items-center justify-center gap-2 py-1.5 text-xs text-muted-foreground">
          <LoadingSpinner />
          Signing in as <strong>{username || "dev-user"}</strong>…
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Prototype page
// ─────────────────────────────────────────────────────────────────────────────
const variations = [
  {
    label: "A1",
    tag: "Baseline",
    desc: "Original from round 1 — dashed border, orange tint, input + button stacked vertically. Kept here as the reference point.",
    component: <VariationA1 />,
  },
  {
    label: "A2",
    tag: "Inline Row",
    desc: "Username input and button on one horizontal row. Feels more compact and form-native — less like a second login form. Press Enter to submit.",
    component: <VariationA2 />,
  },
  {
    label: "A3",
    tag: "Accordion",
    desc: "Collapsed to a single trigger row by default. Click to expand the username input in-place. Minimizes clutter when mock auth is rarely used. Closes after sign-in.",
    component: <VariationA3 />,
  },
  {
    label: "A4",
    tag: "Indigo Accent",
    desc: "Same stacked layout as A1 but with an indigo/neutral palette instead of orange. Feels like a regular secondary action rather than a \"warning\" — less alarming for devs.",
    component: <VariationA4 />,
  },
  {
    label: "A5",
    tag: "Ghost / Ultra-minimal",
    desc: "Just a faint link-style row — nearly invisible by default. Expands inline on click to reveal the input + confirm. Maximum subtlety; won't confuse anyone who shouldn't be here.",
    component: <VariationA5 />,
  },
];

export default function PrototypeMockLoginPage() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-5xl mx-auto mb-10">
        <div className="inline-flex items-center gap-2 text-xs bg-muted text-muted-foreground px-3 py-1 rounded-full mb-4">
          <FlaskConical className="w-3 h-3" />
          Prototype · Mock Login — Variation A Iterations
        </div>
        <h1 className="text-2xl font-bold text-foreground">Variation A — 5 Iterations</h1>
        <p className="text-muted-foreground text-sm mt-1">
          All build on the same <strong>subtle dashed-border</strong> concept. Exploring: layout density, expand-on-demand, color accent, and
          ghost-level minimalism. Buttons are interactive — try clicking them.
        </p>
      </div>

      <div className="max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-8">
        {variations.map(({ label, tag, desc, component }) => (
          <div key={label} className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="w-9 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {label}
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">{tag}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card shadow-lg p-6 flex-1">
              <div className="text-center mb-6">
                <div className="text-xl font-bold text-foreground">Hive</div>
                <div className="text-xs text-muted-foreground mt-1">Sign in to your workspace</div>
              </div>
              {component}
              <p className="text-center text-xs text-muted-foreground mt-5">
                By continuing you agree to our{" "}
                <span className="text-blue-500 hover:underline cursor-pointer">Terms</span> and{" "}
                <span className="text-blue-500 hover:underline cursor-pointer">Privacy Policy</span>
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="max-w-5xl mx-auto mt-10 text-center text-xs text-muted-foreground/40">
        Prototype only · <code>/auth/prototype-mock-login</code> · Not wired to real auth
      </div>
    </div>
  );
}
