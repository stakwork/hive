"use client";

import React from "react";

interface WizardStepRendererProps {
  children: React.ReactNode;
}

export function WizardStepRenderer({ children }: WizardStepRendererProps) {
  return <>{children}</>;
} 