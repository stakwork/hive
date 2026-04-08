import { Suspense } from "react";
import { GraphMindsetOnboardingClient } from "./client";
import { Loader2 } from "lucide-react";

function HeroHeader() {
  return (
    <div className="text-center mb-16">
      <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 bg-gradient-to-b from-white to-zinc-500 bg-clip-text text-transparent">
        Tools for the next <br /> generation of creators.
      </h1>
      <p className="text-zinc-400 text-lg max-w-xl mx-auto">
        Finishing setup — this will only take a moment.
      </p>
    </div>
  );
}

export default function GraphMindsetOnboardingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-blue-500/30">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[10%] w-[70%] h-[70%] bg-blue-500/5 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[40%] -right-[10%] w-[70%] h-[70%] bg-purple-500/5 blur-[120px] rounded-full" />
      </div>
      <main className="relative max-w-2xl mx-auto px-6 py-12 md:py-16">
        <HeroHeader />
        <Suspense
          fallback={
            <div className="flex items-center justify-center min-h-[320px]">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            </div>
          }
        >
          <GraphMindsetOnboardingClient />
        </Suspense>
      </main>
    </div>
  );
}
