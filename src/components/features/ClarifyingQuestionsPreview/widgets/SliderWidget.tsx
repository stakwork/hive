"use client";

import React from "react";
import { Slider } from "@/components/ui/slider";
import type { SliderOption } from "@/types/stakwork";

interface SliderWidgetProps {
  option: SliderOption;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function SliderWidget({
  option,
  value,
  onChange,
  disabled = false,
}: SliderWidgetProps) {
  const displayValue = value ?? option.defaultValue;
  
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">
          Adjust value
        </label>
        <span className="text-sm font-semibold text-primary">
          {displayValue}{option.unit || ""}
        </span>
      </div>
      
      <Slider
        value={[displayValue]}
        onValueChange={(values) => onChange(values[0])}
        min={option.min}
        max={option.max}
        step={option.step}
        disabled={disabled}
        className="w-full"
      />
      
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{option.min}{option.unit || ""}</span>
        <span>{option.max}{option.unit || ""}</span>
      </div>
    </div>
  );
}
