"use client";

import { useState, useEffect } from "react";
import { Pipette } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { HslColorPicker } from "./HslColorPicker";

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
  const [open, setOpen] = useState(false);
  const [hexInput, setHexInput] = useState(value || "");

  // Sync hex input when value changes externally
  useEffect(() => {
    if (value) {
      setHexInput(value);
    }
  }, [value]);

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

  const handlePickerChange = (hex: string) => {
    onChange(hex);
    setHexInput(hex);
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

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              "w-10 h-10 rounded border-2 cursor-pointer flex items-center justify-center transition-all",
              value
                ? "border-border hover:border-foreground/50"
                : "border-dashed border-muted-foreground/40 hover:border-foreground/50"
            )}
            style={{ backgroundColor: value || "transparent" }}
            aria-label="Open color picker"
          >
            {!value && <Pipette className="h-4 w-4 text-muted-foreground" />}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-3" align="start">
          <HslColorPicker value={value || "#000000"} onChange={handlePickerChange} />
        </PopoverContent>
      </Popover>

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
