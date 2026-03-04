"use client";

import { useState } from "react";

// ---------------------------------------------------------------------------
// Shared icons (inline SVG to keep this fully self-contained)
// ---------------------------------------------------------------------------

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

const LightningIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M13 2L4.09 12.97A1 1 0 005 14.5h6.5L11 22l8.91-10.97A1 1 0 0019 9.5h-6.5L13 2z" />
  </svg>
);

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

const SpinnerIcon = () => (
  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
  </svg>
);

// ---------------------------------------------------------------------------
// Variation A — Minimal / Clean (single GitHub CTA)
// ---------------------------------------------------------------------------
function VariationA() {
  const [loading, setLoading] = useState(false);
  const simulate = () => { setLoading(true); setTimeout(() => setLoading(false), 1800); };

  return (
    <div className="flex flex-col items-center justify-center min-h-[340px] bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-10 gap-6">
      <div className="text-center">
        <div className="w-10 h-10 rounded-xl bg-black flex items-center justify-center mx-auto mb-4">
          <svg viewBox="0 0 24 24" fill="white" className="w-6 h-6"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" strokeWidth="2" stroke="white" fill="none" /></svg>
        </div>
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Welcome to Hive</h2>
        <p className="text-sm text-zinc-500 mt-1">Sign in to continue to your workspace</p>
      </div>

      <button
        onClick={simulate}
        disabled={loading}
        className="flex items-center gap-3 w-full max-w-xs px-5 py-3 bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 rounded-xl font-medium text-sm hover:bg-zinc-700 dark:hover:bg-zinc-100 transition-all duration-150 disabled:opacity-60 justify-center shadow-sm"
      >
        {loading ? <SpinnerIcon /> : <GitHubIcon />}
        {loading ? "Signing in…" : "Continue with GitHub"}
      </button>

      <p className="text-xs text-zinc-400 text-center max-w-xs">
        By continuing, you agree to our <span className="underline cursor-pointer">Terms</span> and <span className="underline cursor-pointer">Privacy Policy</span>.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variation B — Multi-provider card stack
// ---------------------------------------------------------------------------
function VariationB() {
  const [loading, setLoading] = useState<string | null>(null);
  const simulate = (id: string) => { setLoading(id); setTimeout(() => setLoading(null), 1800); };

  const providers = [
    { id: "github", label: "GitHub", icon: <GitHubIcon />, bg: "bg-[#24292f] hover:bg-[#1a1f25]", text: "text-white" },
    { id: "google", label: "Google", icon: <GoogleIcon />, bg: "bg-white hover:bg-gray-50 border border-gray-300", text: "text-gray-700" },
    { id: "sphinx", label: "Sphinx Lightning", icon: <LightningIcon />, bg: "bg-[#F7B731] hover:bg-[#e8ab2d]", text: "text-zinc-900" },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-[340px] bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-10 gap-5">
      <div className="text-center mb-1">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-white">Sign in</h2>
        <p className="text-sm text-zinc-500 mt-1">Choose your preferred provider</p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        {providers.map((p) => (
          <button
            key={p.id}
            onClick={() => simulate(p.id)}
            disabled={!!loading}
            className={`flex items-center gap-3 px-5 py-3 rounded-xl font-medium text-sm transition-all duration-150 disabled:opacity-50 ${p.bg} ${p.text} shadow-sm`}
          >
            {loading === p.id ? <SpinnerIcon /> : p.icon}
            {loading === p.id ? "Connecting…" : `Continue with ${p.label}`}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variation C — Split panel (left branding, right form)
// ---------------------------------------------------------------------------
function VariationC() {
  const [loading, setLoading] = useState(false);
  const simulate = () => { setLoading(true); setTimeout(() => setLoading(false), 1800); };

  return (
    <div className="flex min-h-[340px] rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-700 shadow-sm">
      {/* Left panel */}
      <div className="hidden sm:flex flex-col justify-between w-1/2 bg-gradient-to-br from-violet-600 to-indigo-700 p-8 text-white">
        <div className="text-xl font-bold tracking-tight">🐝 Hive</div>
        <div>
          <p className="text-2xl font-semibold leading-snug">AI-first PM toolkit for modern teams</p>
          <p className="mt-2 text-sm text-indigo-200">Ship faster. Break less. Stay coordinated.</p>
        </div>
        <div className="flex gap-2">
          {["🔒 Secure", "⚡ Fast", "🤖 AI-Powered"].map((t) => (
            <span key={t} className="text-xs bg-white/10 rounded-full px-3 py-1">{t}</span>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex flex-col justify-center items-center flex-1 bg-white dark:bg-zinc-950 p-8 gap-5">
        <div className="text-center">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Welcome back</h2>
          <p className="text-sm text-zinc-500 mt-1">Sign in to your account</p>
        </div>

        <button
          onClick={simulate}
          disabled={loading}
          className="flex items-center gap-3 w-full max-w-[220px] px-5 py-3 rounded-xl bg-zinc-900 text-white text-sm font-medium hover:bg-zinc-700 transition disabled:opacity-60 justify-center"
        >
          {loading ? <SpinnerIcon /> : <GitHubIcon />}
          {loading ? "Signing in…" : "Sign in with GitHub"}
        </button>

        <div className="flex items-center gap-2 w-full max-w-[220px]">
          <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
          <span className="text-xs text-zinc-400">or</span>
          <div className="flex-1 h-px bg-zinc-200 dark:bg-zinc-700" />
        </div>

        <button
          onClick={simulate}
          disabled={loading}
          className="flex items-center gap-3 w-full max-w-[220px] px-5 py-3 rounded-xl border border-[#F7B731] text-[#B87F00] dark:text-[#F7B731] text-sm font-medium hover:bg-[#F7B731]/10 transition disabled:opacity-60 justify-center"
        >
          {loading ? <SpinnerIcon /> : <LightningIcon />}
          {loading ? "Connecting…" : "Sphinx Lightning"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variation D — Floating modal / dialog style
// ---------------------------------------------------------------------------
function VariationD() {
  const [loading, setLoading] = useState(false);
  const simulate = () => { setLoading(true); setTimeout(() => setLoading(false), 1800); };

  return (
    <div className="flex items-center justify-center min-h-[340px] bg-[url('data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%239C92AC\' fill-opacity=\'0.07\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E')] rounded-2xl border border-zinc-200 dark:border-zinc-800">
      <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4 flex flex-col gap-5 border border-zinc-100 dark:border-zinc-800">
        <div className="text-center">
          <span className="inline-block text-3xl mb-2">🔐</span>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-white">Sign in to Hive</h2>
          <p className="text-sm text-zinc-500 mt-1">Your AI-powered PM workspace</p>
        </div>

        <button
          onClick={simulate}
          disabled={loading}
          className="group flex items-center gap-3 px-5 py-3.5 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl font-semibold text-sm hover:scale-[1.02] active:scale-[0.99] transition-all duration-150 disabled:opacity-60 justify-center shadow-md"
        >
          {loading ? <SpinnerIcon /> : <GitHubIcon />}
          {loading ? "Authenticating…" : "Continue with GitHub"}
        </button>

        <button
          onClick={simulate}
          disabled={loading}
          className="flex items-center gap-3 px-5 py-3.5 bg-[#F7B731] text-zinc-900 rounded-xl font-semibold text-sm hover:scale-[1.02] active:scale-[0.99] transition-all duration-150 disabled:opacity-60 justify-center shadow-md"
        >
          {loading ? <SpinnerIcon /> : <LightningIcon />}
          {loading ? "Connecting…" : "Login with Sphinx"}
        </button>

        <p className="text-center text-xs text-zinc-400">
          Don&apos;t have an account?{" "}
          <span className="text-violet-600 dark:text-violet-400 cursor-pointer font-medium hover:underline">Request access</span>
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variation E — Dark glassmorphism / premium style
// ---------------------------------------------------------------------------
function VariationE() {
  const [active, setActive] = useState<string | null>(null);
  const simulate = (id: string) => { setActive(id); setTimeout(() => setActive(null), 1800); };

  return (
    <div className="flex items-center justify-center min-h-[340px] bg-gradient-to-br from-zinc-900 via-violet-950 to-zinc-900 rounded-2xl p-8">
      <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 w-full max-w-sm flex flex-col gap-6 shadow-2xl">
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-violet-500/30">
            <span className="text-white text-xl">🐝</span>
          </div>
          <h2 className="text-xl font-bold text-white">Hive Platform</h2>
          <p className="text-sm text-zinc-400 mt-1">Authenticate to continue</p>
        </div>

        <div className="flex flex-col gap-3">
          {[
            { id: "github", label: "GitHub", icon: <GitHubIcon />, cls: "bg-white/10 hover:bg-white/20 text-white border border-white/10" },
            { id: "google", label: "Google", icon: <GoogleIcon />, cls: "bg-white/10 hover:bg-white/20 text-white border border-white/10" },
            { id: "sphinx", label: "Sphinx Lightning", icon: <LightningIcon />, cls: "bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-zinc-900 border-0 font-semibold shadow-lg shadow-amber-500/20" },
          ].map((p) => (
            <button
              key={p.id}
              onClick={() => simulate(p.id)}
              disabled={!!active}
              className={`flex items-center gap-3 px-5 py-3 rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50 justify-center ${p.cls}`}
            >
              {active === p.id ? <SpinnerIcon /> : p.icon}
              {active === p.id ? "Connecting…" : `Sign in with ${p.label}`}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-center gap-4 text-xs text-zinc-500">
          <span className="cursor-pointer hover:text-zinc-300 transition">Privacy</span>
          <span>·</span>
          <span className="cursor-pointer hover:text-zinc-300 transition">Terms</span>
          <span>·</span>
          <span className="cursor-pointer hover:text-zinc-300 transition">Help</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page layout
// ---------------------------------------------------------------------------
const VARIATIONS = [
  { id: "A", label: "Minimal / Clean", desc: "Single GitHub CTA, distraction-free", component: <VariationA /> },
  { id: "B", label: "Multi-Provider Stack", desc: "GitHub + Google + Sphinx stacked vertically", component: <VariationB /> },
  { id: "C", label: "Split Panel", desc: "Left branding panel + right auth form", component: <VariationC /> },
  { id: "D", label: "Floating Modal", desc: "Card-in-scene modal feel with lift effect on hover", component: <VariationD /> },
  { id: "E", label: "Dark Glassmorphism", desc: "Premium dark glass card on gradient background", component: <VariationE /> },
];

export default function LoginButtonsPrototypePage() {
  return (
    <div className="min-h-screen bg-zinc-100 dark:bg-zinc-950 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-10 text-center">
          <span className="inline-block text-xs font-semibold uppercase tracking-widest text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950 border border-violet-200 dark:border-violet-800 rounded-full px-3 py-1 mb-3">
            Prototype · Login Buttons
          </span>
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">Login Button Variations</h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-2">Five distinct approaches — click buttons to simulate loading states</p>
        </div>

        {/* Variation grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {VARIATIONS.map((v) => (
            <div key={v.id} className={v.id === "C" ? "lg:col-span-2" : ""}>
              {/* Label */}
              <div className="flex items-center gap-2 mb-3">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-violet-600 text-white text-xs font-bold shrink-0">
                  {v.id}
                </span>
                <div>
                  <span className="font-semibold text-zinc-800 dark:text-zinc-200 text-sm">{v.label}</span>
                  <span className="ml-2 text-xs text-zinc-500">— {v.desc}</span>
                </div>
              </div>

              {/* Component */}
              {v.component}
            </div>
          ))}
        </div>

        <p className="text-center text-xs text-zinc-400 mt-12">
          Prototype page · not wired to real auth · <code className="bg-zinc-200 dark:bg-zinc-800 px-1 rounded">/prototype/login-buttons</code>
        </p>
      </div>
    </div>
  );
}
