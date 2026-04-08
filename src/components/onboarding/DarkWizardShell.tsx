import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DarkWizardShellProps {
  children: ReactNode;
  /** When true, the shell uses fixed inset-0 z-50 to overlay the full screen (e.g. during WorkspaceSetup) */
  overlay?: boolean;
}

export function DarkWizardShell({ children, overlay = false }: DarkWizardShellProps) {
  return (
    <div
      className={cn(
        "min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-blue-500/30",
        overlay && "fixed inset-0 z-50",
      )}
    >
      {/* Background blur blobs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[10%] w-[70%] h-[70%] bg-blue-500/5 blur-[120px] rounded-full" />
        <div className="absolute -bottom-[40%] -right-[10%] w-[70%] h-[70%] bg-purple-500/5 blur-[120px] rounded-full" />
      </div>
      <div className="relative max-w-2xl mx-auto px-6 py-12">{children}</div>
    </div>
  );
}
