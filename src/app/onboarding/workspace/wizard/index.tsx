"use client";
import { useCallback, useState, Suspense } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { WizardStepRenderer } from "./WizardStepRenderer";
import { Loader2 } from "lucide-react";

export const STEPS_ARRAY = [
  "WELCOME",
];

export type TWizardStep = (typeof STEPS_ARRAY)[number];

export default function WorkspaceWizard() {
  const [currentStep] = useState<string>("WELCOME");
  const searchParams = useSearchParams();
  const isPaymentReturn = searchParams.get("payment") === "success";

  const handleNext = useCallback(() => {
    // No-op since we only have one step now
    // All navigation is handled within the WELCOME step
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-blue-500/30">
      {/* Background blur blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[10%] w-[70%] h-[70%] bg-blue-500/5 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[40%] -right-[10%] w-[70%] h-[70%] bg-purple-500/5 blur-[120px] rounded-full" />
      </div>
      <main className="relative max-w-5xl mx-auto px-6 py-12 md:py-16">
        {/* Animated gradient hero header */}
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
            {isPaymentReturn
              ? "Finishing setup — this will only take a moment."
              : "Pick the product that fits your workflow. Both run on your codebase and ship in minutes."}
          </p>
        </motion.div>
        <Suspense fallback={<div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-zinc-500" /></div>}>
          <WizardStepRenderer
            onNext={handleNext}
            step={currentStep}
          />
        </Suspense>
      </main>
    </div>
  );
}
