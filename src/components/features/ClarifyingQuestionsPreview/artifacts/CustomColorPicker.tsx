"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface CustomColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  selected?: boolean;
}

export function CustomColorPicker({
  value,
  onChange,
  selected,
}: CustomColorPickerProps) {
  const [hexInput, setHexInput] = useState(value || "");

  // Sync hex input when value changes externally
  useEffect(() => {
    if (value && value !== hexInput) {
      setHexInput(value);
    }
  }, [value]);

  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    onChange(newColor);
    setHexInput(newColor);
  };

  const handleHexChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let input = e.target.value;

    // Add # if not present and input has content
    if (input && !input.startsWith("#")) {
      input = "#" + input;
    }

    setHexInput(input);

    // Only update if valid hex color
    if (/^#[0-9A-Fa-f]{6}$/.test(input)) {
      onChange(input);
    }
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-md border transition-colors",
        selected
          ? "bg-primary/10 border-primary/30"
          : "border-border hover:bg-muted/30"
      )}
    >
      <span className="text-sm text-muted-foreground whitespace-nowrap">
        Custom:
      </span>
      <input
        type="color"
        value={value || "#000000"}
        onChange={handleColorChange}
        className="w-10 h-10 rounded cursor-pointer border-0 bg-transparent"
        aria-label="Pick custom color"
      />
      <input
        type="text"
        value={hexInput}
        onChange={handleHexChange}
        placeholder="#000000"
        className={cn(
          "w-24 px-2 py-1.5 border rounded text-sm font-mono",
          "bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
        )}
        aria-label="Hex color value"
      />
    </div>
  );
}
