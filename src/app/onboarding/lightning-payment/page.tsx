import { Suspense } from "react";
import { LightningPaymentClient } from "./client";
import { Loader2 } from "lucide-react";

export default function LightningPaymentPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <LightningPaymentClient />
    </Suspense>
  );
}
