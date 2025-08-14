"use client";

import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();
  
  const handleBack = () => {
    router.back();
  };

  return (
    <Button variant="ghost" size="sm" onClick={handleBack}>
      <ArrowLeft className="w-4 h-4 mr-2" />
      Back
    </Button>
  );
}