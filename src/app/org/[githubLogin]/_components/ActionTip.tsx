"use client";

import React, { type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** An icon control's tooltip; the control itself carries the matching `aria-label`. */
export function ActionTip({
  label,
  side = "bottom",
  children,
}: {
  label: string;
  /** Above the control when it sits at the bottom of the screen (the composer). */
  side?: "top" | "bottom";
  children: ReactElement;
}) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}
