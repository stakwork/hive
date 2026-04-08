import { Suspense } from "react";
import { GraphMindsetOnboardingClient } from "./client";
import { Loader2 } from "lucide-react";
import { DarkWizardShell } from "@/components/onboarding/DarkWizardShell";

export default function GraphMindsetOnboardingPage() {
  return (
    <DarkWizardShell>
      <Suspense
        fallback={
          <div className="flex items-center justify-center min-h-[320px]">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
          </div>
        }
      >
        <GraphMindsetOnboardingClient />
      </Suspense>
    </DarkWizardShell>
  );
}
