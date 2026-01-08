"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

interface HslColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

// HSL to Hex conversion
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Hex to HSL conversion
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return { h: 0, s: 100, l: 50 };

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function HslColorPicker({ value, onChange }: HslColorPickerProps) {
  const [hsl, setHsl] = useState(() => hexToHsl(value || "#000000"));
  const satLightRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const isDraggingSatLight = useRef(false);
  const isDraggingHue = useRef(false);

  // Sync internal state when value prop changes
  useEffect(() => {
    if (value) {
      const newHsl = hexToHsl(value);
      setHsl(newHsl);
    }
  }, [value]);

  const updateColor = useCallback(
    (newHsl: { h: number; s: number; l: number }) => {
      setHsl(newHsl);
      onChange(hslToHex(newHsl.h, newHsl.s, newHsl.l));
    },
    [onChange]
  );

  const handleSatLightMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!satLightRef.current) return;
      const rect = satLightRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      updateColor({ ...hsl, s: Math.round(x * 100), l: Math.round((1 - y) * 100) });
    },
    [hsl, updateColor]
  );

  const handleHueMove = useCallback(
    (clientX: number) => {
      if (!hueRef.current) return;
      const rect = hueRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      updateColor({ ...hsl, h: Math.round(x * 360) });
    },
    [hsl, updateColor]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSatLight.current) {
        handleSatLightMove(e.clientX, e.clientY);
      } else if (isDraggingHue.current) {
        handleHueMove(e.clientX);
      }
    };

    const handleMouseUp = () => {
      isDraggingSatLight.current = false;
      isDraggingHue.current = false;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleSatLightMove, handleHueMove]);

  return (
    <div className="space-y-3">
      {/* Saturation/Lightness Square */}
      <div
        ref={satLightRef}
        className="relative w-full h-40 rounded cursor-crosshair"
        style={{
          background: `
            linear-gradient(to top, #000, transparent),
            linear-gradient(to right, #fff, hsl(${hsl.h}, 100%, 50%))
          `,
        }}
        onMouseDown={(e) => {
          isDraggingSatLight.current = true;
          handleSatLightMove(e.clientX, e.clientY);
        }}
      >
        {/* Indicator */}
        <div
          className="absolute w-4 h-4 border-2 border-white rounded-full shadow-md -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: `${hsl.s}%`,
            top: `${100 - hsl.l}%`,
            backgroundColor: hslToHex(hsl.h, hsl.s, hsl.l),
          }}
        />
      </div>

      {/* Hue Slider */}
      <div
        ref={hueRef}
        className="relative w-full h-4 rounded cursor-pointer"
        style={{
          background:
            "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
        }}
        onMouseDown={(e) => {
          isDraggingHue.current = true;
          handleHueMove(e.clientX);
        }}
      >
        {/* Thumb */}
        <div
          className="absolute w-4 h-6 border-2 border-white rounded shadow-md -translate-x-1/2 -top-1 pointer-events-none"
          style={{
            left: `${(hsl.h / 360) * 100}%`,
            backgroundColor: `hsl(${hsl.h}, 100%, 50%)`,
          }}
        />
      </div>

      {/* Preview */}
      <div className="flex items-center gap-2">
        <div
          className="w-8 h-8 rounded border border-border"
          style={{ backgroundColor: hslToHex(hsl.h, hsl.s, hsl.l) }}
        />
        <span className={cn("text-xs font-mono text-muted-foreground")}>
          {hslToHex(hsl.h, hsl.s, hsl.l).toUpperCase()}
        </span>
      </div>
    </div>
  );
}
